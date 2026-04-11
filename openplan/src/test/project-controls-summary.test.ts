import { describe, expect, it } from "vitest";
import { buildProjectControlsSummary } from "@/lib/projects/controls";

describe("project controls summary", () => {
  it("flags attention when milestones, submittals, or invoices are overdue", () => {
    const summary = buildProjectControlsSummary(
      [
        {
          title: "Authorization checklist packet",
          status: "scheduled",
          target_date: "2026-03-05",
          phase_code: "initiation",
        },
        {
          title: "Council workshop complete",
          status: "complete",
          target_date: "2026-03-01",
          actual_date: "2026-03-01",
        },
      ],
      [
        {
          title: "Invoice backup packet",
          status: "submitted",
          due_date: "2026-03-08",
          submittal_type: "invoice_backup",
        },
      ],
      [
        {
          status: "submitted",
          amount: 5000,
          retention_percent: 5,
          due_date: "2026-03-07",
        },
      ],
      undefined,
      "2026-03-10T00:00:00.000Z"
    );

    expect(summary.controlHealth).toBe("attention");
    expect(summary.milestoneCount).toBe(2);
    expect(summary.completedMilestoneCount).toBe(1);
    expect(summary.overdueMilestoneCount).toBe(1);
    expect(summary.pendingSubmittalCount).toBe(1);
    expect(summary.overdueSubmittalCount).toBe(1);
    expect(summary.nextMilestone?.title).toBe("Authorization checklist packet");
    expect(summary.nextSubmittal?.title).toBe("Invoice backup packet");
    expect(summary.invoiceSummary.outstandingNetAmount).toBe(4750);
    expect(summary.invoiceSummary.overdueCount).toBe(1);
  });

  it("returns stable when everything is complete and paid", () => {
    const summary = buildProjectControlsSummary(
      [
        {
          title: "Construction closeout",
          status: "complete",
          target_date: "2026-03-01",
        },
      ],
      [
        {
          title: "Final reimbursement package",
          status: "accepted",
          due_date: "2026-03-01",
        },
      ],
      [
        {
          status: "paid",
          amount: 2500,
          retention_percent: 0,
          due_date: "2026-03-01",
        },
      ],
      undefined,
      "2026-03-10T00:00:00.000Z"
    );

    expect(summary.controlHealth).toBe("stable");
    expect(summary.pendingSubmittalCount).toBe(0);
    expect(summary.invoiceSummary.paidNetAmount).toBe(2500);
  });
});
