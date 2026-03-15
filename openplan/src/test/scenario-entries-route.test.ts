import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const scenarioSetMaybeSingleMock = vi.fn();
const scenarioSetEqMock = vi.fn(() => ({ maybeSingle: scenarioSetMaybeSingleMock }));
const scenarioSetSelectMock = vi.fn(() => ({ eq: scenarioSetEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const runsMaybeSingleMock = vi.fn();
const runsEqIdMock = vi.fn(() => ({ maybeSingle: runsMaybeSingleMock }));
const runsEqWorkspaceMock = vi.fn(() => ({ eq: runsEqIdMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqWorkspaceMock }));

const entrySingleMock = vi.fn();
const entryInsertSelectMock = vi.fn(() => ({ single: entrySingleMock }));
const entryInsertMock = vi.fn(() => ({ select: entryInsertSelectMock }));

const existingEntryMaybeSingleMock = vi.fn();
const existingEntryEqScenarioSetMock = vi.fn(() => ({ maybeSingle: existingEntryMaybeSingleMock }));
const existingEntryEqIdMock = vi.fn(() => ({ eq: existingEntryEqScenarioSetMock }));
const existingEntrySelectMock = vi.fn(() => ({ eq: existingEntryEqIdMock }));
const entryUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const entryUpdateMock = vi.fn(() => ({ eq: entryUpdateEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "scenario_sets") {
    return {
      select: scenarioSetSelectMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "runs") {
    return {
      select: runsSelectMock,
    };
  }

  if (table === "scenario_entries") {
    return {
      select: existingEntrySelectMock,
      insert: entryInsertMock,
      update: entryUpdateMock,
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postScenarioEntry } from "@/app/api/scenarios/[scenarioSetId]/entries/route";
import { PATCH as patchScenarioEntry } from "@/app/api/scenarios/[scenarioSetId]/entries/[entryId]/route";

describe("scenario entry routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    scenarioSetMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Downtown alternatives",
        baseline_entry_id: null,
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    runsMaybeSingleMock.mockResolvedValue({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "Baseline run",
      },
      error: null,
    });

    entrySingleMock.mockResolvedValue({
      data: {
        id: "66666666-6666-4666-8666-666666666666",
        entry_type: "baseline",
        label: "Existing conditions",
      },
      error: null,
    });

    existingEntryMaybeSingleMock.mockResolvedValue({
      data: {
        id: "66666666-6666-4666-8666-666666666666",
        scenario_set_id: "11111111-1111-4111-8111-111111111111",
        entry_type: "alternative",
        label: "Protected bike package",
        attached_run_id: "55555555-5555-4555-8555-555555555555",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("POST creates a baseline entry", async () => {
    const response = await postScenarioEntry(
      new NextRequest("http://localhost/api/scenarios/1/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType: "baseline",
          label: "Existing conditions",
          attachedRunId: "55555555-5555-4555-8555-555555555555",
          assumptions: { horizon: 2045 },
        }),
      }),
      {
        params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(201);
    expect(entryInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario_set_id: "11111111-1111-4111-8111-111111111111",
        entry_type: "baseline",
        attached_run_id: "55555555-5555-4555-8555-555555555555",
      })
    );
  });

  it("POST rejects a second baseline when one already exists", async () => {
    scenarioSetMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        baseline_entry_id: "existing-baseline",
      },
      error: null,
    });

    const response = await postScenarioEntry(
      new NextRequest("http://localhost/api/scenarios/1/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType: "baseline",
          label: "Duplicate baseline",
        }),
      }),
      {
        params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "This scenario set already has a baseline entry" });
  });

  it("PATCH updates an entry", async () => {
    const response = await patchScenarioEntry(
      new NextRequest("http://localhost/api/scenarios/1/entries/2", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Updated alternative",
          status: "ready",
          attachedRunId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
      {
        params: Promise.resolve({
          scenarioSetId: "11111111-1111-4111-8111-111111111111",
          entryId: "66666666-6666-4666-8666-666666666666",
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(entryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Updated alternative",
        status: "ready",
        attached_run_id: "55555555-5555-4555-8555-555555555555",
      })
    );
  });

  it("PATCH rejects promoting an alternative when another baseline already exists", async () => {
    scenarioSetMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        baseline_entry_id: "existing-baseline",
      },
      error: null,
    });

    const response = await patchScenarioEntry(
      new NextRequest("http://localhost/api/scenarios/1/entries/2", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType: "baseline",
        }),
      }),
      {
        params: Promise.resolve({
          scenarioSetId: "11111111-1111-4111-8111-111111111111",
          entryId: "66666666-6666-4666-8666-666666666666",
        }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "This scenario set already has a baseline entry" });
  });
});
