import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const PROGRAM_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const PLAN_ID = "55555555-5555-4555-8555-555555555555";
const REPORT_ID = "66666666-6666-4666-8666-666666666666";
const CAMPAIGN_ID = "77777777-7777-4777-8777-777777777777";

const programMaybeSingleMock = vi.fn();
const programEqMock = vi.fn(() => ({ maybeSingle: programMaybeSingleMock }));
const programSelectMock = vi.fn(() => ({ eq: programEqMock }));
const programUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const programUpdateMock = vi.fn(() => ({ eq: programUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectInMock = vi.fn();
const projectSelectMock = vi.fn((columns: string) => {
  if (columns.includes("workspace_id, name")) {
    return { in: projectInMock, eq: projectEqMock };
  }
  return { eq: projectEqMock };
});

const programLinksEqMock = vi.fn();
const programLinksSelectMock = vi.fn(() => ({ eq: programLinksEqMock }));
const programLinksDeleteEqMock = vi.fn().mockResolvedValue({ error: null });
const programLinksDeleteMock = vi.fn(() => ({ eq: programLinksDeleteEqMock }));
const programLinksInsertMock = vi.fn().mockResolvedValue({ error: null });

const plansOrderMock = vi.fn();
const plansEqProjectMock = vi.fn(() => ({ order: plansOrderMock }));
const plansInMock = vi.fn();
const plansWorkspaceInMock = vi.fn();
const plansEqWorkspaceMock = vi.fn(() => ({ in: plansWorkspaceInMock }));
const plansSelectMock = vi.fn((columns: string) => {
  if (columns.includes("project_id")) {
    return { eq: plansEqProjectMock, in: plansInMock };
  }
  return { eq: plansEqWorkspaceMock };
});

const reportsOrderMock = vi.fn();
const reportsEqProjectMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsInMock = vi.fn();
const reportsWorkspaceInMock = vi.fn();
const reportsEqWorkspaceMock = vi.fn(() => ({ in: reportsWorkspaceInMock }));
const reportsSelectMock = vi.fn((columns: string) => {
  if (columns.includes("project_id")) {
    return { eq: reportsEqProjectMock, in: reportsInMock };
  }
  return { eq: reportsEqWorkspaceMock };
});

const campaignsOrderMock = vi.fn();
const campaignsEqProjectMock = vi.fn(() => ({ order: campaignsOrderMock }));
const campaignsInMock = vi.fn();
const campaignsWorkspaceInMock = vi.fn();
const campaignsEqWorkspaceMock = vi.fn(() => ({ in: campaignsWorkspaceInMock }));
const campaignsSelectMock = vi.fn((columns: string) => {
  if (columns.includes("project_id")) {
    return { eq: campaignsEqProjectMock, in: campaignsInMock };
  }
  return { eq: campaignsEqWorkspaceMock };
});

const engagementItemsInMock = vi.fn();
const engagementItemsSelectMock = vi.fn(() => ({ in: engagementItemsInMock }));

const reportArtifactsInMock = vi.fn();
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "programs") {
    return {
      select: programSelectMock,
      update: programUpdateMock,
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
  if (table === "program_links") {
    return {
      select: programLinksSelectMock,
      delete: programLinksDeleteMock,
      insert: programLinksInsertMock,
    };
  }
  if (table === "plans") {
    return {
      select: plansSelectMock,
    };
  }
  if (table === "reports") {
    return {
      select: reportsSelectMock,
    };
  }
  if (table === "engagement_campaigns") {
    return {
      select: campaignsSelectMock,
    };
  }
  if (table === "engagement_items") {
    return {
      select: engagementItemsSelectMock,
    };
  }
  if (table === "report_artifacts") {
    return {
      select: reportArtifactsSelectMock,
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

import { GET as getProgramDetail, PATCH as patchProgramDetail } from "@/app/api/programs/[programId]/route";

describe("/api/programs/[programId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    programMaybeSingleMock.mockResolvedValue({
      data: {
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
        name: "Downtown safety project",
        summary: "Anchor project",
        status: "active",
        plan_type: "corridor",
        delivery_phase: "programming",
        updated_at: "2026-03-15T08:00:00.000Z",
      },
      error: null,
    });

    programLinksEqMock.mockResolvedValue({
      data: [{ id: "link-1", program_id: PROGRAM_ID, link_type: "report", linked_id: REPORT_ID, label: "Packet" }],
      error: null,
    });

    plansOrderMock.mockResolvedValue({
      data: [
        {
          id: PLAN_ID,
          project_id: PROJECT_ID,
          title: "Downtown ATP",
          plan_type: "atp",
          status: "adopted",
          summary: "Package basis",
          geography_label: "Downtown",
          horizon_year: 2035,
          updated_at: "2026-03-15T09:00:00.000Z",
        },
      ],
      error: null,
    });

    reportsOrderMock.mockResolvedValue({
      data: [],
      error: null,
    });

    campaignsOrderMock.mockResolvedValue({
      data: [
        {
          id: CAMPAIGN_ID,
          project_id: PROJECT_ID,
          title: "Outreach round",
          summary: "Engagement evidence",
          status: "closed",
          engagement_type: "comment_collection",
          updated_at: "2026-03-15T10:00:00.000Z",
        },
      ],
      error: null,
    });

    plansWorkspaceInMock.mockResolvedValue({
      data: [{ id: PLAN_ID, workspace_id: WORKSPACE_ID, title: "Downtown ATP" }],
      error: null,
    });
    plansInMock.mockResolvedValue({ data: [], error: null });
    reportsInMock.mockResolvedValue({
      data: [
        {
          id: REPORT_ID,
          project_id: PROJECT_ID,
          title: "Board packet",
          report_type: "board_packet",
          status: "generated",
          summary: "Packet output",
          generated_at: "2026-03-15T11:00:00.000Z",
          latest_artifact_kind: "html",
          updated_at: "2026-03-15T11:00:00.000Z",
        },
      ],
      error: null,
    });
    campaignsInMock.mockResolvedValue({ data: [], error: null });
    projectInMock.mockResolvedValue({ data: [], error: null });

    engagementItemsInMock.mockResolvedValue({
      data: [
        { campaign_id: CAMPAIGN_ID, status: "approved" },
        { campaign_id: CAMPAIGN_ID, status: "pending" },
      ],
      error: null,
    });

    reportArtifactsInMock.mockResolvedValue({
      data: [{ report_id: REPORT_ID }],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns detail readiness and merged related records", async () => {
    const response = await getProgramDetail(new NextRequest(`http://localhost/api/programs/${PROGRAM_ID}`), {
      params: Promise.resolve({ programId: PROGRAM_ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      program: expect.objectContaining({ id: PROGRAM_ID }),
      relatedRecords: {
        plans: [expect.objectContaining({ id: PLAN_ID, linkBasis: "project" })],
        reports: [expect.objectContaining({ id: REPORT_ID, linkBasis: "program_link", artifactCount: 1 })],
        engagementCampaigns: [expect.objectContaining({ id: CAMPAIGN_ID, approvedItemCount: 1, pendingItemCount: 1 })],
        projects: [expect.objectContaining({ id: PROJECT_ID, linkBasis: "project" })],
      },
      readiness: expect.objectContaining({
        ready: true,
      }),
      workflow: expect.objectContaining({
        label: "Ready for package assembly",
      }),
    });
  });

  it("PATCH updates the program metadata and links", async () => {
    const response = await patchProgramDetail(
      new NextRequest(`http://localhost/api/programs/${PROGRAM_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "submitted",
          links: [{ linkType: "plan", linkedId: PLAN_ID }],
        }),
      }),
      {
        params: Promise.resolve({ programId: PROGRAM_ID }),
      }
    );

    expect(response.status).toBe(200);
    expect(programUpdateMock).toHaveBeenCalled();
    expect(programLinksDeleteMock).toHaveBeenCalled();
    expect(programLinksInsertMock).toHaveBeenCalledWith([
      expect.objectContaining({
        program_id: PROGRAM_ID,
        link_type: "plan",
        linked_id: PLAN_ID,
      }),
    ]);
  });
});
