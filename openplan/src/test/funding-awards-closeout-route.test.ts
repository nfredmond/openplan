import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadProjectAccessMock = vi.fn();
const rebuildProjectRtpPostureMock = vi.fn();

const AWARD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const awardMaybeSingleMock = vi.fn();
const awardUpdateEqSecondMock = vi.fn();
const awardUpdateEqFirstMock = vi.fn(() => ({ eq: awardUpdateEqSecondMock }));
const awardUpdateMock = vi.fn(() => ({ eq: awardUpdateEqFirstMock }));
const invoicesEqSecondMock = vi.fn();
const invoicesEqFirstMock = vi.fn(() => ({ eq: invoicesEqSecondMock }));
const invoicesSelectMock = vi.fn(() => ({ eq: invoicesEqFirstMock }));
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

import { POST as postCloseout } from "@/app/api/funding-awards/[awardId]/closeout/route";

function closeoutRequest(body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/funding-awards/${AWARD_ID}/closeout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : JSON.stringify({}),
  });
}

function context() {
  return { params: Promise.resolve({ awardId: AWARD_ID }) };
}

describe("POST /api/funding-awards/[awardId]/closeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } });

    awardMaybeSingleMock.mockResolvedValue({
      data: {
        id: AWARD_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "ATP award",
        awarded_amount: 1_000_000,
        spending_status: "active",
        obligation_due_at: "2026-07-01T00:00:00Z",
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

    invoicesEqSecondMock.mockResolvedValue({
      data: [
        {
          status: "paid",
          amount: 1_000_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 1_000_000,
          due_date: null,
          invoice_date: "2026-04-01",
        },
      ],
      error: null,
    });

    awardUpdateEqSecondMock.mockResolvedValue({ error: null });
    milestonesInsertMock.mockResolvedValue({ error: null });
    rebuildProjectRtpPostureMock.mockResolvedValue({
      posture: { status: "funded", pipelineStatus: "funded" },
      updatedAt: "2026-04-16T12:00:00.000Z",
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "funding_awards") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: awardMaybeSingleMock,
              })),
            })),
            update: awardUpdateMock,
          };
        }
        if (table === "billing_invoice_records") {
          return { select: invoicesSelectMock };
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

  it("closes out an award when paid invoices meet the awarded amount", async () => {
    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.awardId).toBe(AWARD_ID);
    expect(json.coverage).toEqual(
      expect.objectContaining({
        awardedAmount: 1_000_000,
        paidAmount: 1_000_000,
        outstandingAmount: 0,
        coverageRatio: 1,
      })
    );
    expect(awardUpdateMock).toHaveBeenCalledWith({ spending_status: "fully_spent" });
    expect(milestonesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT_ID,
        funding_award_id: AWARD_ID,
        milestone_type: "closeout",
        phase_code: "closeout",
        status: "complete",
      })
    );
    expect(rebuildProjectRtpPostureMock).toHaveBeenCalledTimes(1);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "funding_award_closeout_completed",
      expect.objectContaining({
        awardId: AWARD_ID,
        awardedAmount: 1_000_000,
        paidAmount: 1_000_000,
      })
    );
  });

  it("rejects closeout when paid coverage is below 100%", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        {
          status: "paid",
          amount: 400_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 400_000,
          due_date: null,
          invoice_date: "2026-04-01",
        },
      ],
      error: null,
    });

    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error).toMatch(/100% paid invoice coverage/);
    expect(json.coverage).toEqual(
      expect.objectContaining({
        awardedAmount: 1_000_000,
        paidAmount: 400_000,
        outstandingAmount: 600_000,
      })
    );
    expect(awardUpdateMock).not.toHaveBeenCalled();
    expect(milestonesInsertMock).not.toHaveBeenCalled();
    expect(rebuildProjectRtpPostureMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the award does not exist", async () => {
    awardMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(404);
  });

  it("returns 403 when the user is not a workspace member", async () => {
    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: null,
      error: null,
      allowed: false,
    });

    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(403);
  });
});
