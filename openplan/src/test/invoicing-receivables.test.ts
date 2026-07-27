import { describe, expect, it } from "vitest";
import {
  buildEngagementBilledSummary,
  buildReceivableAgingSummary,
  CLIENT_INVOICE_STATUSES,
  computeLineItemAmount,
  isReceivableOutstanding,
  isReceivableOverdue,
  RECEIVABLE_AGING_BUCKETS,
  receivableInvoiceAmount,
  summarizeClientInvoiceTotals,
  summarizeReceivables,
} from "@/lib/invoicing/receivables";

const NOW = new Date("2026-07-27T12:00:00Z");

describe("computeLineItemAmount", () => {
  it("prefers unit math when quantity and unit amount are both present", () => {
    // The stored amount is stale on purpose — unit math must win.
    expect(computeLineItemAmount({ quantity: 12.5, unit_amount: 180, amount: 999 })).toBe(2250);
  });

  it("falls back to the explicit amount when unit inputs are incomplete", () => {
    expect(computeLineItemAmount({ quantity: 12.5, unit_amount: null, amount: 4200 })).toBe(4200);
    expect(computeLineItemAmount({ quantity: null, unit_amount: 180, amount: 4200 })).toBe(4200);
    expect(computeLineItemAmount({ amount: "1050.55" })).toBe(1050.55);
  });

  it("tolerates numeric strings and clamps a negative explicit amount to zero", () => {
    expect(computeLineItemAmount({ quantity: "2.00", unit_amount: "95.50" })).toBe(191);
    expect(computeLineItemAmount({ amount: -50 })).toBe(0);
  });
});

describe("summarizeClientInvoiceTotals", () => {
  it("sums line items and applies the shared retention math", () => {
    const totals = summarizeClientInvoiceTotals(
      [
        { quantity: 10, unit_amount: 200 }, // 2000
        { amount: 500 },
      ],
      5
    );

    expect(totals).toEqual({
      subtotalAmount: 2500,
      retentionPercent: 5,
      retentionAmount: 125,
      totalAmount: 2375,
    });
  });

  it("handles no retention and empty line sets", () => {
    expect(summarizeClientInvoiceTotals([{ amount: 100 }])).toEqual({
      subtotalAmount: 100,
      retentionPercent: 0,
      retentionAmount: 0,
      totalAmount: 100,
    });
    expect(summarizeClientInvoiceTotals([], 10)).toEqual({
      subtotalAmount: 0,
      retentionPercent: 10,
      retentionAmount: 0,
      totalAmount: 0,
    });
  });
});

describe("receivableInvoiceAmount", () => {
  it("derives from subtotal and retention when a subtotal exists", () => {
    // total_amount 0 is the column default on an uncomputed row; the derived
    // value must win over it.
    expect(
      receivableInvoiceAmount({ subtotal_amount: 1000, retention_percent: 10, retention_amount: 0, total_amount: 0 })
    ).toBe(900);
  });

  it("uses the stored total only when there is no subtotal to derive from", () => {
    expect(receivableInvoiceAmount({ total_amount: 640 })).toBe(640);
    expect(receivableInvoiceAmount({})).toBe(0);
  });

  it("lets a nonzero stored total stand when the subtotal is the column default 0", () => {
    // DB rows always carry a subtotal (NOT NULL DEFAULT 0), so subtotal 0
    // beside a nonzero total means the line items were never rolled up —
    // deriving from the default would erase a real receivable.
    expect(receivableInvoiceAmount({ subtotal_amount: 0, total_amount: 640 })).toBe(640);
    // A genuinely zero invoice (computed subtotal 0, stored total 0) stays zero.
    expect(receivableInvoiceAmount({ subtotal_amount: 0, total_amount: 0 })).toBe(0);
  });
});

