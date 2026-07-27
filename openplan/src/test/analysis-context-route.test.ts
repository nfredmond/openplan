import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const fromMock = vi.fn();

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectLimitMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectOrderMock = vi.fn(() => ({ limit: projectLimitMock }));
// The explicit-projectId path chains a second .eq(id) then .maybeSingle();
// the default path chains .order().limit().maybeSingle().
const projectEqIdMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectEqWorkspaceMock = vi.fn(() => ({ order: projectOrderMock, eq: projectEqIdMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqWorkspaceMock }));

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqWorkspaceMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqWorkspaceMock }));

const deliverablesEqProjectMock = vi.fn();
const deliverablesSelectMock = vi.fn(() => ({ eq: deliverablesEqProjectMock }));
const risksEqProjectMock = vi.fn();
const risksSelectMock = vi.fn(() => ({ eq: risksEqProjectMock }));
const issuesEqProjectMock = vi.fn();
const issuesSelectMock = vi.fn(() => ({ eq: issuesEqProjectMock }));
const decisionsEqProjectMock = vi.fn();
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqProjectMock }));
const meetingsEqProjectMock = vi.fn();
const meetingsSelectMock = vi.fn(() => ({ eq: meetingsEqProjectMock }));

const datasetLinksOrderMock = vi.fn();
const datasetLinksEqProjectMock = vi.fn(() => ({ order: datasetLinksOrderMock }));
const datasetLinksSelectMock = vi.fn(() => ({ eq: datasetLinksEqProjectMock }));

const datasetsInMock = vi.fn();
const datasetsSelectMock = vi.fn(() => ({ in: datasetsInMock }));

