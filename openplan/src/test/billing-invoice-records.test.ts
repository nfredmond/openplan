import { describe, expect, it } from "vitest";
import {
  BILLING_INVOICE_STATUSES,
  buildBillingInvoicePriorityQueue,
  CLAIMED_INVOICE_STATUSES,
  computeInvoiceRetentionWithheld,
  computeNetInvoiceAmount,
  computeRetentionAmount,
  isClaimedInvoiceStatus,
  filterBillingInvoiceRecordsByLinkage,
  filterBillingInvoiceRecordsByOverdueStatus,
  summarizeAwardSubstantiation,
  summarizeBillingInvoiceLinkage,
  summarizeBillingInvoiceRecords,
  uninvoicedCommittedAwardAmount,
} from "@/lib/invoicing/invoice-records";
import { buildAwardDrawdownLedger } from "@/lib/invoicing/drawdown-ledger";

describe("billing invoice record helpers", () => {
  it("computes retention and net amount from percentage", () => {
    expect(computeRetentionAmount(12000, 5)).toBe(600);
    expect(computeNetInvoiceAmount(12000, null, 5)).toBe(11400);
  });

  it("prefers explicit retention amount when present", () => {
    expect(computeNetInvoiceAmount("8000", "250", 5)).toBe(7750);
    expect(computeInvoiceRetentionWithheld("8000", "250", 5)).toBe(250);
  });

  it("partitions the status vocabulary into claimed and not claimed", () => {
    // Derived from BILLING_INVOICE_STATUSES so a status added to the CHECK
    // constraint cannot land on neither side of the partition unnoticed.
    expect([...CLAIMED_INVOICE_STATUSES]).toEqual([
      "internal_review",
      "submitted",
      "approved_for_payment",
      "paid",
    ]);
    expect(BILLING_INVOICE_STATUSES.filter((status) => !isClaimedInvoiceStatus(status))).toEqual([
      "draft",
      "rejected",
    ]);
  });

  it("summarizes drafts, submitted invoices, overdue items, and paid totals", () => {
    const summary = summarizeBillingInvoiceRecords(
      [
        { status: "draft", amount: 10000, retention_percent: 10, due_date: "2026-03-10" },
        { status: "submitted", amount: 7500, retention_percent: 5, due_date: "2026-03-01" },
        { status: "approved_for_payment", amount: 5000, retention_amount: 0, due_date: "2026-03-20" },
        { status: "paid", amount: 1200, retention_percent: 0, due_date: "2026-02-20" },
        { status: "rejected", amount: 900, retention_percent: 0, due_date: "2026-02-10" },
      ],
      "2026-03-15T12:00:00.000Z"
    );

    // Hand-derived from the five rows above:
    //   draft      10,000 less 10% =  9,000
    //   submitted   7,500 less  5% =  7,125
    //   approved    5,000 less  0  =  5,000
    //   paid        1,200 less  0  =  1,200
    //   rejected      900 less  0  =    900
    // total 23,225; claimed (all but draft and rejected) 7,125 + 5,000 + 1,200
    // = 13,325; rejected 900.
    expect(summary).toEqual({
      totalCount: 5,
      draftCount: 1,
      submittedCount: 2,
      paidCount: 1,
      overdueCount: 2,
      overdueNetAmount: 16125,
      totalNetAmount: 23225,
      claimedNetAmount: 13325,
      // Σ GROSS over the same claimed rows — what was asked of the funder,
      // before retention. The gap to the net above IS the retention withheld.
      claimedGrossAmount: 13700,
      outstandingNetAmount: 12125,
      paidNetAmount: 1200,
      draftNetAmount: 9000,
      rejectedCount: 1,
      rejectedNetAmount: 900,
    });
  });

  /**
   * THE DEFECT THIS PINS. `totalNetAmount` includes rejected invoices, and two
   * surfaces captioned it "all non-rejected invoice records" / "already in
   * reimbursement flow" while /grants subtracted it from committed award
   * dollars to show what was left to bill. A rejected claim therefore both
   * inflated what an agency appeared to have requested and removed the same
   * money from what it appeared able to still request. `claimedNetAmount` is
   * the figure those captions describe.
   */
  it("separates what was actually claimed from the register total when a claim was rejected", () => {
    const summary = summarizeBillingInvoiceRecords(
      [
        { status: "paid", amount: 20000, retention_percent: 0 },
        { status: "submitted", amount: 10000, retention_percent: 0 },
        { status: "draft", amount: 4000, retention_percent: 0 },
        { status: "rejected", amount: 55000, retention_percent: 0 },
      ],
      "2026-03-15T12:00:00.000Z"
    );

    expect(summary.totalNetAmount).toBe(89000);
    expect(summary.claimedNetAmount).toBe(30000);
    expect(summary.rejectedNetAmount).toBe(55000);
    expect(summary.rejectedCount).toBe(1);
    // Every dollar is in exactly one of the three buckets.
    expect(summary.claimedNetAmount + summary.draftNetAmount + summary.rejectedNetAmount).toBe(
      summary.totalNetAmount
    );
  });

  /**
   * TWO MONEY FIGURES FOR ONE AUTHORIZATION, ON ONE PANEL, DISAGREEING BY THE
   * RETENTION.
   *
   * The project funding panel prints "$X still not yet invoiced" from
   * `uninvoicedCommittedAwardAmount` and "$Y not yet claimed" from the award's
   * own `AwardDrawdownLedger.remainingAuthorized`. The first subtracted NET and
   * the second subtracts GROSS, so on a $500,000 award with one paid $200,000
   * invoice at 10% retention they read $320,000 and $300,000 on the same
   * screen.
   *
   * $300,000 is the correct one. Retention is withheld from PAYMENT, not from
   * the claim: the $20,000 was invoiced, is released at close-out, and is not
   * billable again as new work. The old figure overstated remaining billing
   * authority — the direction that invites an agency to over-commit an award.
   *
   * Asserted as AGREEMENT between the two functions rather than as two
   * literals, because the defect was never a wrong constant; it was two
   * definitions of one concept drifting apart.
   */
  it("agrees with the award ledger on what is left to claim, retention included", () => {
    const invoices = [{ status: "paid", amount: 200000, retention_percent: 10 }];
    const summary = summarizeBillingInvoiceRecords(invoices, "2026-03-15T12:00:00.000Z");

    // The retention really is withheld from payment in this fixture.
    expect(summary.claimedNetAmount).toBe(180000);
    expect(summary.claimedGrossAmount).toBe(200000);

    const uninvoiced = uninvoicedCommittedAwardAmount(500000, summary);
    const ledger = buildAwardDrawdownLedger({
      award: { awarded_amount: 500000 },
      invoiceRead: { ok: true, invoices },
    });

    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;

    expect(uninvoiced).toBe(300000);
    expect(ledger.ledger.remainingAuthorized).toBe(300000);
    // The invariant, not the number: one authorization, one answer.
    expect(uninvoiced).toBe(ledger.ledger.remainingAuthorized);
  });

  it("counts approved-for-payment as claimed but not as paid", () => {
    const summary = summarizeBillingInvoiceRecords(
      [{ status: "approved_for_payment", amount: 5000, retention_percent: 0 }],
      "2026-03-15T12:00:00.000Z"
    );

    // A funder's approval is a promise, not a deposit.
    expect(summary.claimedNetAmount).toBe(5000);
    expect(summary.paidNetAmount).toBe(0);
  });

  it("separates linked versus unlinked invoice dollars for reimbursement mismatch review", () => {
    const summary = summarizeBillingInvoiceLinkage(
      [
        { funding_award_id: "award-1", status: "paid", amount: 5000, retention_percent: 0, due_date: "2026-03-01" },
        { funding_award_id: "award-2", status: "submitted", amount: 3000, retention_percent: 10, due_date: "2026-03-10" },
        { funding_award_id: null, status: "internal_review", amount: 2000, retention_percent: 0, due_date: "2026-03-09" },
        { funding_award_id: null, status: "draft", amount: 1500, retention_percent: 0, due_date: "2026-03-12" },
      ],
      "2026-03-15T12:00:00.000Z"
    );

    expect(summary).toEqual({
      linkedCount: 2,
      unlinkedCount: 2,
      linkedNetAmount: 7700,
      unlinkedNetAmount: 3500,
      // Both links are claimed statuses, so the claimed side matches the census
      // here; on the unlinked side the $1,500 draft is not a claim.
      linkedClaimedNetAmount: 7700,
      unlinkedClaimedNetAmount: 2000,
      linkedOutstandingNetAmount: 2700,
      unlinkedOutstandingNetAmount: 2000,
      linkedPaidNetAmount: 5000,
      unlinkedPaidNetAmount: 0,
      linkedOverdueCount: 1,
      unlinkedOverdueCount: 2,
      linkedOverdueNetAmount: 2700,
      unlinkedOverdueNetAmount: 3500,
    });
  });

  it("filters invoice records by linkage mode", () => {
    const records = [
      { funding_award_id: "award-1", invoice_number: "OP-001" },
      { funding_award_id: null, invoice_number: "OP-002" },
      { funding_award_id: "award-2", invoice_number: "OP-003" },
    ];

    expect(filterBillingInvoiceRecordsByLinkage(records, "all")).toHaveLength(3);
    expect(filterBillingInvoiceRecordsByLinkage(records, "linked").map((record) => record.invoice_number)).toEqual([
      "OP-001",
      "OP-003",
    ]);
    expect(filterBillingInvoiceRecordsByLinkage(records, "unlinked").map((record) => record.invoice_number)).toEqual([
      "OP-002",
    ]);
  });

  it("filters invoice records down to overdue items only", () => {
    const records = [
      { invoice_number: "OP-001", status: "submitted", due_date: "2026-03-01" },
      { invoice_number: "OP-002", status: "draft", due_date: "2026-03-20" },
      { invoice_number: "OP-003", status: "paid", due_date: "2026-02-15" },
      { invoice_number: "OP-004", status: "internal_review", due_date: "2026-03-10" },
    ];

    expect(filterBillingInvoiceRecordsByOverdueStatus(records, "all", "2026-03-15T12:00:00.000Z")).toHaveLength(4);
    expect(
      filterBillingInvoiceRecordsByOverdueStatus(records, "overdue", "2026-03-15T12:00:00.000Z").map(
        (record) => record.invoice_number
      )
    ).toEqual(["OP-001", "OP-004"]);
  });

  it("builds a priority cleanup queue with unlinked overdue invoices first", () => {
    const queue = buildBillingInvoicePriorityQueue(
      [
        { invoice_number: "OP-001", funding_award_id: "award-1", status: "submitted", amount: 5000, due_date: "2026-03-02" },
        { invoice_number: "OP-002", funding_award_id: null, status: "submitted", amount: 3200, due_date: "2026-03-01" },
        { invoice_number: "OP-003", funding_award_id: null, status: "draft", amount: 9000, due_date: "2026-03-20" },
        { invoice_number: "OP-004", funding_award_id: null, status: "internal_review", amount: 7800, due_date: "2026-03-05" },
        { invoice_number: "OP-005", funding_award_id: "award-2", status: "approved_for_payment", amount: 6100, due_date: "2026-03-04" },
      ],
      { now: "2026-03-15T12:00:00.000Z", limit: 3 }
    );

    expect(queue.map((entry) => entry.record.invoice_number)).toEqual(["OP-004", "OP-002", "OP-003"]);
    expect(queue.map((entry) => entry.priorityTier)).toEqual([1, 1, 3]);
    expect(queue[0]?.reason).toContain("Unlinked and overdue");
  });

  it("allows exact relink candidates to override default queue posture", () => {
    const queue = buildBillingInvoicePriorityQueue(
      [
        { invoice_number: "OP-001", funding_award_id: null, status: "submitted", amount: 3200, due_date: "2026-03-01", project_id: "project-1" },
        { invoice_number: "OP-002", funding_award_id: null, status: "internal_review", amount: 7800, due_date: "2026-03-05", project_id: "project-2" },
      ],
      {
        now: "2026-03-15T12:00:00.000Z",
        limit: 2,
        classifyRecord: (record) =>
          record.invoice_number === "OP-001"
            ? {
                priorityTier: 0.5,
                reason: "Exact award relink is ready now.",
                isExactRelink: true,
              }
            : null,
      }
    );

    expect(queue.map((entry) => entry.record.invoice_number)).toEqual(["OP-001", "OP-002"]);
    expect(queue[0]).toMatchObject({
      priorityTier: 0.5,
      reason: "Exact award relink is ready now.",
      isExactRelink: true,
    });
    expect(queue[1]?.isExactRelink).toBe(false);
  });
});

