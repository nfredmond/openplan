import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const scenarioSetsOrderMock = vi.fn();
const scenarioSetsEqStatusMock = vi.fn(() => ({ order: scenarioSetsOrderMock }));
const scenarioSetsEqProjectMock = vi.fn(() => ({ eq: scenarioSetsEqStatusMock, order: scenarioSetsOrderMock }));
const scenarioSetsSelectMock = vi.fn(() => ({ eq: scenarioSetsEqProjectMock, order: scenarioSetsOrderMock }));
const scenarioSetsSingleMock = vi.fn();
const scenarioSetsInsertSelectMock = vi.fn(() => ({ single: scenarioSetsSingleMock }));
const scenarioSetsInsertMock = vi.fn(() => ({ select: scenarioSetsInsertSelectMock }));

const projectsMaybeSingleMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ maybeSingle: projectsMaybeSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const entriesInMock = vi.fn();
const entriesSelectMock = vi.fn(() => ({ in: entriesInMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "scenario_sets") {
    return {
      select: scenarioSetsSelectMock,
      insert: scenarioSetsInsertMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectsSelectMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "scenario_entries") {
    return {
      select: entriesSelectMock,
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

import { GET as getScenarios, POST as postScenarios } from "@/app/api/scenarios/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/scenarios", () => {
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

    scenarioSetsOrderMock.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          project_id: "33333333-3333-4333-8333-333333333333",
          title: "Downtown alternatives",
          status: "active",
        },
      ],
      error: null,
    });

    entriesInMock.mockResolvedValue({
      data: [
        { scenario_set_id: "11111111-1111-4111-8111-111111111111", entry_type: "baseline" },
        { scenario_set_id: "11111111-1111-4111-8111-111111111111", entry_type: "alternative" },
      ],
      error: null,
    });

    projectsMaybeSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        name: "Downtown safety project",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "44444444-4444-4444-8444-444444444444",
        role: "member",
      },
      error: null,
    });

    scenarioSetsSingleMock.mockResolvedValue({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: "33333333-3333-4333-8333-333333333333",
        title: "Downtown alternatives",
        status: "draft",
        baseline_entry_id: null,
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getScenarios(new NextRequest("http://localhost/api/scenarios"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("GET returns scenario sets with baseline and alternative counts", async () => {
    const response = await getScenarios(new NextRequest("http://localhost/api/scenarios"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scenarioSets: [
        expect.objectContaining({
          id: "11111111-1111-4111-8111-111111111111",
          counts: {
            baselineCount: 1,
            alternativeCount: 1,
          },
        }),
      ],
    });
  });

  it("POST creates a scenario set for an accessible project", async () => {
    const response = await postScenarios(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        title: "Downtown alternatives",
        summary: "Compare low-build and high-comfort packages.",
        planningQuestion: "Which package is the best near-term programming candidate?",
      })
    );

    expect(response.status).toBe(201);
    expect(scenarioSetsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: "33333333-3333-4333-8333-333333333333",
        title: "Downtown alternatives",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
  });

  it("POST returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "44444444-4444-4444-8444-444444444444",
        role: "viewer",
      },
      error: null,
    });

    const response = await postScenarios(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        title: "Downtown alternatives",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });
});
