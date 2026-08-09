import { describe, expect, it } from "vitest";

import {
  lanePressure,
  medianOverallScore,
  recentOverallScores,
  reportsGenerated,
  runsPerMonth,
} from "@/lib/dashboard/insights";

/**
 * A FIGURE THAT CANNOT BE DRAWN MUST SAY WHY.
 *
 * The charting version of the rule this product keeps everywhere else. An empty
 * axis is not neutral: a trend line through one point reads as "flat", a bar
 * chart of zeros reads as "measured zero", and both are findings that nobody
 * made. So every series resolves to either points or a sentence naming what
 * would produce it.
 */
const RUN = (created_at: string, overallScore?: number, reports = 0) => ({
  created_at,
  metrics: overallScore === undefined ? {} : { overallScore },
  report_generated_count: reports,
});

describe("runs per month", () => {
  it("refuses to plot a trend with no runs, and says so", () => {
    const series = runsPerMonth([]);
    expect(series.points).toEqual([]);
    expect(series.blockedReason).toMatch(/No analysis runs are recorded yet/);
  });

  it("refuses a trend when every run falls in one month", () => {
    const series = runsPerMonth([RUN("2026-08-01T00:00:00Z"), RUN("2026-08-20T00:00:00Z")]);
    expect(series.points).toEqual([]);
    expect(series.blockedReason).toMatch(/at least two months/);
  });

  /**
   * The gap month is the point. Skipping it would draw a straight line from May
   * to July and invent June activity that did not happen.
   */
  it("fills a month with no runs as zero rather than skipping it", () => {
    const series = runsPerMonth([RUN("2026-05-04T00:00:00Z"), RUN("2026-07-04T00:00:00Z")]);

    expect(series.blockedReason).toBeNull();
    expect(series.points.map((p) => p.value)).toEqual([1, 0, 1]);
    expect(series.points).toHaveLength(3);
  });

  /** "Aug 26" reads as a day of the month — the one thing a monthly axis must not say. */
  it("labels months with a four-digit year", () => {
    const series = runsPerMonth([RUN("2026-05-04T00:00:00Z"), RUN("2026-06-04T00:00:00Z")]);
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
    const series = recentOverallScores([
      RUN("2026-05-01T00:00:00Z", 62),
      RUN("2026-05-02T00:00:00Z"),
      RUN("2026-05-03T00:00:00Z", 41),
    ]);

    expect(series.points.map((p) => p.value)).toEqual([62, 41]);
    expect(series.points.some((p) => p.value === 0)).toBe(false);
  });

  it("says nothing has scored rather than drawing an empty axis", () => {
    const series = recentOverallScores([RUN("2026-05-02T00:00:00Z")]);
    expect(series.points).toEqual([]);
    expect(series.blockedReason).toMatch(/No run has recorded a composite score/);
  });

  it("keeps the most recent runs when there are more than the limit", () => {
    const runs = Array.from({ length: 20 }, (_, i) =>
      RUN(`2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`, i)
    );
    const series = recentOverallScores(runs, 5);
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
