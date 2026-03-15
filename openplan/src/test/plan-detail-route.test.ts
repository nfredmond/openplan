import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const SCENARIO_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const SCENARIO_EXPLICIT_ID = "66666666-6666-4666-8666-666666666666";

const planMaybeSingleMock = vi.fn();
const planEqMock = vi.fn(() => ({ maybeSingle: planMaybeSingleMock }));
const planSelectMock = vi.fn(() => ({ eq: planEqMock }));
const planUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const planUpdateMock = vi.fn(() => ({ eq: planUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectInMock = vi.fn();
const projectSelectMock = vi.fn((columns: string) => {
  if (columns.includes("workspace_id")) {
    return { in: projectInMock, eq: projectEqMock };
  }
  return { eq: projectEqMock };
});

const planLinksEqMock = vi.fn();
const planLinksSelectMock = vi.fn(() => ({ eq: planLinksEqMock }));
const planLinksDeleteEqMock = vi.fn().mockResolvedValue({ error: null });
const planLinksDeleteMock = vi.fn(() => ({ eq: planLinksDeleteEqMock }));
const planLinksInsertMock = vi.fn().mockResolvedValue({ error: null });

const scenarioOrderMock = vi.fn();
const scenarioWorkspaceInMock = vi.fn();
const scenarioEqMock = vi.fn(() => ({ order: scenarioOrderMock, in: scenarioWorkspaceInMock }));
const scenarioInMock = vi.fn();
const scenarioSelectMock = vi.fn((columns: string) => {
  if (columns.includes("project_id")) {
    return { eq: scenarioEqMock, in: scenarioInMock };
  }
  return { eq: scenarioEqMock };
});

const campaignOrderMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ order: campaignOrderMock }));
const campaignInMock = vi.fn();
const campaignSelectMock = vi.fn((columns: string) => {
  if (columns.includes("project_id")) {
    return { eq: campaignEqMock, in: campaignInMock };
  }
  return { eq: campaignEqMock };
});

const reportOrderMock = vi.fn();
const reportEqMock = vi.fn(() => ({ order: reportOrderMock }));
const reportInMock = vi.fn();
const reportSelectMock = vi.fn((columns: string) => {
  if (columns.includes("project_id")) {
    return { eq: reportEqMock, in: reportInMock };
  }
  return { eq: reportEqMock };
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "plans") {
    return {
      select: planSelectMock,
      update: planUpdateMock,
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

  if (table === "plan_links") {
    return {
      select: planLinksSelectMock,
      delete: planLinksDeleteMock,
      insert: planLinksInsertMock,
    };
  }

  if (table === "scenario_sets") {
    return {
      select: scenarioSelectMock,
    };
  }

  if (table === "engagement_campaigns") {
    return {
      select: campaignSelectMock,
    };
  }

  if (table === "reports") {
    return {
      select: reportSelectMock,
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

import { GET as getPlanDetail, PATCH as patchPlanDetail } from "@/app/api/plans/[planId]/route";

describe("/api/plans/[planId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    planMaybeSingleMock.mockResolvedValue({
      data: {
        id: PLAN_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "Downtown ATP",
        plan_type: "atp",
        status: "draft",
        geography_label: "Downtown",
        horizon_year: 2035,
        summary: "First pass",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: WORKSPACE_ID,
        role: "member",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: "Downtown project",
        summary: "Anchor project",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        updated_at: "2026-03-15T08:00:00.000Z",
      },
      error: null,
    });

    planLinksEqMock.mockResolvedValue({
      data: [
        {
          id: "link-1",
          plan_id: PLAN_ID,
          link_type: "scenario_set",
          linked_id: SCENARIO_EXPLICIT_ID,
          label: "Explicit scenario",
          updated_at: "2026-03-15T08:30:00.000Z",
        },
      ],
      error: null,
    });

    scenarioOrderMock.mockResolvedValue({
      data: [{ id: SCENARIO_PROJECT_ID, project_id: PROJECT_ID, title: "Project scenario", status: "active", updated_at: "2026-03-15T09:00:00.000Z" }],
      error: null,
    });
    scenarioInMock.mockResolvedValue({
      data: [{ id: SCENARIO_EXPLICIT_ID, project_id: null, title: "Explicit scenario", status: "draft", updated_at: "2026-03-15T10:00:00.000Z" }],
      error: null,
    });
    scenarioWorkspaceInMock.mockResolvedValue({
      data: [{ id: SCENARIO_EXPLICIT_ID, workspace_id: WORKSPACE_ID, title: "Explicit scenario" }],
      error: null,
    });

    campaignOrderMock.mockResolvedValue({ data: [], error: null });
    campaignInMock.mockResolvedValue({ data: [], error: null });
    reportOrderMock.mockResolvedValue({ data: [], error: null });
    reportInMock.mockResolvedValue({ data: [], error: null });
    projectInMock.mockResolvedValue({ data: [], error: null });

    planLinksInsertMock.mockResolvedValue({ error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns merged project-derived and explicit plan link detail", async () => {
    const response = await getPlanDetail(new NextRequest("http://localhost/api/plans/plan-1"), {
      params: Promise.resolve({ planId: PLAN_ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      plan: expect.objectContaining({ id: PLAN_ID }),
      linkedScenarios: expect.arrayContaining([
        expect.objectContaining({ id: SCENARIO_PROJECT_ID, linkBasis: "project" }),
        expect.objectContaining({ id: SCENARIO_EXPLICIT_ID, linkBasis: "plan_link" }),
      ]),
      readiness: expect.objectContaining({
        ready: false,
        readyCheckCount: 4,
      }),
    });
  });

  it("PATCH updates plan metadata and replaces plan links", async () => {
    planMaybeSingleMock
      .mockResolvedValueOnce({
        data: {
          id: PLAN_ID,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title: "Downtown ATP",
          plan_type: "atp",
          status: "draft",
          geography_label: "Downtown",
          horizon_year: 2035,
          summary: "First pass",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: PLAN_ID,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title: "Updated ATP",
          plan_type: "atp",
          status: "active",
          geography_label: "Downtown",
          horizon_year: 2040,
          summary: "Updated basis",
        },
        error: null,
      });

    const response = await patchPlanDetail(
      new NextRequest("http://localhost/api/plans/plan-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated ATP",
          status: "active",
          horizonYear: 2040,
          summary: "Updated basis",
          links: [{ linkType: "scenario_set", linkedId: SCENARIO_EXPLICIT_ID }],
        }),
      }),
      {
        params: Promise.resolve({ planId: PLAN_ID }),
      }
    );

    expect(response.status).toBe(200);
    expect(planUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated ATP",
        status: "active",
        horizon_year: 2040,
        summary: "Updated basis",
      })
    );
    expect(planLinksDeleteMock).toHaveBeenCalled();
    expect(planLinksInsertMock).toHaveBeenCalledWith([
      {
        plan_id: PLAN_ID,
        link_type: "scenario_set",
        linked_id: SCENARIO_EXPLICIT_ID,
        label: "Explicit scenario",
        created_by: "22222222-2222-4222-8222-222222222222",
      },
    ]);
  });
});
