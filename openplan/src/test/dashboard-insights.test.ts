import { describe, expect, it } from "vitest";

import {
  lanePressure,
  medianOverallScore,
  recentOverallScores,
  reportsGenerated,
  runsPerMonth,
  type ChartReadOutcome,
  type DashboardRunRow,
} from "@/lib/dashboard/insights";

/**
 * A FIGURE THAT CANNOT BE DRAWN MUST SAY WHY.
 *
 * The charting version of the rule this product keeps everywhere else. An empty
 * axis is not neutral: a trend line through one point reads as "flat", a bar
 * chart of zeros reads as "measured zero", and both are findings that nobody
 * made. So every series resolves to either points or a sentence naming what
 * would produce it.
 *
 * WHAT THIS FILE CANNOT PROVE. Everything here is pure functions over plain
 * objects. jsdom is not involved and neither is a browser, so nothing below
 * establishes that any of these sentences is legible, correctly coloured, or
 * placed where a reader will meet it — no unit test in this repo can, because
 * jsdom has no box model and no stylesheet. Those were measured in a real
 * browser; what is proven here is which sentence is chosen and when.
 */
const RUN = (created_at: string, overallScore?: number, reports = 0) => ({
  created_at,
  metrics: overallScore === undefined ? {} : { overallScore },
  report_generated_count: reports,
});

/** A read that answered, with these rows. */
const READ = (
  rows: DashboardRunRow[],
  overrides: Partial<ChartReadOutcome<DashboardRunRow>> = {}
): ChartReadOutcome<DashboardRunRow> => ({
  rows,
  failed: false,
  pending: false,
  truncated: false,
  ...overrides,
});

describe("runs per month", () => {
  it("refuses to plot a trend with no runs, and says so", () => {
    const series = runsPerMonth(READ([]));
    expect(series.points).toEqual([]);
    expect(series.blockedReason).toMatch(/No analysis runs are recorded yet/);
  });

  it("refuses a trend when every run falls in one month", () => {
    const series = runsPerMonth(READ([RUN("2026-08-01T00:00:00Z"), RUN("2026-08-20T00:00:00Z")]));
    expect(series.points).toEqual([]);
    expect(series.blockedReason).toMatch(/at least two months/);
  });

  /**
   * The gap month is the point. Skipping it would draw a straight line from May
   * to July and invent June activity that did not happen.
   */
  it("fills a month with no runs as zero rather than skipping it", () => {
    const series = runsPerMonth(READ([RUN("2026-05-04T00:00:00Z"), RUN("2026-07-04T00:00:00Z")]));

    expect(series.blockedReason).toBeNull();
    expect(series.points.map((p) => p.value)).toEqual([1, 0, 1]);
    expect(series.points).toHaveLength(3);
  });

  /** "Aug 26" reads as a day of the month — the one thing a monthly axis must not say. */
  it("labels months with a four-digit year", () => {
    const series = runsPerMonth(READ([RUN("2026-05-04T00:00:00Z"), RUN("2026-06-04T00:00:00Z")]));
    expect(series.points[0].label).toBe("May 2026");
    expect(series.points[0].label).not.toMatch(/\b\d{1,2}$/);
  });
});

describe("composite score by run", () => {
  /**
   * A run with no composite is DROPPED, not plotted as zero. A zero bar says
   * "this corridor scored nothing", which is a finding; "no score was recorded"
   * is not the same statement.
   */
  it("drops unscored runs instead of plotting them as zero", () => {
    const series = recentOverallScores(
      READ([
        RUN("2026-05-01T00:00:00Z", 62),
        RUN("2026-05-02T00:00:00Z"),
        RUN("2026-05-03T00:00:00Z", 41),
      ])
    );

    expect(series.points.map((p) => p.value)).toEqual([62, 41]);
    expect(series.points.some((p) => p.value === 0)).toBe(false);
  });

  it("says nothing has scored rather than drawing an empty axis", () => {
    const series = recentOverallScores(READ([RUN("2026-05-02T00:00:00Z")]));
    expect(series.points).toEqual([]);
    expect(series.blockedReason).toMatch(/No run has recorded a composite score/);
  });

  it("keeps the most recent runs when there are more than the limit", () => {
    const runs = Array.from({ length: 20 }, (_, i) =>
      RUN(`2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`, i)
    );
    const series = recentOverallScores(READ(runs), 5);
    expect(series.points.map((p) => p.value)).toEqual([15, 16, 17, 18, 19]);
  });
});

describe("lane pressure", () => {
  /**
   * Here a zero IS the measurement — "nothing queued in grants" is a real
   * reading — so zero lanes stay. What must not happen is a chart of ALL zeros,
   * which looks like a shape and carries none.
   */
  it("keeps a zero lane when other lanes have work", () => {
    const series = lanePressure([
      { label: "RTP", value: 0, detail: "RTP packets" },
      { label: "Grants", value: 3, detail: "Open opportunities" },
    ]);

    expect(series.blockedReason).toBeNull();
    expect(series.points.map((p) => p.value)).toEqual([0, 3]);
  });

  it("states that every lane is clear instead of drawing all-zero bars", () => {
    const series = lanePressure([
      { label: "RTP", value: 0, detail: "RTP packets" },
      { label: "Grants", value: 0, detail: "Open opportunities" },
    ]);

    expect(series.points).toEqual([]);
    expect(series.blockedReason).toMatch(/Every lane is clear/);
  });
});

