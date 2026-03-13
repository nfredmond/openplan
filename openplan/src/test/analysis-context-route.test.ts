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
const projectEqWorkspaceMock = vi.fn(() => ({ order: projectOrderMock }));
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
          geography_scope: "corridor",
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
      linkedDatasets: Array<{ name: string; connectorLabel: string | null; overlayReady: boolean }>;
    };

    expect(payload.project).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Nevada County Safety Action Program",
      planType: "safety_plan",
    });

    expect(payload.counts).toMatchObject({
      linkedDatasets: 1,
      overlayReadyDatasets: 1,
      recentRuns: 1,
    });

    expect(payload.linkedDatasets[0]).toMatchObject({
      name: "Nevada County Equity Indicators",
      connectorLabel: "Census ACS 5-Year",
      overlayReady: true,
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
});
