import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const SECONDARY_WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROGRAM_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const fundingOpportunitiesOrderMock = vi.fn();
const fundingOpportunitiesSelectMock = vi.fn(() => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSingleMock = vi.fn();
const fundingOpportunitiesInsertSelectMock = vi.fn(() => ({ single: fundingOpportunitiesSingleMock }));
const fundingOpportunitiesInsertMock = vi.fn(() => ({ select: fundingOpportunitiesInsertSelectMock }));

const programsMaybeSingleMock = vi.fn();
const programsEqMock = vi.fn(() => ({ maybeSingle: programsMaybeSingleMock }));
const programsSelectMock = vi.fn(() => ({ eq: programsEqMock }));

const projectsMaybeSingleMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ maybeSingle: projectsMaybeSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqWorkspaceMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipLimitMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock, eq: membershipEqWorkspaceMock }));
const membershipEqUserMock = vi.fn(() => ({ limit: membershipLimitMock, maybeSingle: membershipMaybeSingleMock, eq: membershipEqWorkspaceMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqUserMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "funding_opportunities") {
    return {
      select: fundingOpportunitiesSelectMock,
      insert: fundingOpportunitiesInsertMock,
    };
  }

  if (table === "programs") {
    return {
      select: programsSelectMock,
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

  if (table === "assistant_action_executions") {
    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
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

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>("@/lib/workspaces/current");
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getFundingOpportunities, POST as postFundingOpportunities } from "@/app/api/funding-opportunities/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/funding-opportunities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/funding-opportunities", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    fundingOpportunitiesOrderMock.mockResolvedValue({
      data: [
        {
          id: OPPORTUNITY_ID,
          workspace_id: WORKSPACE_ID,
          program_id: PROGRAM_ID,
          project_id: PROJECT_ID,
          title: "2027 ATP countywide active transportation call",
          opportunity_status: "open",
          decision_state: "pursue",
          agency_name: "Caltrans",
          owner_label: "Grant lead",
          cadence_label: "Biennial",
          expected_award_amount: 750000,
          opens_at: "2026-04-10T16:00:00.000Z",
          closes_at: "2026-06-14T23:59:00.000Z",
          decision_due_at: "2026-09-10T16:00:00.000Z",
          summary: "Countywide ATP package opportunity.",
          updated_at: "2026-04-10T17:00:00.000Z",
          created_at: "2026-04-10T16:30:00.000Z",
          programs: { id: PROGRAM_ID, title: "2027 RTIP", funding_classification: "discretionary" },
          projects: { id: PROJECT_ID, name: "Downtown safety project" },
        },
      ],
      error: null,
    });

    programsMaybeSingleMock.mockResolvedValue({
      data: {
        id: PROGRAM_ID,
        workspace_id: WORKSPACE_ID,
        title: "2027 RTIP",
      },
      error: null,
    });

    projectsMaybeSingleMock.mockResolvedValue({
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

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: WORKSPACE_ID,
        role: "member",
        workspaces: {
          name: "Primary workspace",
          plan: "pilot",
          created_at: "2026-04-12T18:00:00.000Z",
        },
      },
      workspace: {
        name: "Primary workspace",
        plan: "pilot",
        created_at: "2026-04-12T18:00:00.000Z",
      },
    });

    fundingOpportunitiesSingleMock.mockResolvedValue({
      data: {
        id: OPPORTUNITY_ID,
        workspace_id: WORKSPACE_ID,
        program_id: PROGRAM_ID,
        project_id: PROJECT_ID,
        title: "2027 ATP countywide active transportation call",
        opportunity_status: "upcoming",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns funding opportunities with summary counts", async () => {
    const response = await getFundingOpportunities(new NextRequest("http://localhost/api/funding-opportunities"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      opportunities: [
        expect.objectContaining({
          id: OPPORTUNITY_ID,
          title: "2027 ATP countywide active transportation call",
          opportunity_status: "open",
          program: expect.objectContaining({ id: PROGRAM_ID }),
          project: expect.objectContaining({ id: PROJECT_ID }),
        }),
      ],
      summary: {
        byStatus: { open: 1 },
        openCount: 1,
        upcomingCount: 0,
        pursueCount: 1,
        likelyAmount: 750000,
      },
    });
  });

  it("POST creates a funding opportunity", async () => {
    const response = await postFundingOpportunities(
      jsonRequest({
        programId: PROGRAM_ID,
        projectId: PROJECT_ID,
        title: "2027 ATP countywide active transportation call",
        status: "upcoming",
        agencyName: "Caltrans",
        expectedAwardAmount: 500000,
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      opportunityId: OPPORTUNITY_ID,
    });
    expect(fundingOpportunitiesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        program_id: PROGRAM_ID,
        project_id: PROJECT_ID,
        title: "2027 ATP countywide active transportation call",
        opportunity_status: "upcoming",
        agency_name: "Caltrans",
        expected_award_amount: 500000,
      })
    );
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("POST without programId or projectId uses the helper-selected current workspace", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
      membership: {
        workspace_id: SECONDARY_WORKSPACE_ID,
        role: "owner",
        workspaces: {
          name: "Newest workspace",
          plan: "pilot",
          created_at: "2026-04-13T01:00:00.000Z",
        },
      },
      workspace: {
        name: "Newest workspace",
        plan: "pilot",
        created_at: "2026-04-13T01:00:00.000Z",
      },
    });

    const response = await postFundingOpportunities(
      jsonRequest({
        title: "Unanchored grant lead",
        status: "upcoming",
        agencyName: "Caltrans",
      })
    );

    expect(response.status).toBe(201);
    expect(loadCurrentWorkspaceMembershipMock).toHaveBeenCalled();
    expect(fundingOpportunitiesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: SECONDARY_WORKSPACE_ID,
        program_id: null,
        project_id: null,
        title: "Unanchored grant lead",
        opportunity_status: "upcoming",
      })
    );
  });
});