describe("summarizeAwardSubstantiation", () => {
  const awards = [
    { id: "award-1", project_id: "project-1" },
    { id: "award-2", project_id: "project-2" },
    { id: "award-3", project_id: null },
  ];

  const milestones = [
    { funding_award_id: "award-1", milestone_type: "obligation", status: "in_progress" },
    { funding_award_id: "award-1", milestone_type: "closeout", status: "not_started" },
    { funding_award_id: "award-2", milestone_type: "invoice", status: "scheduled" },
    { funding_award_id: null, milestone_type: "schedule", status: "complete" },
  ];

  const submittals = [
    { project_id: "project-1", submitted_at: "2026-04-01T10:00:00.000Z" },
    { project_id: "project-1", submitted_at: "2026-04-20T10:00:00.000Z" },
    { project_id: "project-1", submitted_at: null },
  ];

  it("marks an award substantiated when it has an obligation milestone and project submittals", () => {
    expect(summarizeAwardSubstantiation({ awards, milestones, submittals }).get("award-1")).toEqual({
      obligationMilestoneStatus: "in_progress",
      milestoneCount: 2,
      submittalCount: 3,
      latestSubmittalAt: "2026-04-20T10:00:00.000Z",
      readiness: "substantiated",
    });
  });

  it("marks an award partial when only milestones back it", () => {
    expect(summarizeAwardSubstantiation({ awards, milestones, submittals }).get("award-2")).toEqual({
      obligationMilestoneStatus: null,
      milestoneCount: 1,
      submittalCount: 0,
      latestSubmittalAt: null,
      readiness: "partial",
    });
  });

  it("marks an award with no linked milestones and no project submittals as none", () => {
    expect(summarizeAwardSubstantiation({ awards, milestones, submittals }).get("award-3")).toEqual({
      obligationMilestoneStatus: null,
      milestoneCount: 0,
      submittalCount: 0,
      latestSubmittalAt: null,
      readiness: "none",
    });
  });

  it("leaves unknown award ids absent from the map", () => {
    const map = summarizeAwardSubstantiation({ awards, milestones, submittals });
    expect(map.has("award-9")).toBe(false);
    expect(map.get("award-9")).toBeUndefined();
  });

  it("lets an explicit submittal award link override project-level attribution", () => {
    const map = summarizeAwardSubstantiation({
      awards,
      milestones: [],
      submittals: [
        { funding_award_id: "award-2", project_id: "project-1", submitted_at: "2026-05-01T09:00:00.000Z" },
      ],
    });

    expect(map.get("award-1")?.submittalCount).toBe(0);
    expect(map.get("award-1")?.readiness).toBe("none");
    expect(map.get("award-2")).toEqual({
      obligationMilestoneStatus: null,
      milestoneCount: 0,
      submittalCount: 1,
      latestSubmittalAt: "2026-05-01T09:00:00.000Z",
      readiness: "partial",
    });
  });
});
