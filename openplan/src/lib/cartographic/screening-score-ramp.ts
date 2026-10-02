import type { ExpressionSpecification } from "mapbox-gl";

/**
 * How a corridor screening score is coloured on a map. One definition, used by
 * the corridor fill and by the score overlays in Corridor Analysis.
 *
 * WHY ONE BLUE, AND NO STEPS. `docs/product/CORRIDOR_SCORE_PRESENTATION_RESEARCH_2026-08-24.md`
 * found no defensible low, medium or high thresholds for any of the four scores
 * and decided against bands and against any claim that a value is good or bad.
 * The maps still painted red at 0, amber near 40 to 60, green near 75 and blue
 * at 90: a traffic-light reading of cut points nobody validated, in colour. Two
 * maps also used two different ramps for the same number.
 *
 * This ramp is a single hue from dim to bright, interpolated straight from 0 to
 * 100 with no stops between, so a higher score is brighter and nothing says
 * where "good" begins. It is drawn on the dark Corridor Analysis basemap, so the
 * low end is a muted blue that stays visible rather than near-black.
 *
 * A score that is not a number (withheld because its evidence was missing) is
 * the neutral grey, never the low end of the ramp.
 */
export const SCREENING_SCORE_LOW = "#2a5a8a";
export const SCREENING_SCORE_HIGH = "#bfe3ff";
export const SCREENING_SCORE_WITHHELD = "#64748b";

export function screeningScorePaint(property: string): ExpressionSpecification {
  return [
    "case",
    ["==", ["typeof", ["get", property]], "number"],
    [
      "interpolate",
      ["linear"],
      ["to-number", ["get", property]],
      0,
      SCREENING_SCORE_LOW,
      100,
      SCREENING_SCORE_HIGH,
    ],
    SCREENING_SCORE_WITHHELD,
  ];
}
