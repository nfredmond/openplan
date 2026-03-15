import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const scenarioSetMaybeSingleMock = vi.fn();
const scenarioSetEqMock = vi.fn(() => ({ maybeSingle: scenarioSetMaybeSingleMock }));
const scenarioSetSelectMock = vi.fn(() => ({ eq: scenarioSetEqMock }));
const scenarioSetUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const scenarioSetUpdateMock = vi.fn(() => ({ eq: scenarioSetUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const entriesOrderCreatedAtMock = vi.fn();
const entriesOrderSortMock = vi.fn(() => ({ order: entriesOrderCreatedAtMock }));
const entriesEqScenarioSetMock = vi.fn(() => ({ order: entriesOrderSortMock, maybeSingle: baselineMaybeSingleMock }));
const entriesEqIdMock = vi.fn(() => ({
  eq: entriesEqScenarioSetMock,
  order: entriesOrderSortMock,
  maybeSingle: baselineMaybeSingleMock,
}));

const runsInMock = vi.fn();
const runsSelectMock = vi.fn(() => ({ in: runsInMock }));

const reportsOrderMock = vi.fn();
const reportsEqProjectMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqProjectMock }));

const reportRunsInMock = vi.fn();
const reportRunsSelectMock = vi.fn(() => ({ in: reportRunsInMock }));

const baselineMaybeSingleMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "scenario_sets") {
    return {
      select: scenarioSetSelectMock,
      update: scenarioSetUpdateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "scenario_entries") {
    return {
      select: () => ({ eq: entriesEqIdMock }),
    };
  }

  if (table === "runs") {
    return {
      select: runsSelectMock,
    };
  }

  if (table === "reports") {
    return {
      select: reportsSelectMock,
    };
  }

  if (table === "report_runs") {
    return {
      select: reportRunsSelectMock,
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

import { GET as getScenarioDetail, PATCH as patchScenarioDetail } from "@/app/api/scenarios/[scenarioSetId]/route";

describe("/api/scenarios/[scenarioSetId]", () => {
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
        status: "draft",
        baseline_entry_id: "55555555-5555-4555-8555-555555555555",
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

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Downtown safety project",
        updated_at: "2026-03-14T10:00:00.000Z",
      },
      error: null,
    });

    entriesOrderCreatedAtMock.mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          entry_type: "baseline",
          label: "Existing conditions",
          attached_run_id: "66666666-6666-4666-8666-666666666666",
          assumptions_json: {},
          sort_order: 0,
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          entry_type: "alternative",
          label: "Protected bike package",
          attached_run_id: "88888888-8888-4888-8888-888888888888",
          assumptions_json: {},
          sort_order: 1,
        },
      ],
      error: null,
    });

    runsInMock.mockResolvedValue({
      data: [
        { id: "66666666-6666-4666-8666-666666666666", title: "Baseline run" },
        { id: "88888888-8888-4888-8888-888888888888", title: "Alternative run" },
      ],
      error: null,
    });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          title: "Protected bike packet",
          status: "generated",
          report_type: "analysis_summary",
          generated_at: "2026-03-14T11:00:00.000Z",
          updated_at: "2026-03-14T11:00:00.000Z",
        },
      ],
      error: null,
    });

    reportRunsInMock.mockResolvedValue({
      data: [
        { report_id: "99999999-9999-4999-8999-999999999999", run_id: "66666666-6666-4666-8666-666666666666" },
        { report_id: "99999999-9999-4999-8999-999999999999", run_id: "88888888-8888-4888-8888-888888888888" },
      ],
      error: null,
    });

    baselineMaybeSingleMock.mockResolvedValue({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        scenario_set_id: "11111111-1111-4111-8111-111111111111",
        entry_type: "baseline",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns detail payload with baseline and alternatives", async () => {
    const response = await getScenarioDetail(new NextRequest("http://localhost/api/scenarios/1"), {
      params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scenarioSet: {
        id: "11111111-1111-4111-8111-111111111111",
      },
      baselineEntry: {
        id: "55555555-5555-4555-8555-555555555555",
      },
      alternativeEntries: [expect.objectContaining({ id: "77777777-7777-4777-8777-777777777777" })],
      comparisons: [
        expect.objectContaining({
          comparisonStatus: "ready",
          comparisonLabel: "Ready to compare",
          ready: true,
          analysisHref:
            "/explore?runId=88888888-8888-4888-8888-888888888888&baselineRunId=66666666-6666-4666-8666-666666666666&scenarioSetId=11111111-1111-4111-8111-111111111111&entryId=77777777-7777-4777-8777-777777777777#analysis-run-history",
        }),
      ],
      comparisonSummary: {
        totalAlternatives: 1,
        readyAlternatives: 1,
        blockedAlternatives: 0,
        baselineEntryPresent: true,
        baselineRunPresent: true,
      },
      linkedReports: [
        expect.objectContaining({
          id: "99999999-9999-4999-8999-999999999999",
          comparisonReady: true,
          matchedEntryLabels: expect.arrayContaining(["Existing conditions", "Protected bike package"]),
        }),
      ],
    });
  });

  it("PATCH returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await patchScenarioDetail(
      new NextRequest("http://localhost/api/scenarios/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated set" }),
      }),
      {
        params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("PATCH updates metadata and baseline pointer", async () => {
    const response = await patchScenarioDetail(
      new NextRequest("http://localhost/api/scenarios/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated set",
          status: "active",
          baselineEntryId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
      {
        params: Promise.resolve({ scenarioSetId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(scenarioSetUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated set",
        status: "active",
        baseline_entry_id: "55555555-5555-4555-8555-555555555555",
      })
    );
  });
});
