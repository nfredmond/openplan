import { describe, expect, it } from "vitest";
import {
  computeNetInvoiceAmount,
  computeRetentionAmount,
  filterBillingInvoiceRecordsByLinkage,
  summarizeBillingInvoiceLinkage,
  summarizeBillingInvoiceRecords,
} from "@/lib/billing/invoice-records";

describe("billing invoice record helpers", () => {
  it("computes retention and net amount from percentage", () => {
    expect(computeRetentionAmount(12000, 5)).toBe(600);
    expect(computeNetInvoiceAmount(12000, null, 5)).toBe(11400);
  });

  it("prefers explicit retention amount when present", () => {
    expect(computeNetInvoiceAmount("8000", "250", 5)).toBe(7750);
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

    expect(summary).toEqual({
      totalCount: 5,
      draftCount: 1,
      submittedCount: 2,
      paidCount: 1,
      overdueCount: 2,
      totalNetAmount: 23225,
      outstandingNetAmount: 12125,
      paidNetAmount: 1200,
      draftNetAmount: 9000,
    });
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
      linkedOutstandingNetAmount: 2700,
      unlinkedOutstandingNetAmount: 2000,
      linkedPaidNetAmount: 5000,
      unlinkedPaidNetAmount: 0,
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
});
