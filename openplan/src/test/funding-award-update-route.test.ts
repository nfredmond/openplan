import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * PATCH /api/funding-awards/[awardId] — the route that ended two defects at
 * once.
 *
 * Before it existed, `funding_awards` had a create route, a close-out route, and
 * nothing else. `spendingStatus: "fully_spent"` was accepted verbatim at
 * creation, so an award could be born closed with the entire close-out contract
 * skipped — and it stayed that way forever, because close-out answers
 * `already_closed` to every subsequent attempt. What follows pins the three ways
 * this route may now move that field, and the fact that they stay three
 * different things on the record.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadProjectAccessMock = vi.fn();
const rebuildProjectRtpPostureMock = vi.fn();

const AWARD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const awardMaybeSingleMock = vi.fn();
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

import { PATCH as patchFundingAward } from "@/app/api/funding-awards/[awardId]/route";

function patchRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/funding-awards/${AWARD_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function context() {
  return { params: Promise.resolve({ awardId: AWARD_ID }) };
}

function awardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AWARD_ID,
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    title: "ATP award",
    awarded_amount: 1_000_000,
    spending_status: "active",
    closure_basis: null,
    closed_at: null,
    closure_note: null,
    reopened_at: null,
    reopen_reason: null,
    ...overrides,
  };
}

/** The single patch object handed to `.update()` by whichever branch ran. */
function lastUpdatePatch(): Record<string, unknown> {
  expect(awardUpdateMock).toHaveBeenCalled();
  const calls = awardUpdateMock.mock.calls as unknown as Record<string, unknown>[][];
  return calls[calls.length - 1]?.[0] ?? {};
}

