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
// The close-out UPDATE now chains `.select("id").maybeSingle()` so it can see
// whether it changed anything — a write that marks an award fully spent must not
// report success over zero matched rows.
const awardUpdateMaybeSingleMock = vi.fn();
const awardUpdateSelectMock = vi.fn(() => ({ maybeSingle: awardUpdateMaybeSingleMock }));
const awardUpdateEqSecondMock = vi.fn(() => ({ select: awardUpdateSelectMock }));
const awardUpdateEqFirstMock = vi.fn(() => ({ eq: awardUpdateEqSecondMock }));
const awardUpdateMock = vi.fn(() => ({ eq: awardUpdateEqFirstMock }));
const invoicesEqSecondMock = vi.fn();
const invoicesEqFirstMock = vi.fn(() => ({ eq: invoicesEqSecondMock }));
const invoicesSelectMock = vi.fn(() => ({ eq: invoicesEqFirstMock }));
const milestonesLimitMock = vi.fn();
const milestonesEqThirdMock = vi.fn(() => ({ limit: milestonesLimitMock }));
const milestonesEqSecondMock = vi.fn(() => ({ eq: milestonesEqThirdMock }));
const milestonesEqFirstMock = vi.fn(() => ({ eq: milestonesEqSecondMock }));
const milestonesSelectMock = vi.fn(() => ({ eq: milestonesEqFirstMock }));
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

    awardUpdateMaybeSingleMock.mockResolvedValue({ data: { id: AWARD_ID }, error: null });
    milestonesLimitMock.mockResolvedValue({ data: [], error: null });
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
            select: milestonesSelectMock,
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
        invoiceStatusBreakdown: {
          paidCount: 1,
          paidAmount: 1_000_000,
          activeCount: 0,
          activeAmount: 0,
          draftCount: 0,
          draftAmount: 0,
        },
      })
    );
    // The status and the closure provenance are written in ONE statement: the
    // schema's coherence CHECK refuses `fully_spent` with no basis, so a writer
    // that set the status alone would fail loudly rather than leave a closure
    // nobody can account for.
    expect(awardUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spending_status: "fully_spent",
        closure_basis: "earned_coverage",
        closed_by: "22222222-2222-4222-8222-222222222222",
      })
    );
    expect(milestonesSelectMock).toHaveBeenCalledWith("id");
    expect(milestonesEqFirstMock).toHaveBeenCalledWith("project_id", PROJECT_ID);
    expect(milestonesEqSecondMock).toHaveBeenCalledWith("funding_award_id", AWARD_ID);
    expect(milestonesEqThirdMock).toHaveBeenCalledWith("milestone_type", "closeout");
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

  it("does not duplicate a closeout milestone when one already exists", async () => {
    milestonesLimitMock.mockResolvedValue({ data: [{ id: "99999999-9999-4999-8999-999999999999" }], error: null });

    const response = await postCloseout(closeoutRequest({ notes: "Final invoice package signed" }), context());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.awardId).toBe(AWARD_ID);
    expect(awardUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ spending_status: "fully_spent", closure_basis: "earned_coverage" })
    );
    expect(milestonesInsertMock).not.toHaveBeenCalled();
    expect(mockAudit.info).toHaveBeenCalledWith(
      "funding_award_closeout_milestone_already_exists",
      expect.objectContaining({ awardId: AWARD_ID, projectId: PROJECT_ID })
    );
    expect(rebuildProjectRtpPostureMock).toHaveBeenCalledTimes(1);
  });

  it("treats repeated closeout on a fully spent award as an idempotent no-op", async () => {
    awardMaybeSingleMock.mockResolvedValue({
      data: {
        id: AWARD_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "ATP award",
        awarded_amount: 1_000_000,
        spending_status: "fully_spent",
        obligation_due_at: "2026-07-01T00:00:00Z",
      },
      error: null,
    });

    const response = await postCloseout(closeoutRequest({ notes: "Already signed off" }), context());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(
      expect.objectContaining({
        awardId: AWARD_ID,
        status: "already_closed",
        coverage: expect.objectContaining({
          awardedAmount: 1_000_000,
          paidAmount: 1_000_000,
          outstandingAmount: 0,
          coverageRatio: 1,
          invoiceStatusBreakdown: {
            paidCount: 1,
            paidAmount: 1_000_000,
            activeCount: 0,
            activeAmount: 0,
            draftCount: 0,
            draftAmount: 0,
          },
        }),
      })
    );
    expect(awardUpdateMock).not.toHaveBeenCalled();
    expect(milestonesInsertMock).not.toHaveBeenCalled();
    expect(rebuildProjectRtpPostureMock).not.toHaveBeenCalled();
    expect(mockAudit.info).toHaveBeenCalledWith(
      "funding_award_closeout_already_complete",
      expect.objectContaining({ awardId: AWARD_ID, projectId: PROJECT_ID })
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
        {
          // The real enum value. This fixture said "approved", a status
          // `billing_invoice_records` has never allowed, which is why the route
          // could bucket on it and still look tested.
          status: "approved_for_payment",
          amount: 200_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 200_000,
          due_date: null,
          invoice_date: "2026-04-15",
        },
        {
          status: "draft",
          amount: 50_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 50_000,
          due_date: null,
          invoice_date: "2026-04-20",
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
        invoiceStatusBreakdown: {
          paidCount: 1,
          paidAmount: 400_000,
          activeCount: 1,
          activeAmount: 200_000,
          draftCount: 1,
          draftAmount: 50_000,
        },
      })
    );
    expect(awardUpdateMock).not.toHaveBeenCalled();
    expect(milestonesInsertMock).not.toHaveBeenCalled();
    expect(rebuildProjectRtpPostureMock).not.toHaveBeenCalled();
  });

  it("counts an approved-for-payment invoice as money in flight, not as an unsubmitted draft", async () => {
    // `billing_invoice_records.status` is
    // draft | internal_review | submitted | approved_for_payment | paid | rejected.
    // Every one of the non-paid, non-rejected statuses appears here so the
    // refusal's own explanation can be checked against the whole enum rather
    // than the two values the route used to recognize.
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        { status: "paid", amount: 400_000, retention_percent: 0, retention_amount: 0, net_amount: 400_000, due_date: null, invoice_date: "2026-04-01" },
        { status: "approved_for_payment", amount: 200_000, retention_percent: 0, retention_amount: 0, net_amount: 200_000, due_date: null, invoice_date: "2026-04-15" },
        { status: "submitted", amount: 60_000, retention_percent: 0, retention_amount: 0, net_amount: 60_000, due_date: null, invoice_date: "2026-04-16" },
        { status: "internal_review", amount: 40_000, retention_percent: 0, retention_amount: 0, net_amount: 40_000, due_date: null, invoice_date: "2026-04-17" },
        { status: "draft", amount: 50_000, retention_percent: 0, retention_amount: 0, net_amount: 50_000, due_date: null, invoice_date: "2026-04-20" },
        { status: "rejected", amount: 25_000, retention_percent: 0, retention_amount: 0, net_amount: 25_000, due_date: null, invoice_date: "2026-04-21" },
      ],
      error: null,
    });

    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(422);
    const json = await response.json();

    expect(json.coverage.invoiceStatusBreakdown).toEqual({
      paidCount: 1,
      paidAmount: 400_000,
      // approved_for_payment + submitted + internal_review — the same
      // "outstanding" set every other funding surface uses.
      activeCount: 3,
      activeAmount: 300_000,
      draftCount: 1,
      draftAmount: 50_000,
    });
    // Approved for payment is a promise from the funder, not a deposit, so it
    // may never be counted toward the coverage that permits a close-out.
    expect(json.coverage.paidAmount).toBe(400_000);
    // The rejected invoice is in no bucket, so the three counts total five of
    // the six linked invoices rather than all six.
    const breakdown = json.coverage.invoiceStatusBreakdown;
    expect(breakdown.paidCount + breakdown.activeCount + breakdown.draftCount).toBe(5);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("reports the same net amount in its breakdown that it used to compute coverage", async () => {
    // `net_amount` is a plain stored column with DEFAULT 0, not a generated one.
    // A row written by anything other than the invoicing composer can carry a
    // zero there while `amount` and the retention fields are correct. The
    // breakdown used to print that zero next to a coverage figure computed from
    // amount-minus-retention — two different numbers for the same money.
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        {
          status: "paid",
          amount: 1_000_000,
          retention_percent: 10,
          retention_amount: 100_000,
          net_amount: 0,
          due_date: null,
          invoice_date: "2026-04-01",
        },
      ],
      error: null,
    });

    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(422);
    const json = await response.json();

    expect(json.coverage.paidAmount).toBe(900_000);
    expect(json.coverage.outstandingAmount).toBe(100_000);
    expect(json.coverage.invoiceStatusBreakdown.paidAmount).toBe(json.coverage.paidAmount);
  });

  it("returns 404 when the award does not exist", async () => {
    awardMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(404);
  });

  it("reports an imported closure as already closed instead of refusing it on coverage", async () => {
    // Ordering is load-bearing now that an award can be recorded as closed on
    // import: such an award IS closed and has no paid invoices at all, so a
    // coverage-first route would answer a planner clicking Close out with
    // "coverage is short" — arithmetically true, and false about the thing they
    // asked. Nothing is written on this branch either way.
    awardMaybeSingleMock.mockResolvedValue({
      data: {
        id: AWARD_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "Historic ATP award",
        awarded_amount: 1_000_000,
        spending_status: "fully_spent",
        closure_basis: "recorded_on_import",
        obligation_due_at: null,
      },
      error: null,
    });
    invoicesEqSecondMock.mockResolvedValue({ data: [], error: null });

    const response = await postCloseout(closeoutRequest(), context());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("already_closed");
    // How it became closed, not only that it is. Before the basis existed these
    // two responses were identical, which is how an asserted closure came to
    // read as a verified one on every surface downstream.
    expect(json.closureBasis).toBe("recorded_on_import");
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("names the earned basis on the close-out it just performed", async () => {
    const response = await postCloseout(closeoutRequest(), context());
    expect(await response.json()).toMatchObject({ closureBasis: "earned_coverage" });
  });

  it("answers a close-out write that matched no rows as a disclosed policy failure", async () => {
    // This route read the award through the caller's own client and passed the
    // membership and role checks, so zero matched rows is the database refusing
    // a write the application believed was allowed — not a missing award, and
    // certainly not a close-out that succeeded.
    awardUpdateMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await postCloseout(closeoutRequest(), context());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("The funding award was not saved");
    expect(json.details).toContain("row-level security policy");
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
