import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildThematicOverlayPaintExpression } from "@/app/(app)/explore/_components/_helpers";
import { buildAnalysisCorridorFillExpression } from "@/app/(app)/explore/_components/explore-analysis-layer-install";
import {
  SCREENING_SCORE_HIGH,
  SCREENING_SCORE_LOW,
  SCREENING_SCORE_WITHHELD,
  screeningScorePaint,
} from "@/lib/cartographic/screening-score-ramp";

/**
 * A SCREENING SCORE IS NOT COLOURED AS GOOD OR BAD.
 *
 * The presentation research (docs/product/CORRIDOR_SCORE_PRESENTATION_RESEARCH_2026-08-24.md)
 * found no defensible bands for any of the four scores. Until October 2026 the
 * maps still painted them red, amber, green and blue at 40, 60, 75 and 90.
 *
 * Blind category: this reads paint expressions and the two Explore source files.
 * It does not see a score coloured in a component that builds its own
 * expression elsewhere, or a legend drawn in HTML.
 */

const SCORE_KEYS = ["overallScore", "accessibilityScore", "safetyScore", "equityScore"] as const;

/** Every numeric stop in an `interpolate` expression, wherever it sits. */
function interpolationStops(expression: unknown): number[] {
  if (!Array.isArray(expression)) return [];
  if (expression[0] === "interpolate") {
    return expression.slice(3).filter((_, index) => index % 2 === 0).map(Number);
  }
  return expression.flatMap((part) => interpolationStops(part));
}

describe("screening scores on maps", () => {
  it("interpolate straight from 0 to 100 with no cut points between", () => {
    for (const key of SCORE_KEYS) {
      expect(interpolationStops(buildThematicOverlayPaintExpression(key))).toEqual([0, 100]);
    }
    expect(interpolationStops(buildAnalysisCorridorFillExpression())).toEqual([0, 100]);
  });

  it("use the one shared ramp everywhere, so the same number is the same colour", () => {
    for (const key of SCORE_KEYS) {
      expect(buildThematicOverlayPaintExpression(key)).toEqual(screeningScorePaint(key));
    }
    expect(buildAnalysisCorridorFillExpression()).toEqual(screeningScorePaint("overallScore"));
  });

  it("paint a withheld score grey, never as the low end", () => {
    const expression = screeningScorePaint("overallScore") as unknown[];
    expect(expression[0]).toBe("case");
    expect(expression.at(-1)).toBe(SCREENING_SCORE_WITHHELD);
    expect(SCREENING_SCORE_WITHHELD).not.toBe(SCREENING_SCORE_LOW);
  });

  it("is one hue: blue at both ends", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const colour of [SCREENING_SCORE_LOW, SCREENING_SCORE_HIGH]) {
      expect(hue(colour)).toBeGreaterThan(195);
      expect(hue(colour)).toBeLessThan(220);
    }
  });

  it("leaves no traffic-light score ramp in the Explore sources", () => {
    // The colours the old ramps used at their low and middle stops.
    const sources = ["_helpers.ts", "explore-analysis-layer-install.ts"].map((file) =>
      readFileSync(path.join(process.cwd(), "src/app/(app)/explore/_components", file), "utf8"),
    );
    const install = sources[1];
    expect(install).not.toMatch(/#7f1d1d|#be8e2f|#34d399/i);
  });
});