describe("PATCH /api/funding-awards/[awardId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });

    awardMaybeSingleMock.mockResolvedValue({ data: awardRow(), error: null });
    awardUpdateMaybeSingleMock.mockResolvedValue({ data: awardRow(), error: null });

    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    // Nothing paid by default: the ordinary case for an award that has not been
    // reimbursed yet, and the case the earned close-out must refuse.
    invoicesEqSecondMock.mockResolvedValue({ data: [], error: null });
    milestonesLimitMock.mockResolvedValue({ data: [], error: null });
    milestonesInsertMock.mockResolvedValue({ error: null });
    rebuildProjectRtpPostureMock.mockResolvedValue({
      posture: { status: "funded", pipelineStatus: "funded" },
      updatedAt: "2026-07-29T12:00:00.000Z",
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "funding_awards") {
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: awardMaybeSingleMock })) })),
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

  it("edits ordinary fields without touching the closure columns", async () => {
    const response = await patchFundingAward(
      patchRequest({ title: "ATP Cycle 8 award", riskFlag: "watch" }),
      context()
    );

    expect(response.status).toBe(200);
    const patch = lastUpdatePatch();
    expect(patch).toEqual({ title: "ATP Cycle 8 award", risk_flag: "watch" });
    expect(patch).not.toHaveProperty("spending_status");
    expect(patch).not.toHaveProperty("closure_basis");
  });

  /**
   * THE LAPSE DATE, which used to be settable only at creation.
   *
   * `expenditure_deadline_at` had no PATCH branch, so every award already in a
   * database was permanently incapable of carrying one — and the expenditure
   * reminder built on that column could never fire for any of them.
   */
  it("sets a lapse date on an award that already exists", async () => {
    const response = await patchFundingAward(
      patchRequest({ expenditureDeadlineAt: "2027-06-30T00:00:00.000Z" }),
      context()
    );

    expect(response.status).toBe(200);
    expect(lastUpdatePatch()).toEqual({ expenditure_deadline_at: "2027-06-30T00:00:00.000Z" });
  });

  it("clears a lapse date on an explicit null, and leaves it alone when unmentioned", async () => {
    await patchFundingAward(patchRequest({ expenditureDeadlineAt: null }), context());
    // `null` is "this award has no lapse date", a real edit.
    expect(lastUpdatePatch()).toEqual({ expenditure_deadline_at: null });

    await patchFundingAward(patchRequest({ notes: "Scope note" }), context());
    // Absent is "do not touch it" — the column must not be written at all.
    expect(lastUpdatePatch()).not.toHaveProperty("expenditure_deadline_at");
  });

  it("does not confuse the lapse date with the obligation date", async () => {
    await patchFundingAward(
      patchRequest({
        obligationDueAt: "2027-01-31T00:00:00.000Z",
        expenditureDeadlineAt: "2027-06-30T00:00:00.000Z",
      }),
      context()
    );

    // Obligating is committing the money; expending is spending it. One
    // request, two columns, two different dates.
    expect(lastUpdatePatch()).toEqual({
      obligation_due_at: "2027-01-31T00:00:00.000Z",
      expenditure_deadline_at: "2027-06-30T00:00:00.000Z",
    });
  });

  it("refuses a lapse date that is not an instant", async () => {
    const response = await patchFundingAward(patchRequest({ expenditureDeadlineAt: "2027-06-30" }), context());
    expect(response.status).toBe(400);
  });

  it("rebuilds the funding posture only when the edit moves award money", async () => {
    await patchFundingAward(patchRequest({ notes: "Scope note" }), context());
    expect(rebuildProjectRtpPostureMock).not.toHaveBeenCalled();

    await patchFundingAward(patchRequest({ awardedAmount: 1_250_000 }), context());
    expect(rebuildProjectRtpPostureMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to close an award that its paid invoices have not covered", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        {
          status: "paid",
          amount: 400_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 400_000,
          due_date: null,
        },
      ],
      error: null,
    });

    const response = await patchFundingAward(patchRequest({ spendingStatus: "fully_spent" }), context());

    // The same gate the close-out route runs, because both call
    // evaluateFundingAwardCloseoutCoverage. A PATCH that could set the status
    // without it would be the original defect wearing a different verb.
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.coverage.paidAmount).toBe(400_000);
    expect(json.coverage.outstandingAmount).toBe(600_000);
    // The refusal names the one legitimate alternative rather than leaving a
    // planner with a genuinely historical award and no way to say so.
    expect(json.details).toContain("recordClosedOnImport");
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("runs the whole close-out contract when coverage is earned", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        {
          status: "paid",
          amount: 1_000_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 1_000_000,
          due_date: null,
        },
      ],
      error: null,
    });

    const response = await patchFundingAward(
      patchRequest({ spendingStatus: "fully_spent", closeoutNote: "Final invoice package signed." }),
      context()
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.closureBasis).toBe("earned_coverage");

    const patch = lastUpdatePatch();
    expect(patch.spending_status).toBe("fully_spent");
    expect(patch.closure_basis).toBe("earned_coverage");
    expect(patch.closed_by).toBe(USER_ID);

    // Not just the status: the milestone and the posture rebuild are the rest of
    // the contract, and a second way to close an award that skipped them would
    // put the product back where it started.
    expect(milestonesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        milestone_type: "closeout",
        status: "complete",
        // `closeoutNote`, not `notes`: one becomes the milestone's summary, the
        // other is a column on the award. They were briefly the same field,
        // which meant editing an award's notes while closing it wrote a
        // compliance sign-off the planner never composed.
        summary: "Final invoice package signed.",
      })
    );
    expect(rebuildProjectRtpPostureMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to fold ordinary field edits into a close-out", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        { status: "paid", amount: 1_000_000, retention_percent: 0, retention_amount: 0, net_amount: 1_000_000, due_date: null },
      ],
      error: null,
    });

    const response = await patchFundingAward(
      patchRequest({ spendingStatus: "fully_spent", title: "Renamed while closing" }),
      context()
    );

    // The close-out writes through the shared close-out function, which owns its
    // own UPDATE. Merging edits into that would mean either a second statement
    // that can fail after the first landed, or edits silently dropped while the
    // response reports success.
    expect(response.status).toBe(400);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses to fold a lapse-date edit into a close-out either", async () => {
    invoicesEqSecondMock.mockResolvedValue({
      data: [
        { status: "paid", amount: 1_000_000, retention_percent: 0, retention_amount: 0, net_amount: 1_000_000, due_date: null },
      ],
      error: null,
    });

    const response = await patchFundingAward(
      patchRequest({ spendingStatus: "fully_spent", expenditureDeadlineAt: "2027-06-30T00:00:00.000Z" }),
      context()
    );

    // A field the refusal list forgets is a field that rides a close-out into
    // the database on the strength of a different decision. Every editable
    // column belongs in FIELD_EDIT_KEYS; this pins the newest one there.
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      details: expect.stringContaining("expenditureDeadlineAt"),
    });
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a close-out note on a request that is not closing anything", async () => {
    // Accepted, stored nowhere, reported as success is how a planner comes to
    // believe they filed a sign-off that does not exist.
    const response = await patchFundingAward(
      patchRequest({ closeoutNote: "Final invoice package signed" }),
      context()
    );

    expect(response.status).toBe(400);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("records an imported closure as an assertion, and files no close-out milestone for it", async () => {
    const response = await patchFundingAward(
      patchRequest({
        recordClosedOnImport: { note: "Closed by the county in FY22; final invoice on file with Caltrans." },
      }),
      context()
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.closureBasis).toBe("recorded_on_import");

    const patch = lastUpdatePatch();
    expect(patch.spending_status).toBe("fully_spent");
    expect(patch.closure_basis).toBe("recorded_on_import");
    expect(patch.closure_note).toContain("Closed by the county");

    // A "Closeout / complete" milestone is a compliance sign-off on the
    // project's timeline, and nobody performed one — the workspace stated that
    // one happened elsewhere. Filing it anyway would manufacture the record this
    // whole change exists to prevent.
    expect(milestonesInsertMock).not.toHaveBeenCalled();
    expect(rebuildProjectRtpPostureMock).toHaveBeenCalledTimes(1);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "funding_award_recorded_closed_on_import",
      expect.objectContaining({ awardId: AWARD_ID, closureBasis: "recorded_on_import" })
    );
  });

  it("never lets an imported closure be recorded without a stated basis", async () => {
    const response = await patchFundingAward(
      patchRequest({ recordClosedOnImport: { note: "   " } }),
      context()
    );

    expect(response.status).toBe(400);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses two instructions about the same field in one request", async () => {
    const response = await patchFundingAward(
      patchRequest({
        spendingStatus: "active",
        recordClosedOnImport: { note: "Closed in FY22." },
      }),
      context()
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Conflicting spending-status intents");
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("will not re-open a closed award by a bare status edit", async () => {
    awardMaybeSingleMock.mockResolvedValue({
      data: awardRow({ spending_status: "fully_spent", closure_basis: "earned_coverage" }),
      error: null,
    });

    const response = await patchFundingAward(patchRequest({ spendingStatus: "active" }), context());

    expect(response.status).toBe(409);
    const json = await response.json();
    // The refusal names the intent that does the job, so the corrective path is
    // discoverable rather than merely closed.
    expect(json.details).toContain("reopen");
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("re-opens a closed award, clearing the closure and keeping the fact it happened", async () => {
    awardMaybeSingleMock.mockResolvedValue({
      data: awardRow({
        spending_status: "fully_spent",
        closure_basis: "recorded_on_import",
        closed_at: "2026-07-01T00:00:00.000Z",
      }),
      error: null,
    });

    const response = await patchFundingAward(
      patchRequest({ reopen: { reason: "Funder de-obligated the final $200k.", spendingStatus: "delayed" } }),
      context()
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("reopened");
    expect(json.priorClosureBasis).toBe("recorded_on_import");

    const patch = lastUpdatePatch();
    expect(patch.spending_status).toBe("delayed");
    // Cleared, because the award is no longer closed and the schema's coherence
    // CHECK requires these to move together.
    expect(patch.closure_basis).toBeNull();
    expect(patch.closed_at).toBeNull();
    expect(patch.closed_by).toBeNull();
    expect(patch.closure_note).toBeNull();
    // Kept, because a re-open that erased the fact a close-out happened would be
    // the same falsification pointing the other way.
    expect(patch.reopened_by).toBe(USER_ID);
    expect(patch.reopen_reason).toContain("de-obligated");

    expect(mockAudit.info).toHaveBeenCalledWith(
      "funding_award_reopened",
      expect.objectContaining({ awardId: AWARD_ID, priorClosureBasis: "recorded_on_import" })
    );
    // The close-out milestone already on the project is deliberately left alone.
    expect(milestonesInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a re-open with no written reason", async () => {
    awardMaybeSingleMock.mockResolvedValue({
      data: awardRow({ spending_status: "fully_spent", closure_basis: "earned_coverage" }),
      error: null,
    });

    const response = await patchFundingAward(
      patchRequest({ reopen: { reason: "  ", spendingStatus: "active" } }),
      context()
    );

    expect(response.status).toBe(400);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a re-open of an award that was never closed", async () => {
    const response = await patchFundingAward(
      patchRequest({ reopen: { reason: "Mistake", spendingStatus: "active" } }),
      context()
    );

    expect(response.status).toBe(409);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a second closure over an existing one instead of overwriting its provenance", async () => {
    awardMaybeSingleMock.mockResolvedValue({
      data: awardRow({ spending_status: "fully_spent", closure_basis: "earned_coverage" }),
      error: null,
    });

    const response = await patchFundingAward(
      patchRequest({ recordClosedOnImport: { note: "Closed in FY22." } }),
      context()
    );

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.closureBasis).toBe("earned_coverage");
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("answers a write that matched no rows as a disclosed policy failure, not a generic 500", async () => {
    // This route read the row through the caller's own client and passed the
    // membership and role checks, so zero matched rows means the database
    // refused a write the application believed was allowed.
    awardUpdateMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await patchFundingAward(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("The funding award was not saved");
    expect(json.details).toContain("row-level security policy");
  });

  it("denies a reader whose role cannot write programs", async () => {
    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });

    const response = await patchFundingAward(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(403);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an award that does not exist", async () => {
    awardMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await patchFundingAward(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(404);
  });

  it("refuses a request that names no field to change", async () => {
    const response = await patchFundingAward(patchRequest({}), context());

    expect(response.status).toBe(400);
    expect(awardUpdateMock).not.toHaveBeenCalled();
  });
});
