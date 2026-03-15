import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_CREATED_ID = "99999999-9999-4999-8999-999999999999";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const SCENARIO_ID = "55555555-5555-4555-8555-555555555555";
const CAMPAIGN_ID = "66666666-6666-4666-8666-666666666666";
const REPORT_ID = "77777777-7777-4777-8777-777777777777";

const plansOrderMock = vi.fn();
const plansSelectMock = vi.fn(() => ({ order: plansOrderMock }));
const plansSingleMock = vi.fn();
const plansInsertSelectMock = vi.fn(() => ({ single: plansSingleMock }));
const plansInsertMock = vi.fn(() => ({ select: plansInsertSelectMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const planLinksInMock = vi.fn();
const planLinksSelectMock = vi.fn(() => ({ in: planLinksInMock }));
const planLinksInsertMock = vi.fn();

const scenarioProjectInMock = vi.fn();
const scenarioWorkspaceInMock = vi.fn();
const scenarioEqWorkspaceMock = vi.fn(() => ({ in: scenarioWorkspaceInMock }));
const scenarioSelectMock = vi.fn((columns: string) => {
  if (columns === "id, project_id") {
    return { in: scenarioProjectInMock };
  }
  return { eq: scenarioEqWorkspaceMock };
});

const engagementProjectInMock = vi.fn();
const engagementWorkspaceInMock = vi.fn();
const engagementEqWorkspaceMock = vi.fn(() => ({ in: engagementWorkspaceInMock }));
const engagementSelectMock = vi.fn((columns: string) => {
  if (columns === "id, project_id") {
    return { in: engagementProjectInMock };
  }
  return { eq: engagementEqWorkspaceMock };
});

const reportsProjectInMock = vi.fn();
const reportsWorkspaceInMock = vi.fn();
const reportsEqWorkspaceMock = vi.fn(() => ({ in: reportsWorkspaceInMock }));
const reportsSelectMock = vi.fn((columns: string) => {
  if (columns === "id, project_id") {
    return { in: reportsProjectInMock };
  }
  return { eq: reportsEqWorkspaceMock };
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "plans") {
    return {
      select: plansSelectMock,
      insert: plansInsertMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "plan_links") {
    return {
      select: planLinksSelectMock,
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
      select: engagementSelectMock,
    };
  }

  if (table === "reports") {
    return {
      select: reportsSelectMock,
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

import { GET as getPlans, POST as postPlans } from "@/app/api/plans/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    plansOrderMock.mockResolvedValue({
      data: [
        {
          id: PLAN_ID,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title: "Downtown ATP",
          plan_type: "atp",
          status: "draft",
          geography_label: "Downtown",
          horizon_year: 2035,
          summary: "First pass",
          projects: { id: PROJECT_ID, name: "Downtown project" },
        },
      ],
      error: null,
    });

    planLinksInMock.mockResolvedValue({
      data: [{ plan_id: PLAN_ID, link_type: "scenario_set" }],
      error: null,
    });

    scenarioProjectInMock.mockResolvedValue({
      data: [{ id: SCENARIO_ID, project_id: PROJECT_ID }],
      error: null,
    });

    engagementProjectInMock.mockResolvedValue({
      data: [{ id: CAMPAIGN_ID, project_id: PROJECT_ID }],
      error: null,
    });

    reportsProjectInMock.mockResolvedValue({
      data: [{ id: REPORT_ID, project_id: PROJECT_ID }],
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: "Downtown project",
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

    scenarioWorkspaceInMock.mockResolvedValue({
      data: [{ id: SCENARIO_ID, workspace_id: WORKSPACE_ID, title: "Scenario set" }],
      error: null,
    });

    engagementWorkspaceInMock.mockResolvedValue({
      data: [{ id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID, title: "Campaign" }],
      error: null,
    });

    reportsWorkspaceInMock.mockResolvedValue({
      data: [{ id: REPORT_ID, workspace_id: WORKSPACE_ID, title: "Packet" }],
      error: null,
    });

    plansSingleMock.mockResolvedValue({
      data: {
        id: PLAN_CREATED_ID,
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

    planLinksInsertMock.mockResolvedValue({ error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns the plan catalog with linkage-derived readiness", async () => {
    const response = await getPlans(new NextRequest("http://localhost/api/plans"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      plans: [
        expect.objectContaining({
          id: PLAN_ID,
          linkageCounts: {
            scenarios: 2,
            engagementCampaigns: 1,
            reports: 1,
            relatedProjects: 1,
          },
          artifactCoverage: expect.objectContaining({
            label: "Inputs and outputs linked",
          }),
          readiness: expect.objectContaining({
            ready: true,
            readyCheckCount: 6,
          }),
        }),
      ],
    });
  });

  it("POST creates a plan and stores explicit plan links", async () => {
    const response = await postPlans(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "Downtown ATP",
        planType: "atp",
        geographyLabel: "Downtown",
        horizonYear: 2035,
        links: [{ linkType: "scenario_set", linkedId: SCENARIO_ID }],
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      planId: PLAN_CREATED_ID,
      plan: expect.objectContaining({
        title: "Downtown ATP",
      }),
    });
    expect(plansInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
    expect(planLinksInsertMock).toHaveBeenCalledWith([
      {
        plan_id: PLAN_CREATED_ID,
        link_type: "scenario_set",
        linked_id: SCENARIO_ID,
        label: "Scenario set",
        created_by: "22222222-2222-4222-8222-222222222222",
      },
    ]);
  });
});
