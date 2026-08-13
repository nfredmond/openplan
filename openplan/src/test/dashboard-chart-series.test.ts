import { describe, expect, it } from "vitest";

import {
  awardDrawdown,
  commentsReceivedOverTime,
  DRAWN_INVOICE_STATUSES,
  type AwardInvoiceRow,
  type ChartReadOutcome,
  type EngagementCommentRow,
  type FundingAwardRow,
} from "@/lib/dashboard/chart-series";
import {
  DASHBOARD_CHART_IDS,
  DASHBOARD_CHARTS,
  DEFAULT_DASHBOARD_CHART_IDS,
  parseDashboardChartSelection,
  serializeDashboardChartSelection,
} from "@/lib/dashboard/chart-catalog";

/**
 * A CHART MUST NOT LIE WHEN THE DATA IS THIN OR MISSING.
 *
 * A shape is more persuasive than a number, which makes a chart the most
 * damaging place in this product to state something nobody measured. The tests
 * below are all one argument: a failed read, an empty workspace, a truncated
 * read and a two-point sample are four DIFFERENT facts, and none of them may be
 * drawn as a line.
 *
 * WHAT THESE TESTS CANNOT PROVE. Nothing here runs a stylesheet or a box model
 * — they assert on the series, not on pixels. That the figures are legible,
 * correctly coloured, and the right shape at 390px and 1600px was measured in a
 * real browser, and no assertion in this file could have caught it.
 */

const NOW = new Date("2026-08-13T12:00:00Z");

function commentsRead(
  rows: EngagementCommentRow[],
  overrides: Partial<ChartReadOutcome<EngagementCommentRow>> = {}
): ChartReadOutcome<EngagementCommentRow> {
  return { rows, failed: false, pending: false, truncated: false, ...overrides };
}

function awardsRead(
  rows: FundingAwardRow[],
  overrides: Partial<ChartReadOutcome<FundingAwardRow>> = {}
): ChartReadOutcome<FundingAwardRow> {
  return { rows, failed: false, pending: false, truncated: false, ...overrides };
}

function invoicesRead(
  rows: AwardInvoiceRow[],
  overrides: Partial<ChartReadOutcome<AwardInvoiceRow>> = {}
): ChartReadOutcome<AwardInvoiceRow> {
  return { rows, failed: false, pending: false, truncated: false, ...overrides };
}

/** Comments spread across `weeks` distinct weeks, one per week, ending last week. */
function commentsAcrossWeeks(weeks: number): EngagementCommentRow[] {
  return Array.from({ length: weeks }, (_, index) => {
    const when = new Date(NOW);
    when.setUTCDate(when.getUTCDate() - 7 * (index + 1));
    return { created_at: when.toISOString() };
  });
}

describe("comments coming in", () => {
  it("says a failed read failed — and never draws it as zero", () => {
    const series = commentsReceivedOverTime(commentsRead([], { failed: true }), NOW);

    expect(series.points).toEqual([]);
    expect(series.blockedKind).toBe("unreadable");
    // The distinction that matters: this sentence must not be readable as "none yet".
    expect(series.blockedReason).toMatch(/failed query, not an empty workspace/i);
  });

  it("distinguishes an empty workspace from a failed read, in kind and in words", () => {
    const empty = commentsReceivedOverTime(commentsRead([]), NOW);
    const failed = commentsReceivedOverTime(commentsRead([], { failed: true }), NOW);

    expect(empty.blockedKind).toBe("empty");
    expect(failed.blockedKind).toBe("unreadable");
    expect(empty.blockedReason).not.toEqual(failed.blockedReason);
    expect(empty.blockedReason).toMatch(/No comments have come in/i);
  });

  it("calls a pending migration what it is, rather than a failure", () => {
    const series = commentsReceivedOverTime(commentsRead([], { pending: true }), NOW);
    expect(series.blockedKind).toBe("pending");
    expect(series.blockedReason).toMatch(/migration/i);
  });

  it("refuses to total a read that hit its cap", () => {
    const series = commentsReceivedOverTime(
      commentsRead(commentsAcrossWeeks(6), { truncated: true }),
      NOW
    );
    expect(series.points).toEqual([]);
    expect(series.blockedKind).toBe("truncated");
  });

  it("refuses a line through two weeks — two points are not a trend", () => {
    const series = commentsReceivedOverTime(commentsRead(commentsAcrossWeeks(2)), NOW);
    expect(series.points).toEqual([]);
    expect(series.blockedKind).toBe("insufficient");
    expect(series.blockedReason).toMatch(/not a trend/i);
  });

  it("draws a running total once three weeks have comments, and never goes down", () => {
    const series = commentsReceivedOverTime(commentsRead(commentsAcrossWeeks(4)), NOW);

    expect(series.blockedReason).toBeNull();
    // Every week in the window is drawn, silent ones included — a skipped week
    // would compress the axis and make a quiet month look busy.
    expect(series.points).toHaveLength(12);
    const values = series.points.map((point) => point.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[values.length - 1]).toBe(4);
  });

  it("carries the weekly arrival in each point, so a flat stretch reads as a quiet week", () => {
    const series = commentsReceivedOverTime(commentsRead(commentsAcrossWeeks(4)), NOW);
    const silent = series.points.find((point) => point.detail?.includes("0 new comments"));
    expect(silent).toBeDefined();
  });
});