describe("outstanding and overdue", () => {
  it("only a sent invoice is outstanding", () => {
    expect(isReceivableOutstanding("sent")).toBe(true);
    for (const status of ["draft", "paid", "void", null, undefined]) {
      expect(isReceivableOutstanding(status)).toBe(false);
    }
  });

  it("overdue requires sent status, a valid due date, and a past due date", () => {
    expect(isReceivableOverdue("sent", "2026-07-01", NOW)).toBe(true);
    expect(isReceivableOverdue("sent", "2026-08-01", NOW)).toBe(false);
    expect(isReceivableOverdue("draft", "2026-07-01", NOW)).toBe(false);
    expect(isReceivableOverdue("paid", "2026-07-01", NOW)).toBe(false);
    expect(isReceivableOverdue("void", "2026-07-01", NOW)).toBe(false);
    expect(isReceivableOverdue("sent", null, NOW)).toBe(false);
    expect(isReceivableOverdue("sent", "not-a-date", NOW)).toBe(false);
  });

  it("agrees with the aging bucketer at the boundary: due TODAY is not overdue, due yesterday is", () => {
    const dueToday = "2026-07-27"; // NOW is 2026-07-27T12:00:00Z
    const dueYesterday = "2026-07-26";

    expect(isReceivableOverdue("sent", dueToday, NOW)).toBe(false);
    expect(isReceivableOverdue("sent", dueYesterday, NOW)).toBe(true);

    const summary = buildReceivableAgingSummary(
      [
        { status: "sent", due_date: dueToday, total_amount: 100 },
        { status: "sent", due_date: dueYesterday, total_amount: 200 },
      ],
      NOW
    );

    // The bucketer draws the same line: due today sits in "current", day
    // counting starts the day after the due date.
    expect(summary.buckets.current).toEqual({ count: 1, amount: 100 });
    expect(summary.buckets.days_1_30).toEqual({ count: 1, amount: 200 });
  });
});

describe("buildReceivableAgingSummary", () => {
  it("ages only sent invoices and puts undated outstanding in the explicit undated slot", () => {
    const summary = buildReceivableAgingSummary(
      [
        { status: "sent", due_date: "2026-08-15", total_amount: 100 }, // not yet due → current
        { status: "sent", due_date: "2026-07-10", total_amount: 200 }, // 17 days → 1-30
        { status: "sent", due_date: "2026-06-10", total_amount: 300 }, // 47 days → 31-60
        { status: "sent", due_date: "2026-05-10", total_amount: 400 }, // 78 days → 61-90
        { status: "sent", due_date: "2026-01-10", total_amount: 500 }, // 198 days → over 90
        { status: "sent", due_date: null, total_amount: 950 }, // outstanding, undated
        { status: "draft", due_date: "2026-01-01", total_amount: 9999 }, // not a receivable yet
        { status: "paid", due_date: "2026-01-01", total_amount: 9999 }, // settled
        { status: "void", due_date: "2026-01-01", total_amount: 9999 }, // never counts
      ],
      NOW
    );

    expect(summary.buckets.current).toEqual({ count: 1, amount: 100 });
    expect(summary.buckets.days_1_30).toEqual({ count: 1, amount: 200 });
    expect(summary.buckets.days_31_60).toEqual({ count: 1, amount: 300 });
    expect(summary.buckets.days_61_90).toEqual({ count: 1, amount: 400 });
    expect(summary.buckets.days_over_90).toEqual({ count: 1, amount: 500 });
    expect(summary.undatedCount).toBe(1);
    expect(summary.undatedAmount).toBe(950);
  });

  it("exposes every declared bucket even when empty", () => {
    const summary = buildReceivableAgingSummary([], NOW);
    for (const bucket of RECEIVABLE_AGING_BUCKETS) {
      expect(summary.buckets[bucket]).toEqual({ count: 0, amount: 0 });
    }
    expect(summary.undatedCount).toBe(0);
    expect(summary.undatedAmount).toBe(0);
  });
});