const connectorsInMock = vi.fn();
const connectorsSelectMock = vi.fn(() => ({ in: connectorsInMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getAnalysisContext } from "@/app/api/analysis/context/route";

describe("GET /api/analysis/context", () => {
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

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "member" },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County Safety Action Program",
        summary: "Countywide safety planning workspace.",
        status: "active",
        plan_type: "safety_plan",
        delivery_phase: "analysis",
        updated_at: "2026-03-13T18:00:00.000Z",
      },
      error: null,
    });

    runsLimitMock.mockResolvedValue({
      data: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          title: "Baseline corridor screening",
          created_at: "2026-03-13T17:00:00.000Z",
        },
      ],
      error: null,
    });

    deliverablesEqProjectMock.mockResolvedValue({ data: [{ id: "d1" }, { id: "d2" }], error: null });
    risksEqProjectMock.mockResolvedValue({ data: [{ id: "r1" }], error: null });
    issuesEqProjectMock.mockResolvedValue({ data: [{ id: "i1" }], error: null });
    decisionsEqProjectMock.mockResolvedValue({ data: [{ id: "dc1" }], error: null });
    meetingsEqProjectMock.mockResolvedValue({ data: [{ id: "m1" }], error: null });

    datasetLinksOrderMock.mockResolvedValue({
      data: [
        {
          dataset_id: "55555555-5555-4555-8555-555555555555",
          relationship_type: "primary_input",
          linked_at: "2026-03-13T16:00:00.000Z",
        },
      ],
      error: null,
    });

    datasetsInMock.mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          connector_id: "66666666-6666-4666-8666-666666666666",
          name: "Nevada County Equity Indicators",
          status: "ready",
          geography_scope: "tract",
          geometry_attachment: "analysis_tracts",
          thematic_metric_key: "pctBelowPoverty",
          thematic_metric_label: "Poverty share",
          vintage_label: "ACS 2023",
          last_refreshed_at: "2026-03-13T15:00:00.000Z",
        },
      ],
      error: null,
    });

    connectorsInMock.mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          display_name: "Census ACS 5-Year",
        },
      ],
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "workspace_members") {
        return { select: membershipSelectMock };
      }

      if (table === "projects") {
        return { select: projectSelectMock };
      }

      if (table === "runs") {
        return { select: runsSelectMock };
      }

      if (table === "project_deliverables") {
        return { select: deliverablesSelectMock };
      }

      if (table === "project_risks") {
        return { select: risksSelectMock };
      }

      if (table === "project_issues") {
        return { select: issuesSelectMock };
      }

      if (table === "project_decisions") {
        return { select: decisionsSelectMock };
      }

      if (table === "project_meetings") {
        return { select: meetingsSelectMock };
      }

      if (table === "data_dataset_project_links") {
        return { select: datasetLinksSelectMock };
      }

      if (table === "data_datasets") {
        return { select: datasetsSelectMock };
      }

      if (table === "data_connectors") {
        return { select: connectorsSelectMock };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getAnalysisContext(
      new NextRequest("http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111")
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns project and linked dataset context", async () => {
    const response = await getAnalysisContext(
      new NextRequest("http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111")
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      project: { id: string; name: string; planType: string } | null;
      counts: { linkedDatasets: number; overlayReadyDatasets: number; recentRuns: number };
      linkedDatasets: Array<{
        name: string;
        connectorLabel: string | null;
        overlayReady: boolean;
        thematicReady: boolean;
        thematicMetricKey: string | null;
      }>;
    };

    expect(payload.project).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Nevada County Safety Action Program",
      planType: "safety_plan",
    });
    // No projectId param → the project is a recency fallback, and the
    // response says so instead of presenting the guess as a choice.
    expect((payload as { projectSelection?: string }).projectSelection).toBe("defaulted");

    expect(payload.counts).toMatchObject({
      linkedDatasets: 1,
      overlayReadyDatasets: 1,
      recentRuns: 1,
    });

    expect(payload.linkedDatasets[0]).toMatchObject({
      name: "Nevada County Equity Indicators",
      connectorLabel: "Census ACS 5-Year",
      overlayReady: true,
      thematicReady: true,
      thematicMetricKey: "pctBelowPoverty",
    });
  });

  it("marks corridor-attached datasets as thematic-ready", async () => {
    datasetsInMock.mockResolvedValueOnce({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          connector_id: "66666666-6666-4666-8666-666666666666",
          name: "Nevada County Corridor Safety Composite",
          status: "ready",
          geography_scope: "corridor",
          geometry_attachment: "analysis_corridor",
          thematic_metric_key: "safetyScore",
          thematic_metric_label: "Safety score",
          vintage_label: "OpenPlan Live",
          last_refreshed_at: "2026-03-13T15:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await getAnalysisContext(
      new NextRequest("http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111")
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      linkedDatasets: Array<{ thematicReady: boolean; geometryAttachment: string; thematicMetricKey: string | null }>;
    };

    expect(payload.linkedDatasets[0]).toMatchObject({
      thematicReady: true,
      geometryAttachment: "analysis_corridor",
      thematicMetricKey: "safetyScore",
    });
  });

  it("marks crash-point-attached datasets as thematic-ready", async () => {
    datasetsInMock.mockResolvedValueOnce({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          connector_id: "66666666-6666-4666-8666-666666666666",
          name: "Nevada County SWITRS Severity Layer",
          status: "ready",
          geography_scope: "point",
          geometry_attachment: "analysis_crash_points",
          thematic_metric_key: "severityBucket",
          thematic_metric_label: "Crash severity bucket",
          vintage_label: "SWITRS Local",
          last_refreshed_at: "2026-03-13T15:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await getAnalysisContext(
      new NextRequest("http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111")
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      linkedDatasets: Array<{ thematicReady: boolean; geometryAttachment: string; thematicMetricKey: string | null }>;
    };

    expect(payload.linkedDatasets[0]).toMatchObject({
      thematicReady: true,
      geometryAttachment: "analysis_crash_points",
      thematicMetricKey: "severityBucket",
    });
  });

  it("degrades cleanly when data hub schema is pending", async () => {
    datasetLinksOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation "data_dataset_project_links" does not exist', code: "42P01" },
    });

    const response = await getAnalysisContext(
      new NextRequest("http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111")
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      migrationPending: boolean;
      linkedDatasets: Array<unknown>;
      counts: { linkedDatasets: number; overlayReadyDatasets: number };
    };

    expect(payload.migrationPending).toBe(true);
    expect(payload.linkedDatasets).toEqual([]);
    expect(payload.counts).toMatchObject({ linkedDatasets: 0, overlayReadyDatasets: 0 });
  });

  it("pins the context to an explicitly requested project and says the choice was explicit", async () => {
    const response = await getAnalysisContext(
      new NextRequest(
        "http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111&projectId=33333333-3333-4333-8333-333333333333"
      )
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { project: { id: string } | null; projectSelection: string };

    expect(payload.project?.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(payload.projectSelection).toBe("explicit");
    // The explicit path filters by id instead of taking the most recent row.
    // (projectOrderMock cannot be asserted un-called here: the operations
    // summary loader also walks the mocked projects table.)
    expect(projectEqIdMock).toHaveBeenCalledWith("id", "33333333-3333-4333-8333-333333333333");
  });

  it("404s when the explicitly requested project is not in the workspace", async () => {
    projectMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await getAnalysisContext(
      new NextRequest(
        "http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111&projectId=99999999-9999-4999-8999-999999999999"
      )
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Project not found in workspace" });
  });

  it("400s on a malformed projectId instead of silently falling back", async () => {
    const response = await getAnalysisContext(
      new NextRequest(
        "http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111&projectId=not-a-uuid"
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid projectId" });
  });

  it("reports projectSelection none when the workspace has no projects", async () => {
    projectMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await getAnalysisContext(
      new NextRequest("http://localhost/api/analysis/context?workspaceId=11111111-1111-4111-8111-111111111111")
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { project: unknown; projectSelection: string };
    expect(payload.project).toBeNull();
    expect(payload.projectSelection).toBe("none");
  });
});