describe("money drawn against money awarded", () => {
  const AWARD = { id: "award-1", title: "STBG 2026", awarded_amount: 1000 };

  it("says a failed award read failed", () => {
    const series = awardDrawdown(awardsRead([], { failed: true }), invoicesRead([]));
    expect(series.blockedKind).toBe("unreadable");
  });

  it("refuses to draw when the INVOICE read failed, even though the awards read fine", () => {
    // The failure mode this guards: awards answer, invoices do not, and every
    // bar renders at 0% — a dashboard telling an agency it has drawn nothing.
    const series = awardDrawdown(awardsRead([AWARD]), invoicesRead([], { failed: true }));
    expect(series.points).toEqual([]);
    expect(series.blockedKind).toBe("unreadable");
  });

  it("refuses a truncated invoice read rather than showing a short draw", () => {
    const series = awardDrawdown(
      awardsRead([AWARD]),
      invoicesRead([{ funding_award_id: "award-1", amount: 100, status: "paid" }], {
        truncated: true,
      })
    );
    expect(series.blockedKind).toBe("truncated");
  });

  it("counts only money actually asked for from the funder", () => {
    const series = awardDrawdown(
      awardsRead([AWARD]),
      invoicesRead([
        { funding_award_id: "award-1", amount: 100, status: "paid" },
        { funding_award_id: "award-1", amount: 50, status: "submitted" },
        { funding_award_id: "award-1", amount: 25, status: "approved_for_payment" },
        // Neither of these has left the agency, or was accepted.
        { funding_award_id: "award-1", amount: 400, status: "draft" },
        { funding_award_id: "award-1", amount: 400, status: "internal_review" },
        { funding_award_id: "award-1", amount: 400, status: "rejected" },
      ])
    );

    expect(series.points[0].value).toBe(175);
    expect(series.points[0].reference).toBe(1000);
    expect(DRAWN_INVOICE_STATUSES).toEqual(["submitted", "approved_for_payment", "paid"]);
  });

  it("leaves out an award with no amount, and says how many it left out", () => {
    const series = awardDrawdown(
      awardsRead([AWARD, { id: "award-2", title: "Unpriced", awarded_amount: null }]),
      invoicesRead([])
    );
    expect(series.points).toHaveLength(1);
    expect(series.footnote).toMatch(/1 award records no amount/i);
  });

  it("discloses invoices it could not attribute rather than dropping them silently", () => {
    const series = awardDrawdown(
      awardsRead([AWARD]),
      invoicesRead([
        { funding_award_id: "award-1", amount: 100, status: "paid" },
        { funding_award_id: null, amount: 900, status: "paid" },
      ])
    );
    expect(series.points[0].value).toBe(100);
    expect(series.footnote).toMatch(/\$900 across 1 invoice is not linked to an award/i);
  });

  it("reports an over-drawn award as over-drawn instead of capping the number", () => {
    const series = awardDrawdown(
      awardsRead([AWARD]),
      invoicesRead([{ funding_award_id: "award-1", amount: 1200, status: "paid" }])
    );
    expect(series.points[0].detail).toMatch(/120%/);
    expect(series.points[0].detail).toMatch(/MORE than the award/);
  });

  it("blocks when no award records an amount at all", () => {
    const series = awardDrawdown(
      awardsRead([{ id: "a", title: "No figure", awarded_amount: 0 }]),
      invoicesRead([])
    );
    expect(series.points).toEqual([]);
    expect(series.blockedKind).toBe("empty");
  });
});

describe("which figures a person sees", () => {
  it("shows the default set to somebody who has never chosen", () => {
    expect(parseDashboardChartSelection(null)).toEqual([...DEFAULT_DASHBOARD_CHART_IDS]);
    expect(DEFAULT_DASHBOARD_CHART_IDS.length).toBeGreaterThan(0);
  });

  it("honours a deliberate empty choice, which is not the same as never choosing", () => {
    expect(parseDashboardChartSelection("")).toEqual([]);
  });

  it("drops an id it no longer knows rather than stranding somebody on a blank dashboard", () => {
    expect(parseDashboardChartSelection("runs-per-month,retired-figure")).toEqual([
      "runs-per-month",
    ]);
  });

  it("keeps catalog order regardless of the order things were clicked", () => {
    const reversed = [...DASHBOARD_CHART_IDS].reverse();
    expect(parseDashboardChartSelection(serializeDashboardChartSelection(reversed))).toEqual([
      ...DASHBOARD_CHART_IDS,
    ]);
  });

  it("has one catalog entry per id, and no more than five figures", () => {
    expect(DASHBOARD_CHARTS.map((chart) => chart.id).sort()).toEqual(
      [...DASHBOARD_CHART_IDS].sort()
    );
    expect(DASHBOARD_CHARTS).toHaveLength(DASHBOARD_CHART_IDS.length);
    expect(DASHBOARD_CHARTS.length).toBeLessThanOrEqual(5);
  });
});