describe("headline figures", () => {
  it("sums reports generated across runs", () => {
    expect(reportsGenerated([RUN("2026-05-01T00:00:00Z", 10, 2), RUN("2026-05-02T00:00:00Z", 20, 3)])).toBe(5);
  });

  /** Median, not mean: one screening outlier should not move the headline. */
  it("reports a median that an outlier cannot drag", () => {
    const runs = [
      RUN("2026-05-01T00:00:00Z", 40),
      RUN("2026-05-02T00:00:00Z", 44),
      RUN("2026-05-03T00:00:00Z", 100),
    ];
    expect(medianOverallScore(runs)).toBe(44);
  });

  it("answers null rather than zero when nothing has scored", () => {
    expect(medianOverallScore([RUN("2026-05-01T00:00:00Z")])).toBeNull();
  });
});

/**
 * A FAILED RUNS READ MAY NOT BE DRAWN AS A ZERO — the defect these two figures
 * actually shipped with, and the reason they now take a read OUTCOME.
 *
 * Both used to be handed `runsResult.data ?? []`, and the page never looked at
 * that read's error. So a workspace whose runs query FAILED was drawn an area
 * chart flat on the baseline and a bar chart with no bars — byte-identical to a
 * workspace that had genuinely never run anything. A shape is more persuasive
 * than a number: this is the most damaging thing either figure could do.
 */
describe("a failed runs read is not an empty workspace", () => {
  it("blocks the runs-per-month line as unreadable, and denies the zero reading in words", () => {
    const failed = runsPerMonth(READ([], { failed: true }));
    const empty = runsPerMonth(READ([]));

    expect(failed.points).toEqual([]);
    expect(failed.blockedKind).toBe("unreadable");
    expect(failed.blockedReason).toMatch(/do not read it as zero/i);

    // The two states must not be describable in the same words.
    expect(empty.blockedKind).toBe("empty");
    expect(failed.blockedReason).not.toBe(empty.blockedReason);
  });

  it("blocks the composite bars as unreadable rather than saying nothing has scored", () => {
    const failed = recentOverallScores(READ([], { failed: true }));

    expect(failed.points).toEqual([]);
    expect(failed.blockedKind).toBe("unreadable");
    expect(failed.blockedReason).not.toMatch(/No run has recorded a composite score/);
  });

  it("names a pending migration as its own state, not as a failure and not as zero", () => {
    for (const figure of [
      runsPerMonth(READ([], { pending: true })),
      recentOverallScores(READ([], { pending: true })),
    ]) {
      expect(figure.blockedKind).toBe("pending");
      expect(figure.blockedReason).toMatch(/migration/i);
    }
  });

  /**
   * The runs read is capped at 500 and ordered OLDEST first, so a workspace past
   * the cap gets its most recent months cut off entirely. A line drawn from the
   * oldest 500 rows says a busy agency stopped working months ago.
   */
  it("refuses to draw a total from a read that hit its cap", () => {
    const rows = [RUN("2026-05-01T00:00:00Z", 20), RUN("2026-06-01T00:00:00Z", 30)];
    for (const figure of [
      runsPerMonth(READ(rows, { truncated: true })),
      recentOverallScores(READ(rows, { truncated: true })),
    ]) {
      expect(figure.points).toEqual([]);
      expect(figure.blockedKind).toBe("truncated");
    }
  });
});

/**
 * AN IMPOSSIBLE COUNT IS A FAULT, NOT A QUIET QUEUE.
 *
 * `lanePressure` used to write `Math.max(0, lane.value)`. A lane count is the
 * size of a queue: a negative one cannot happen, and its appearance means
 * something upstream is counting wrong. The clamp turned that bug into all-zero
 * lanes, which fell through to the all-clear branch and told the planner "Every
 * lane is clear — nothing is queued". DECIDED 2026-08-13: surface it. A wrong
 * number a planner can see beats a reassuring sentence they cannot check.
 */
describe("an impossible lane count", () => {
  it("blocks the figure and names the lane and the value", () => {
    const series = lanePressure([
      { label: "RTP", value: 0, detail: "RTP packets" },
      { label: "Grants", value: -3, detail: "Open opportunities" },
    ]);

    expect(series.points).toEqual([]);
    expect(series.blockedKind).toBe("impossible");
    expect(series.blockedReason).toContain("Grants (-3)");
    expect(series.blockedReason).toMatch(/counting wrong/i);
    // The sentence must explicitly refuse the reading the clamp used to produce.
    expect(series.blockedReason).not.toMatch(/Every lane is clear/);
  });

  it("does not let a negative lane read as an all-clear workspace", () => {
    const series = lanePressure([
      { label: "RTP", value: 0, detail: "RTP packets" },
      { label: "Grants", value: -1, detail: "Open opportunities" },
      { label: "Reports", value: 0, detail: "Report packets" },
    ]);

    // With the old clamp every value became 0 and this said "Every lane is clear".
    expect(series.blockedReason).not.toMatch(/Every lane is clear/);
    expect(series.blockedKind).toBe("impossible");
  });

  it("blocks a NaN lane too — a subtraction of two missing counts is not zero work", () => {
    const series = lanePressure([{ label: "Grants", value: Number.NaN, detail: "Open" }]);
    expect(series.blockedKind).toBe("impossible");
  });

  it("still draws a genuine zero beside real work", () => {
    const series = lanePressure([
      { label: "RTP", value: 0, detail: "RTP packets" },
      { label: "Grants", value: 3, detail: "Open opportunities" },
    ]);
    expect(series.blockedReason).toBeNull();
    expect(series.points.map((point) => point.value)).toEqual([0, 3]);
  });
});
