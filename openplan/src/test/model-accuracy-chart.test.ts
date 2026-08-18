import { describe, expect, it } from "vitest";

import {
  accuracyScatterRows,
  accuracyScatterSvg,
  type AccuracyPoint,
} from "@/lib/models/charts/accuracy-scatter";
import { CHART_PALETTE } from "@/lib/models/charts/palette";

/**
 * THE CHART A MODELLER READS FIRST, AND WHAT IT MUST NOT DO.
 *
 * A median error hides the shape of the error. This chart shows bias, spread
 * and outliers at once — and it would have exposed the ramp-matching defect
 * (tiny observed counts against mainline volumes) the day it shipped, because
 * those points land in a vertical stripe far off the 1:1 line.
 *
 * What it must not do is propose a correction. There is no fitted line here on
 * purpose: reading a scalar off a chart is the trap this lane has documented.
 */

function point(observed: number, modelled: number, label = "Station"): AccuracyPoint {
  return { stationId: `S${observed}-${modelled}`, label, observed, modelled };
}

const REALISTIC: AccuracyPoint[] = [
  point(37000, 29040, "SR 432 mainline"),
  point(12000, 14500, "Main Street"),
  point(5500, 9800, "County Road 12"),
  point(410, 29040, "R1 ramp mismatched to mainline"),
  point(80, 140, "Rural collector"),
];

describe("the modelled-versus-observed scatter", () => {
  it("draws one point per usable station", () => {
    const svg = accuracyScatterSvg(REALISTIC);
    expect((svg.match(/<circle/g) ?? []).length).toBe(REALISTIC.length);
  });

  it("puts the 1:1 line where model equals observed, and labels it", () => {
    const svg = accuracyScatterSvg(REALISTIC);
    expect(svg).toContain("model = observed");
  });

  it("marks a point more than 2x off in the critical colour, with the ratio in its tooltip", () => {
    // The ramp mismatch: 410 observed against 29,040 modelled.
    const svg = accuracyScatterSvg(REALISTIC);
    expect(svg).toContain(CHART_PALETTE.light.critical);
    expect(svg).toContain("70.83×");
  });

  it("keeps a point inside the band in the ordinary series colour", () => {
    const svg = accuracyScatterSvg([point(12000, 14500)]);
    expect(svg).toContain(CHART_PALETTE.light.series[0]);
    expect(svg).not.toContain(CHART_PALETTE.light.critical);
  });

  it("uses a log scale so four orders of magnitude are all readable", () => {
    // On a linear scale an 80-vehicle station and an 87,000-vehicle station
    // cannot both be seen; the small one collapses onto the origin.
    const svg = accuracyScatterSvg([point(80, 90), point(87000, 80000)]);
    const cx = [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(cx).toHaveLength(2);
    // The small station must sit meaningfully inside the plot, not on the axis.
    expect(Math.min(...cx)).toBeGreaterThan(70);
  });

  it("never draws a fitted line a reader could take a correction factor from", () => {
    const svg = accuracyScatterSvg(REALISTIC);
    expect(svg.toLowerCase()).not.toMatch(/regression|best fit|trend/);
  });

  it("says so plainly when no station matched, instead of drawing empty axes", () => {
    const svg = accuracyScatterSvg([]);
    expect(svg).toContain("nothing to compare");
    expect(svg).not.toContain("<circle");
  });

  it("drops a station whose numbers cannot be plotted rather than placing it at zero", () => {
    // A zero or negative observed count has no place on a log scale, and
    // pinning it to the axis would read as a perfect miss.
    const svg = accuracyScatterSvg([point(0, 5000), point(12000, 14500)]);
    expect((svg.match(/<circle/g) ?? []).length).toBe(1);
  });

  it("escapes a station label so a stray quote cannot break the drawing", () => {
    const svg = accuracyScatterSvg([point(100, 120, 'SR "20" & Main <test>')]);
    expect(svg).toContain("&quot;20&quot;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("<test>");
  });

  it("offers a dark-mode rendering with its own validated steps", () => {
    const svg = accuracyScatterSvg(REALISTIC, { mode: "dark" });
    expect(svg).toContain(CHART_PALETTE.dark.surface);
    expect(svg).toContain(CHART_PALETTE.dark.series[0]);
  });

  it("carries a title and caption when given them, for a report reader", () => {
    const svg = accuracyScatterSvg(REALISTIC, {
      title: "Modelled volume against observed count",
      subtitle: "57 stations, Nevada County, uncalibrated",
    });
    expect(svg).toContain("Modelled volume against observed count");
    expect(svg).toContain("57 stations");
  });
});

describe("the table beside the chart", () => {
  it("exists, because a chart is never the only channel", () => {
    const rows = accuracyScatterRows(REALISTIC);
    expect(rows).toHaveLength(REALISTIC.length);
  });

  it("puts the worst-matched station first, whichever direction it is wrong in", () => {
    const rows = accuracyScatterRows(REALISTIC);
    expect(rows[0].label).toBe("R1 ramp mismatched to mainline");
    // and a badly UNDER-modelled station outranks a near-perfect one
    const withUnder = accuracyScatterRows([point(20000, 1000, "under"), point(1000, 1010, "close")]);
    expect(withUnder[0].label).toBe("under");
  });
});
