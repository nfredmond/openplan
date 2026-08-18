import { describe, expect, it } from "vitest";

import { accuracyByClassRows, accuracyByClassSvg, type RoadClassAccuracy } from "@/lib/models/charts/accuracy-by-class";
import { CHART_PALETTE } from "@/lib/models/charts/palette";

/**
 * THE FIGURE A FUNDER READS, AND THE ONE IT MUST NOT LET THEM MISREAD.
 *
 * A single median error is true of no road in particular. Measured across 24
 * counties, a run's error on freeways and on collectors differ by a factor of
 * three, so a corridor number quoted from the overall figure inherits an
 * accuracy nobody stated.
 *
 * The trap this guards: Nevada County's tertiary roads show a 1% median error
 * — over ONE station. Drawn without that context it is the best number on the
 * chart and the least trustworthy.
 */

const NEVADA: RoadClassAccuracy[] = [
  { roadClass: "motorway", stations: 25, medianAbsolutePercentError: 42.73, medianModelOverObserved: 0.621 },
  { roadClass: "trunk", stations: 13, medianAbsolutePercentError: 184.2, medianModelOverObserved: 2.84 },
  { roadClass: "primary", stations: 33, medianAbsolutePercentError: 227.8, medianModelOverObserved: 3.28 },
  { roadClass: "secondary", stations: 3, medianAbsolutePercentError: 100, medianModelOverObserved: 0.88 },
  { roadClass: "tertiary", stations: 1, medianAbsolutePercentError: 1.2, medianModelOverObserved: 1.01 },
];

describe("accuracy by road class", () => {
  it("draws a bar per class with its own error and station count", () => {
    const svg = accuracyByClassSvg(NEVADA);
    expect(svg).toContain("43% · 25 stn");
    expect(svg).toContain("228% · 33 stn");
  });

  it("marks a class with too few stations rather than letting its number stand", () => {
    // The whole point: 1.2% over one station is the best-looking figure here.
    const svg = accuracyByClassSvg(NEVADA);
    expect(svg).toContain("1% · 1 stn · too few to rely on");
    expect(svg).toContain("100% · 3 stn · too few to rely on");
  });

  it("does not mark a well-sampled class as thin", () => {
    const svg = accuracyByClassSvg(NEVADA);
    expect(svg).not.toContain("43% · 25 stn · too few");
  });

  it("draws the screening threshold so pass and fail are visible without a verdict", () => {
    const svg = accuracyByClassSvg(NEVADA);
    expect(svg).toContain("30% screening threshold");
    expect(svg).toContain("stroke-dasharray");
  });

  it("colours a class inside the gate differently from one outside it", () => {
    const svg = accuracyByClassSvg([
      { roadClass: "motorway", stations: 30, medianAbsolutePercentError: 22 },
      { roadClass: "primary", stations: 30, medianAbsolutePercentError: 220 },
    ]);
    expect(svg).toContain(CHART_PALETTE.light.good);
    expect(svg).toContain(CHART_PALETTE.light.series[1]);
  });

  it("never rests pass or fail on colour alone", () => {
    // Every bar carries its own percentage in text beside it.
    const svg = accuracyByClassSvg(NEVADA);
    for (const expected of ["43%", "184%", "228%", "100%", "1%"]) {
      expect(svg).toContain(expected);
    }
  });

  it("says the accuracy is unmeasured when no station matched", () => {
    const svg = accuracyByClassSvg([]);
    expect(svg).toContain("unmeasured");
  });

  it("keeps the longest annotation inside the drawing", () => {
    const svg = accuracyByClassSvg(NEVADA);
    const width = Number(svg.match(/viewBox="0 0 ([\d.]+)/)?.[1]);
    const xs = [...svg.matchAll(/<text x="([\d.]+)"[^>]*font-size="10"[^>]*>[\d.]+%/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThan(width - 40);
  });

  it("orders the table from most accurate to least, for a reader scanning it", () => {
    const rows = accuracyByClassRows(NEVADA);
    expect(rows[0].roadClass).toBe("tertiary");
    expect(rows[rows.length - 1].roadClass).toBe("primary");
  });
});
