vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const closeoutCommandMock = vi.fn();

let workspaceTimeZone: string | null = null;
let workspaceReads: string[] = [];

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

// The SQL close-out command (20261117000000) is the only writer of closure
// columns; these tests check what the route sends it and how it answers.
vi.mock("@/lib/grants/award-handoff-server", () => ({
  runFundingAwardCloseoutCommand: (...args: unknown[]) => closeoutCommandMock(...args),
  managedCloseout: vi.fn(),
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
        latest_handoff_revision_id: null,
        current_handoff_revision_id: null,
        currency_code: null,
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
    closeoutCommandMock.mockResolvedValue({
      outcome: "done",
      result: { status: "closed", closureBasis: "earned_coverage", closedAt: "2026-11-17T03:00:00.000Z", paid: "1000000.00", released: null, milestoneFiled: true },
    });
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
        if (table === "workspaces") {
          return {
            select: (columns: string) => ({
              eq: (column: string, value: string) => ({
                maybeSingle: async () => {
                  workspaceReads.push(`${columns}|${column}=${value}`);
                  return { data: { time_zone: workspaceTimeZone, home_country_code: null }, error: null };
                },
              }),
            }),
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
    // The route writes nothing itself: the command closes the award, files the
    // milestone and checks coverage again inside its transaction.
    expect(closeoutCommandMock).toHaveBeenCalledWith({
      actorId: "22222222-2222-4222-8222-222222222222",
      awardId: AWARD_ID,
      event: "earned_coverage",
      note: null,
      calendarDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      reopenSpendingStatus: null,
    });
    expect(awardUpdateMock).not.toHaveBeenCalled();
    expect(milestonesInsertMock).not.toHaveBeenCalled();
    expect(json).toMatchObject({ closedAt: "2026-11-17T03:00:00.000Z", milestoneFiled: true, releasedAmount: null });
    expect(rebuildProjectRtpPostureMock).toHaveBeenCalledTimes(1);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "funding_award_closure_recorded",
      expect.objectContaining({ awardId: AWARD_ID, event: "earned_coverage", status: "closed" })
    );
  });

  it("reports the command's answer when a milestone already existed", async () => {
    closeoutCommandMock.mockResolvedValueOnce({
      outcome: "done",
      result: { status: "closed", closureBasis: "earned_coverage", closedAt: "2026-11-17T03:00:00.000Z", milestoneFiled: false },
    });
    const response = await postCloseout(closeoutRequest({ notes: "Final invoice package signed" }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ milestoneFiled: false });
    expect(closeoutCommandMock).toHaveBeenCalledWith(expect.objectContaining({ note: "Final invoice package signed" }));
  });

  it("treats repeated closeout on a fully spent award as an idempotent no-op", async () => {
    awardMaybeSingleMock.mockResolvedValue({
      data: {
        id: AWARD_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "ATP award",
        latest_handoff_revision_id: null,
        current_handoff_revision_id: null,
        currency_code: null,
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
          // Rejected: in no bucket, so the shortfall is what refuses here. The
          // open-request refusal has its own case below.
          status: "rejected",
          amount: 200_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 200_000,
          due_date: null,
          invoice_date: "2026-04-15",
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
          activeCount: 0,
          activeAmount: 0,
          draftCount: 0,
          draftAmount: 0,
        },
      })
    );
    expect(closeoutCommandMock).not.toHaveBeenCalled();
    expect(rebuildProjectRtpPostureMock).not.toHaveBeenCalled();
  });

  // KI-2026-11-16-130: lane 84 closed an over-claimed award with one request
  // submitted and four drafts.
  it("refuses close-out while any linked request is open, even when paid covers the ceiling", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        { status: "paid", amount: 1_000_000, retention_percent: 0, retention_amount: 0, net_amount: 1_000_000, due_date: null, invoice_date: "2026-04-01" },
        { status: "draft", amount: 50, retention_percent: 0, retention_amount: 0, net_amount: 50, due_date: null, invoice_date: "2026-04-20" },
      ],
      error: null,
    });
    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json).toMatchObject({ error: "Close-out needs every linked request paid or rejected", openCount: 1 });
    expect(closeoutCommandMock).not.toHaveBeenCalled();
  });

  it("asks for a stated basis when paid requests exceed the ceiling", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [{ status: "paid", amount: 1_200_000, retention_percent: 0, retention_amount: 0, net_amount: 1_200_000, due_date: null, invoice_date: "2026-04-01" }],
      error: null,
    });
    const silent = await postCloseout(closeoutRequest(), context());
    expect(silent.status).toBe(422);
    expect((await silent.json()).error).toContain("exceed the award ceiling");
    expect(closeoutCommandMock).not.toHaveBeenCalled();
    const stated = await postCloseout(closeoutRequest({ notes: "Amendment 2 raised the ceiling" }), context());
    expect(stated.status).toBe(200);
    expect(closeoutCommandMock).toHaveBeenCalledWith(expect.objectContaining({ event: "earned_coverage", note: "Amendment 2 raised the ceiling" }));
  });

  // KL-2026-09-04-024: an award that finished under its ceiling can close with
  // the rest released, and only with a note.
  it("closes an award under its ceiling with the balance released, and only with a note", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [{ status: "paid", amount: 400_000, retention_percent: 0, retention_amount: 0, net_amount: 400_000, due_date: null, invoice_date: "2026-04-01" }],
      error: null,
    });
    const noNote = await postCloseout(closeoutRequest({ basis: "reconciled_with_balance" }), context());
    expect(noNote.status).toBe(422);
    expect(closeoutCommandMock).not.toHaveBeenCalled();

    closeoutCommandMock.mockResolvedValueOnce({
      outcome: "done",
      result: { status: "closed", closureBasis: "reconciled_with_balance", closedAt: "2026-11-17T03:00:00.000Z", paid: "400000.00", released: "600000.00", milestoneFiled: true },
    });
    const response = await postCloseout(closeoutRequest({ basis: "reconciled_with_balance", notes: "Finished under budget" }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ closureBasis: "reconciled_with_balance", releasedAmount: 600000 });
    expect(closeoutCommandMock).toHaveBeenCalledWith(expect.objectContaining({ event: "reconciled_with_balance", note: "Finished under budget" }));
  });

  it("sends a reconciled close-out of a fully paid award back to the ordinary close-out", async () => {
    const response = await postCloseout(closeoutRequest({ basis: "reconciled_with_balance", notes: "Done" }), context());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("use the ordinary close-out");
    expect(closeoutCommandMock).not.toHaveBeenCalled();
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
        latest_handoff_revision_id: null,
        current_handoff_revision_id: null,
        currency_code: null,
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

  it("answers the command's refusal with its status and reason, and rebuilds nothing", async () => {
    closeoutCommandMock.mockResolvedValueOnce({ outcome: "refused", status: 422, message: "Close-out needs every linked request paid or rejected; 1 still open", detail: null });
    const response = await postCloseout(closeoutRequest(), context());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "Close-out needs every linked request paid or rejected; 1 still open" });
    expect(rebuildProjectRtpPostureMock).not.toHaveBeenCalled();
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

  describe("the date the closeout milestone carries", () => {
    // 01:00 UTC Oct 13 is 6 p.m. Oct 12 in Los Angeles.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-13T01:00:00Z"));
      workspaceReads = [];
    });
    afterEach(() => {
      vi.useRealTimers();
      workspaceTimeZone = null;
    });

    it("is the workspace's calendar day, read for the award's own workspace", async () => {
      workspaceTimeZone = "America/Los_Angeles";
      expect((await postCloseout(closeoutRequest(), context())).status).toBe(200);
      expect(closeoutCommandMock).toHaveBeenCalledWith(expect.objectContaining({ calendarDate: "2026-10-12" }));
      expect(workspaceReads).toEqual([`time_zone, home_country_code|id=${WORKSPACE_ID}`]);
    });

    it("is the UTC day when no zone is recorded", async () => {
      expect((await postCloseout(closeoutRequest(), context())).status).toBe(200);
      expect(closeoutCommandMock).toHaveBeenCalledWith(expect.objectContaining({ calendarDate: "2026-10-13" }));
    });
  });
});
