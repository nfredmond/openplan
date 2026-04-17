import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadProjectAccessMock = vi.fn();
const rebuildProjectRtpPostureMock = vi.fn();

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const AWARD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const awardsOrderMock = vi.fn();
const awardsEqMock = vi.fn(() => ({ order: awardsOrderMock }));
const awardsSelectMock = vi.fn(() => ({ eq: awardsEqMock, order: awardsOrderMock }));
const awardsSingleMock = vi.fn();
const awardsInsertSelectMock = vi.fn(() => ({ single: awardsSingleMock }));
const awardsInsertMock = vi.fn(() => ({ select: awardsInsertSelectMock }));
const milestonesInsertMock = vi.fn();

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

vi.mock("@/lib/programs/api", () => ({
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));

vi.mock("@/lib/projects/rtp-posture-writeback", () => ({
  rebuildProjectRtpPosture: (...args: unknown[]) => rebuildProjectRtpPostureMock(...args),
}));

import { GET as getFundingAwards, POST as postFundingAwards } from "@/app/api/funding-awards/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/funding-awards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/funding-awards", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } });

    awardsOrderMock.mockResolvedValue({
      data: [
        {
          id: AWARD_ID,
          project_id: PROJECT_ID,
          title: "ATP award",
          awarded_amount: 1750000,
          match_amount: 250000,
          match_posture: "secured",
          spending_status: "active",
          risk_flag: "watch",
        },
      ],
      error: null,
    });

    awardsSingleMock.mockResolvedValue({
      data: {
        id: AWARD_ID,
        project_id: PROJECT_ID,
        title: "ATP award",
        awarded_amount: 1750000,
      },
      error: null,
    });

    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    rebuildProjectRtpPostureMock.mockResolvedValue({
      posture: {
        status: "funded",
        pipelineStatus: "funded",
        committedFundingAmount: 1_750_000,
        fundingNeedAmount: 1_500_000,
      },
      updatedAt: "2026-04-16T12:00:00.000Z",
      error: null,
    });

    milestonesInsertMock.mockResolvedValue({ error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "funding_awards") {
          return {
            select: awardsSelectMock,
            insert: awardsInsertMock,
          };
        }
        if (table === "project_milestones") {
          return {
            insert: (...args: unknown[]) => milestonesInsertMock(...args),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
  });

  it("GET lists funding awards", async () => {
    const response = await getFundingAwards(new NextRequest(`http://localhost/api/funding-awards?projectId=${PROJECT_ID}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      awards: [expect.objectContaining({ id: AWARD_ID, title: "ATP award" })],
    });
  });

  it("POST creates a funding award and rebuilds RTP posture", async () => {
    const response = await postFundingAwards(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "ATP award",
        awardedAmount: 1750000,
        matchAmount: 250000,
      })
    );

    expect(response.status).toBe(201);
    expect(awardsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "ATP award",
        awarded_amount: 1750000,
      })
    );
    expect(rebuildProjectRtpPostureMock).toHaveBeenCalledTimes(1);
    const call = rebuildProjectRtpPostureMock.mock.calls[0]?.[0] as {
      projectId: string;
      workspaceId: string;
    };
    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.workspaceId).toBe(WORKSPACE_ID);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "rtp_posture_rebuilt",
      expect.objectContaining({
        awardId: AWARD_ID,
        projectId: PROJECT_ID,
        status: "funded",
      })
    );
  });

  it("emits an obligation milestone when obligationDueAt is provided", async () => {
    const response = await postFundingAwards(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "ATP award",
        awardedAmount: 1750000,
        obligationDueAt: "2026-07-01T00:00:00.000Z",
      })
    );

    expect(response.status).toBe(201);
    expect(milestonesInsertMock).toHaveBeenCalledTimes(1);
    expect(milestonesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT_ID,
        funding_award_id: AWARD_ID,
        milestone_type: "obligation",
        phase_code: "programming",
        status: "scheduled",
        target_date: "2026-07-01",
      })
    );
    expect(mockAudit.info).toHaveBeenCalledWith(
      "funding_award_obligation_milestone_created",
      expect.objectContaining({
        awardId: AWARD_ID,
        projectId: PROJECT_ID,
        targetDate: "2026-07-01",
      })
    );
  });

  it("skips milestone creation when obligationDueAt is not provided", async () => {
    const response = await postFundingAwards(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "ATP award",
        awardedAmount: 1750000,
      })
    );

    expect(response.status).toBe(201);
    expect(milestonesInsertMock).not.toHaveBeenCalled();
  });

  it("warns but still returns 201 when obligation milestone insert fails", async () => {
    milestonesInsertMock.mockResolvedValue({ error: { message: "milestone insert failed", code: "23505" } });

    const response = await postFundingAwards(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "ATP award",
        awardedAmount: 1750000,
        obligationDueAt: "2026-07-01T00:00:00.000Z",
      })
    );

    expect(response.status).toBe(201);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "funding_award_obligation_milestone_failed",
      expect.objectContaining({
        awardId: AWARD_ID,
        projectId: PROJECT_ID,
        message: "milestone insert failed",
      })
    );
  });

  it("warns but still returns 201 when RTP posture rebuild fails", async () => {
    rebuildProjectRtpPostureMock.mockResolvedValue({
      posture: null,
      updatedAt: null,
      error: { message: "update failed", code: "23505" },
    });

    const response = await postFundingAwards(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "ATP award",
        awardedAmount: 1750000,
      })
    );

    expect(response.status).toBe(201);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "rtp_posture_rebuild_failed",
      expect.objectContaining({
        awardId: AWARD_ID,
        projectId: PROJECT_ID,
        message: "update failed",
      })
    );
  });
});
