import { describe, expect, it } from "vitest";

import { roadClassBarsSvg, type RoadClassShare } from "@/lib/models/charts/road-class-bars";
import { CHART_PALETTE } from "@/lib/models/charts/palette";

/**
 * WHERE THE MODEL PUTS ITS TRAVEL, AGAINST WHERE TRAVEL ACTUALLY HAPPENS.
 *
 * Measured 2026-08-17 over 24 counties: 37% of modelled vehicle miles land on
 * principal arterials where FHWA's published figure is 21%, and 26% on
 * freeways where the real share is 45%. No summary statistic conveys that —
 * two distributions side by side do.
 *
 * The last two tests here exist because BOTH bugs shipped in the first
 * version and were caught only by rendering the chart and looking at it: the
 * legend overlapped the title, and the widest bar's value label fell outside
 * the viewBox.
 */

const MEASURED: RoadClassShare[] = [
  { label: "Freeway", model: 0.259, published: 0.448 },
  { label: "Principal arterial", model: 0.373, published: 0.21 },
  { label: "Minor arterial", model: 0.158, published: 0.158 },
  { label: "Collector", model: 0.092, published: 0.113 },
  { label: "Local", model: 0.034, published: 0.071 },
];

function viewBox(svg: string): { width: number; height: number } {
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return { width: Number(match?.[1]), height: Number(match?.[2]) };
}

describe("the road-class comparison", () => {
  it("draws a paired bar for every class", () => {
    const svg = roadClassBarsSvg(MEASURED);
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(MEASURED.length * 2);
  });

  it("labels every bar with its own value, so colour is never the only channel", () => {
    const svg = roadClassBarsSvg(MEASURED);
    expect(svg).toContain(">26%<");
    expect(svg).toContain(">45%<");
    expect(svg).toContain(">37%<");
    expect(svg).toContain(">21%<");
  });

  it("always carries a legend, because there are two series", () => {
    const svg = roadClassBarsSvg(MEASURED, { modelLabel: "This model", publishedLabel: "Published (FHWA)" });
    expect(svg).toContain("This model");
    expect(svg).toContain("Published (FHWA)");
  });

  it("keeps the legend clear of the title row", () => {
    // THE FIRST BUG. At 560px wide the right-aligned legend overlapped a long
    // title, which no palette check could have caught.
    const svg = roadClassBarsSvg(MEASURED, {
      title: "Where travel happens: this model against published figures",
      subtitle: "Share of daily vehicle miles · 24 counties · FHWA Highway Statistics 2022",
    });
    const legendY = Number(svg.match(/<rect x="16" y="([\d.]+)" width="10"/)?.[1]);
    const subtitleY = Number(svg.match(/y="36"[^>]*font-size="11"/) ? 36 : 0);
    expect(legendY).toBeGreaterThan(subtitleY);
    expect(legendY).toBeGreaterThanOrEqual(40);
  });

  it("keeps the widest bar's value label inside the drawing", () => {
    // THE SECOND BUG. "45%" sat past the right edge of the viewBox.
    const svg = roadClassBarsSvg(MEASURED);
    const { width } = viewBox(svg);
    const labelXs = [...svg.matchAll(/<text x="([\d.]+)"[^>]*font-size="10"[^>]*>\d+%</g)].map((m) => Number(m[1]));
    expect(labelXs.length).toBeGreaterThan(0);
    // Allow room for the text itself, not just its anchor.
    expect(Math.max(...labelXs)).toBeLessThanOrEqual(width - 24);
  });

  it("scales bars against the largest share present, not a fixed 100%", () => {
    // Otherwise every bar in a realistic distribution is a stub.
    const svg = roadClassBarsSvg([{ label: "One", model: 0.1, published: 0.05 }]);
    const widths = [...svg.matchAll(/<rect x="104" y="[\d.]+" width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...widths)).toBeGreaterThan(300);
  });

  it("says so when the run recorded no breakdown, rather than drawing empty axes", () => {
    const svg = roadClassBarsSvg([]);
    expect(svg).toContain("No road-class breakdown");
  });

  it("renders in dark mode with the dark steps", () => {
    const svg = roadClassBarsSvg(MEASURED, { mode: "dark" });
    expect(svg).toContain(CHART_PALETTE.dark.surface);
    expect(svg).toContain(CHART_PALETTE.dark.series[1]);
  });

  it("escapes a class label rather than letting it break the drawing", () => {
    const svg = roadClassBarsSvg([{ label: 'Trunk & "other"', model: 0.2, published: 0.1 }]);
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;");
  });
});
