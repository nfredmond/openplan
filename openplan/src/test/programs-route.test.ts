import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const PROGRAM_ID = "11111111-1111-4111-8111-111111111111";
const PROGRAM_CREATED_ID = "99999999-9999-4999-8999-999999999999";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

const programsOrderMock = vi.fn();
const programsSelectMock = vi.fn(() => ({ order: programsOrderMock }));
const programsSingleMock = vi.fn();
const programsInsertSelectMock = vi.fn(() => ({ single: programsSingleMock }));
const programsInsertMock = vi.fn(() => ({ select: programsInsertSelectMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipLimitMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipSelectMock = vi.fn(() => ({ eq: vi.fn((column: string) => (column === "workspace_id" ? { eq: membershipEqUserMock } : { limit: membershipLimitMock, maybeSingle: membershipMaybeSingleMock })) }));

const programLinksInMock = vi.fn();
const programLinksSelectMock = vi.fn(() => ({ in: programLinksInMock }));
const programLinksInsertMock = vi.fn();

const plansProjectInMock = vi.fn();
const plansWorkspaceInMock = vi.fn();
const plansEqWorkspaceMock = vi.fn(() => ({ in: plansWorkspaceInMock }));
const plansSelectRouteMock = vi.fn((columns: string) => {
  if (columns === "id, project_id") {
    return { in: plansProjectInMock };
  }
  return { eq: plansEqWorkspaceMock };
});

const reportsProjectInMock = vi.fn();
const reportsWorkspaceInMock = vi.fn();
const reportsExplicitInMock = vi.fn();
const reportsEqWorkspaceMock = vi.fn(() => ({ in: reportsWorkspaceInMock }));
const reportsSelectRouteMock = vi.fn((columns: string) => {
  if (columns === "id, project_id, status") {
    return { in: reportsProjectInMock };
  }
  if (columns === "id, status") {
    return { in: reportsExplicitInMock };
  }
  return { eq: reportsEqWorkspaceMock };
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

const reportArtifactsInMock = vi.fn();
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const engagementItemsInMock = vi.fn();
const engagementItemsSelectMock = vi.fn(() => ({ in: engagementItemsInMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "programs") {
    return {
      select: programsSelectMock,
      insert: programsInsertMock,
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
  if (table === "program_links") {
    return {
      select: programLinksSelectMock,
      insert: programLinksInsertMock,
    };
  }
  if (table === "plans") {
    return {
      select: plansSelectRouteMock,
    };
  }
  if (table === "reports") {
    return {
      select: reportsSelectRouteMock,
    };
  }
  if (table === "engagement_campaigns") {
    return {
      select: engagementSelectMock,
    };
  }
  if (table === "report_artifacts") {
    return {
      select: reportArtifactsSelectMock,
    };
  }
  if (table === "engagement_items") {
    return {
      select: engagementItemsSelectMock,
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

import { GET as getPrograms, POST as postPrograms } from "@/app/api/programs/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/programs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    programsOrderMock.mockResolvedValue({
      data: [
        {
          id: PROGRAM_ID,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title: "2027 RTIP Downtown package",
          program_type: "rtip",
          status: "assembling",
          cycle_name: "2027 RTIP",
          sponsor_agency: "NCTC",
          fiscal_year_start: 2027,
          fiscal_year_end: 2030,
          nomination_due_at: "2026-06-01T17:00:00.000Z",
          adoption_target_at: "2026-09-01T17:00:00.000Z",
          summary: "Downtown package",
          projects: { id: PROJECT_ID, name: "Downtown safety project" },
        },
      ],
      error: null,
    });

    programLinksInMock.mockResolvedValue({
      data: [
        { id: "link-1", program_id: PROGRAM_ID, link_type: "plan", linked_id: "plan-1", label: "Linked plan" },
        { id: "link-2", program_id: PROGRAM_ID, link_type: "report", linked_id: "report-1", label: "Linked report" },
      ],
      error: null,
    });

    plansProjectInMock.mockResolvedValue({
      data: [{ id: "plan-2", project_id: PROJECT_ID }],
      error: null,
    });

    reportsProjectInMock.mockResolvedValue({
      data: [{ id: "report-2", project_id: PROJECT_ID, status: "generated" }],
      error: null,
    });

    engagementProjectInMock.mockResolvedValue({
      data: [{ id: "campaign-1", project_id: PROJECT_ID }],
      error: null,
    });

    reportsExplicitInMock.mockResolvedValue({
      data: [{ id: "report-1", status: "generated" }],
      error: null,
    });

    reportArtifactsInMock.mockResolvedValue({
      data: [{ report_id: "report-1" }],
      error: null,
    });

    engagementItemsInMock.mockResolvedValue({
      data: [],
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: "Downtown safety project",
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

    programsSingleMock.mockResolvedValue({
      data: {
        id: PROGRAM_CREATED_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "2027 RTIP Downtown package",
        program_type: "rtip",
        status: "draft",
        cycle_name: "2027 RTIP",
      },
      error: null,
    });

    programLinksInsertMock.mockResolvedValue({ error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns the program catalog with readiness and linkage summaries", async () => {
    const response = await getPrograms(new NextRequest("http://localhost/api/programs"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      programs: [
        expect.objectContaining({
          id: PROGRAM_ID,
          linkageCounts: {
            plans: 2,
            reports: 2,
            engagementCampaigns: 1,
            relatedProjects: 1,
            reportArtifacts: 1,
          },
          readiness: expect.objectContaining({
            ready: true,
            readyCheckCount: 8,
          }),
          workflow: expect.objectContaining({
            label: "Ready for package assembly",
          }),
        }),
      ],
      summary: {
        byStatus: { assembling: 1 },
        byType: { rtip: 1 },
      },
    });
  });

  it("POST creates a program record", async () => {
    const response = await postPrograms(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "2027 RTIP Downtown package",
        programType: "rtip",
        cycleName: "2027 RTIP",
        fiscalYearStart: 2027,
        fiscalYearEnd: 2030,
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      programId: PROGRAM_CREATED_ID,
    });
    expect(programsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "2027 RTIP Downtown package",
        program_type: "rtip",
        cycle_name: "2027 RTIP",
      })
    );
  });
});