describe("summarizeReceivables", () => {
  it("produces headline counts and amounts with void excluded from every amount", () => {
    const summary = summarizeReceivables(
      [
        { status: "draft", total_amount: 100 },
        { status: "sent", total_amount: 200, due_date: "2026-08-30" },
        { status: "sent", total_amount: 300, due_date: "2026-06-01" }, // overdue
        { status: "paid", total_amount: 400 },
        { status: "void", total_amount: 5000 },
      ],
      NOW
    );

    expect(summary).toEqual({
      totalCount: 5,
      draftCount: 1,
      sentCount: 2,
      paidCount: 1,
      voidCount: 1,
      overdueCount: 1,
      overdueAmount: 300,
      totalAmount: 1000,
      outstandingAmount: 500,
      paidAmount: 400,
      draftAmount: 100,
    });
  });

  it("is empty-safe", () => {
    expect(summarizeReceivables(null).totalCount).toBe(0);
    expect(summarizeReceivables(undefined).totalAmount).toBe(0);
  });
});

describe("buildEngagementBilledSummary", () => {
  const engagement = { id: "eng-1", not_to_exceed_amount: 1000 };

  it("splits billed-to-date (sent+paid) from drafted-unbilled and excludes void", () => {
    const summary = buildEngagementBilledSummary(engagement, [
      { engagement_id: "eng-1", status: "sent", total_amount: 400 },
      { engagement_id: "eng-1", status: "paid", total_amount: 300 },
      { engagement_id: "eng-1", status: "draft", total_amount: 250 },
      { engagement_id: "eng-1", status: "void", total_amount: 800 },
      { engagement_id: "eng-2", status: "sent", total_amount: 999 }, // another engagement
    ]);

    expect(summary).toEqual({
      billedToDate: 700,
      draftedUnbilled: 250,
      notToExceed: 1000,
      remaining: 300,
      isOverNte: false,
    });
  });

  it("flags an over-NTE engagement", () => {
    const summary = buildEngagementBilledSummary(engagement, [
      { engagement_id: "eng-1", status: "sent", total_amount: 700 },
      { engagement_id: "eng-1", status: "paid", total_amount: 500 },
    ]);

    expect(summary.billedToDate).toBe(1200);
    expect(summary.remaining).toBe(-200);
    expect(summary.isOverNte).toBe(true);
  });

  it("never counts an unassigned (NULL engagement) invoice toward ANY engagement", () => {
    const invoices = [
      { engagement_id: "eng-1", status: "sent", total_amount: 400 },
      { engagement_id: "eng-2", status: "sent", total_amount: 300 },
      // Unassigned invoice: must not inflate billedToDate or eat NTE headroom
      // of either engagement.
      { engagement_id: null, status: "sent", total_amount: 10000 },
    ];

    const first = buildEngagementBilledSummary({ id: "eng-1", not_to_exceed_amount: 1000 }, invoices);
    const second = buildEngagementBilledSummary({ id: "eng-2", not_to_exceed_amount: 1000 }, invoices);

    expect(first.billedToDate).toBe(400);
    expect(first.remaining).toBe(600);
    expect(first.isOverNte).toBe(false);
    expect(second.billedToDate).toBe(300);
    expect(second.remaining).toBe(700);
    expect(second.isOverNte).toBe(false);
  });

  it("claims nothing when the engagement itself has no id", () => {
    const summary = buildEngagementBilledSummary({}, [
      { engagement_id: null, status: "sent", total_amount: 500 },
      { engagement_id: "eng-1", status: "sent", total_amount: 400 },
    ]);

    expect(summary.billedToDate).toBe(0);
    expect(summary.draftedUnbilled).toBe(0);
  });

  it("reports no ceiling honestly when the engagement has no NTE", () => {
    const summary = buildEngagementBilledSummary({ id: "eng-1" }, [
      { engagement_id: "eng-1", status: "sent", total_amount: 700 },
    ]);

    expect(summary.notToExceed).toBeNull();
    expect(summary.remaining).toBeNull();
    expect(summary.isOverNte).toBe(false);
  });
});

describe("status vocabulary", () => {
  it("matches the migration's lifecycle exactly", () => {
    expect(CLIENT_INVOICE_STATUSES).toEqual(["draft", "sent", "paid", "void"]);
  });
});
