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

  it("treats report packet attention as control-room attention", () => {
    const summary = buildProjectControlsSummary(
      [],
      [],
      [],
      {
        refreshRecommendedCount: 1,
        noPacketCount: 0,
        comparisonBackedCount: 1,
        recommendedReportId: "report-123",
        recommendedReportTitle: "Board packet",
      },
      "2026-03-10T00:00:00.000Z"
    );

    expect(summary.controlHealth).toBe("attention");
    expect(summary.attentionSummary.reportPackets.count).toBe(1);
    expect(summary.recommendedNextAction.label).toBe("Refresh comparison-backed packet");
    expect(summary.recommendedNextAction.targetId).toBe("project-reporting");
    expect(summary.recommendedNextAction.targetRowId).toBe("project-report-report-123");
  });

  it("caveats comparison-backed report context as planning support", () => {
    const summary = buildProjectControlsSummary(
      [],
      [],
      [],
      {
        refreshRecommendedCount: 0,
        noPacketCount: 0,
        comparisonBackedCount: 1,
        recommendedReportId: "report-456",
        recommendedReportTitle: "Grant framing packet",
      },
      "2026-03-10T00:00:00.000Z"
    );

    expect(summary.controlHealth).toBe("active");
    expect(summary.recommendedNextAction.label).toBe("Review comparison-backed packet");
    expect(summary.recommendedNextAction.detail).toContain(
      "saved comparison context that can support grant planning language or prioritization framing"
    );
    expect(summary.recommendedNextAction.detail).toContain(
      "not proof of award likelihood or a replacement for funding-source review"
    );
  });
});
