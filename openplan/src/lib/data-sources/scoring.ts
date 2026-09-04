/**
 * Composite scoring engine for corridor analysis.
 *
 * Combines Census demographics, employment data, equity screening,
 * and crash data into three headline scores:
 *   - Accessibility Score (0-100)
 *   - Safety Score (0-100)
 *   - Equity Score (0-100)
 *
 * These scores are designed to be defensible in grant applications
 * (ATP, SS4A, RAISE) where quantitative justification is required.
 */

import type { CensusSummary } from "./census";
import type { LODESSummary } from "./lodes";
import type { CrashSummary } from "./crashes";
import type { EquityScreening } from "./equity";
import type { TransitAccessSummary } from "./transit";

export interface CorridorScores {
  accessibilityScore: number;
  /** Null when no crash source answered — never a fabricated stand-in. */
  safetyScore: number | null;
  equityScore: number;
  overallScore: number;
  confidence: "high" | "medium" | "low";
  dataQuality: {
    censusAvailable: boolean;
    crashDataAvailable: boolean;
    /** False when a source answered but its record extract hit the analysis cap. */
    crashDataComplete: boolean;
    /**
     * False when no transit source answered, so the accessibility score carries
     * no stop-density term. Recorded because the score alone cannot say which
     * inputs it was built from.
     */
    transitDataAvailable: boolean;
    lodesSource: string;
    equitySource: string;
  };
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

/** Component ceilings, named so the rescale below cannot drift from them. */
const ACCESSIBILITY_STOP_DENSITY_MAX = 20;
const ACCESSIBILITY_MAX_WITHOUT_STOP_DENSITY = 20 + 20 + 20 + 16; // multimodal, jobs, commute, vehicle independence
const ACCESSIBILITY_MAX_WITH_STOP_DENSITY =
  ACCESSIBILITY_MAX_WITHOUT_STOP_DENSITY + ACCESSIBILITY_STOP_DENSITY_MAX;

/**
 * Points per stop per square mile, saturating at `ACCESSIBILITY_STOP_DENSITY_MAX`.
 *
 * Pulled out of the expression it used to be typed into so the two places that
 * now use it — the whole term, and its halved form when a source can also speak
 * to frequency — cannot drift into two different curves.
 */
const ACCESSIBILITY_POINTS_PER_STOP_PER_SQ_MILE = 2.2;

/**
 * HOW THE TRANSIT TERM SPLITS WHEN A SOURCE KNOWS FREQUENCY, AND WHY THE
 * CEILING DOES NOT MOVE.
 *
 * A count of stops is a count of places a bus COULD stop. It says nothing about
 * whether one comes every eight minutes or twice a day, and a corridor of the
 * second kind is not accessible in any sense a rider would recognise. When the
 * transit source is the agency's own published schedule, half the term is
 * therefore the share of stops meeting a frequent-service peak headway.
 *
 * THE CEILING IS UNCHANGED AT `ACCESSIBILITY_STOP_DENSITY_MAX` ON PURPOSE. The
 * composite is a weighted average over component maxima; moving this one would
 * silently re-weight accessibility against safety and equity in every run, in
 * both directions, for reasons that have nothing to do with transit. What
 * changes is what fills the twenty points, never how many there are.
 *
 * THE DENSITY CURVE IS HALVED, NOT RESCALED. `min(20, density × 2.2) / 2`
 * saturates at the same 9.1 stops per square mile the whole term always did;
 * halving the CEILING instead (`min(10, density × 2.2)`) would have saturated at
 * 4.5, which quietly redefines what a dense corridor is while appearing to be
 * the same arithmetic.
 *
 * A SOURCE THAT CANNOT SPEAK TO FREQUENCY AT ALL KEEPS THE WHOLE TERM AS
 * DENSITY. OpenStreetMap records where a stop is and nothing about what calls
 * there, so it has no opinion on frequency and its runs stay on the density-only
 * scale they have always been on. That is what makes this whole lane move NO
 * score for a workspace that has ingested no feed: an OSM-backed run scores
 * today exactly what it scored before, which is a property worth being able to
 * state to anyone who asks why their number changed.
 *
 * ============ THE INVARIANT, AND THE INVERSION THAT MADE IT WORTH WRITING DOWN
 *
 * > MORE INFORMATION MUST NEVER PRODUCE A HIGHER TRANSIT TERM. For a fixed set
 * > of stops measured by a frequency-capable source, a run that measured
 * > frequency for MORE of them must score at least what a run that measured it
 * > for fewer scores.
 *
 * This function used to hand back the WHOLE density term whenever
 * `frequentServiceShare` was not a finite number — and `summarizeContributions`
 * sets that share null whenever the feed's own stops do not span the study area.
 * So a PARTIAL-coverage GTFS run scored 6.45 transit points ABOVE a FULL-coverage
 * run over the identical stops: an agency whose feed covered its corridor
 * completely got a WORSE number than one whose feed covered a third of it. That
 * is the same hazard this lane already refuses elsewhere — "refusing to measure
 * is not neutral, it rescales the remainder upward", which is exactly why an
 * expired feed still scores.
 *
 * THE FIX IS THAT AN UNMEASURED HALF IS NOT AN EARNED ONE. When the source
 * measures frequency, the frequency half is filled by the share it demonstrated
 * and by nothing else; a share it could not state for this area fills zero of it,
 * which is identical to a share it stated as zero. Withholding is therefore the
 * FLOOR of measuring rather than the ceiling, and the ordering
 * `full >= partial` holds for every density by construction rather than by
 * example. Pinned as a property in `transit-term-monotonicity.test.ts`.
 *
 * WHAT THIS COSTS, STATED PLAINLY: a workspace whose ingested feed covers only
 * part of its corridor loses up to ten accessibility points against what it
 * scored before — the largest single movement in this lane — and it can score
 * BELOW an OpenStreetMap run over the same corridor, because the OSM path is
 * deliberately left on its old full-density scale. Those two runs are already
 * declared un-subtractable by `transitComparabilityRefusal`, so the cross-source
 * ordering is a comparability question rather than a scoring one; the ordering
 * that had to be repaired is the one WITHIN the source that can measure.
 */
const ACCESSIBILITY_STOP_DENSITY_HALF = ACCESSIBILITY_STOP_DENSITY_MAX / 2;
const ACCESSIBILITY_FREQUENT_SERVICE_HALF = ACCESSIBILITY_STOP_DENSITY_MAX / 2;

/**
 * The transit term of the accessibility score, exported so the number that
 * MOVES can be tested on its own rather than inferred from a composite.
 */
export function accessibilityTransitTerm(transit: {
  stopsPerSqMile: number | null;
  frequentServiceShare: number | null;
  /**
   * Whether the SOURCE measures frequency at all. See `TransitAccessSummary`.
   *
   * ABSENT MEANS NO, and that default is deliberate rather than defensive: every
   * caller that cannot say is describing a run from before this distinction
   * existed, and every one of those was measured by the density-only source. A
   * partially-shaped caller therefore gets the legacy scale rather than a
   * silently halved score.
   */
  measuresFrequency?: boolean;
}): number {
  if (transit.stopsPerSqMile === null) return 0;

  const density = Math.min(
    ACCESSIBILITY_STOP_DENSITY_MAX,
    transit.stopsPerSqMile * ACCESSIBILITY_POINTS_PER_STOP_PER_SQ_MILE
  );

  // A source with no opinion on frequency keeps the whole term as density. This
  // is the OpenStreetMap path and the only path on which the share being absent
  // still earns the frequency half.
  if (transit.measuresFrequency !== true) return density;

  // ANY non-number is "this source could not state a share for this area", which
  // fills ZERO of the frequency half — identical to a share it stated as zero, so
  // withholding can never outscore measuring. `null` is what the adapters send;
  // `undefined` is what a run persisted before this field existed carries, and
  // what a partially-shaped caller sends. Testing only for `null` let `undefined`
  // through into the arithmetic below, where it produced a NaN accessibility
  // score — a headline number that renders as the literal text "NaN" and cannot
  // be compared, sorted, or exported.
  const stated =
    typeof transit.frequentServiceShare === "number" && Number.isFinite(transit.frequentServiceShare)
      ? transit.frequentServiceShare
      : 0;

  const share = Math.max(0, Math.min(1, stated));
  const densityShare = density / ACCESSIBILITY_STOP_DENSITY_MAX;
  return densityShare * ACCESSIBILITY_STOP_DENSITY_HALF + share * ACCESSIBILITY_FREQUENT_SERVICE_HALF;
}

/**
 * Compute accessibility score based on multimodal commute patterns
 * and employment density.
 *
 * Higher transit/walk/bike mode share → higher score
 * Higher jobs-per-resident ratio → higher score
 * Lower zero-vehicle rate with good alternatives → higher score
 *
 * When no transit source answered, the stop-density term is DROPPED and the
 * remaining components are rescaled onto the same footing — not filled with a
 * fabricated stop count, and not left silently capped ~21 points lower, which
 * would read as a genuinely less accessible corridor. This mirrors how
 * `computeCorridorScores` redistributes the safety weight when no crash source
 * answered.
 */
function computeAccessibility(
  census: CensusSummary,
  lodes: LODESSummary,
  transit: TransitAccessSummary
): number {
  // Multimodal share: transit + walk + bike as % of total commuters
  const multimodalShare = census.pctTransit + census.pctWalk + census.pctBike;

  // Score components (20 each + transit coverage 20)
  const multimodalComponent = Math.min(20, multimodalShare * 0.7);
  const jobAccessComponent = Math.min(20, lodes.jobsPerResident * 32);
  const commuteTransitComponent = Math.min(20, census.pctTransit * 1.2);

  // Vehicle independence: areas where people CAN get around without a car
  const vehicleIndependence =
    census.pctZeroVehicle > 5 && multimodalShare > 15
      ? 16
      : census.pctZeroVehicle > 3 && multimodalShare > 8
        ? 10
        : 4;

  const measured =
    multimodalComponent + jobAccessComponent + commuteTransitComponent + vehicleIndependence;

  if (!transit.observed || transit.stopsPerSqMile === null) {
    return clamp(
      (measured / ACCESSIBILITY_MAX_WITHOUT_STOP_DENSITY) * ACCESSIBILITY_MAX_WITH_STOP_DENSITY
    );
  }

  return clamp(measured + accessibilityTransitTerm(transit));
}

/**
 * Compute safety score. INVERTED: higher crash rate → LOWER score.
 * This represents how safe the corridor currently is.
 * A low safety score = strong justification for safety investment.
 */
/**
 * Safety score, or null when no crash source answered.
 *
 * Null is load-bearing. Every count on an unobserved summary is zero by schema,
 * and zeros walk straight through this function's deductions and then EARN THE
 * "no fatalities" BONUS — an area with no crash data scored 95/100, i.e. safer
 * than almost anywhere with real data, and that number flowed into the overall
 * composite and into grant narratives. Absence of evidence is not evidence of
 * safety, so it must not produce a score at all.
 */
function computeSafety(crashes: CrashSummary): number | null {
  // Counts derived from a capped record extract are lower bounds, not corridor
  // totals. They must not drive a score as though the missing records were safe.
  if (!crashes.observed || crashes.truncated) return null;

  // Base: start at 85 (most corridors are reasonably safe)
  let score = 85;

  // Deductions for crash density
  if (crashes.crashesPerSquareMile > 5) score -= 40;
  else if (crashes.crashesPerSquareMile > 2) score -= 25;
  else if (crashes.crashesPerSquareMile > 1) score -= 15;
  else if (crashes.crashesPerSquareMile > 0.5) score -= 8;

  // Extra deductions for vulnerable road user fatalities
  if (crashes.pedestrianFatalities > 0) score -= Math.min(20, crashes.pedestrianFatalities * 5);
  if (crashes.bicyclistFatalities > 0) score -= Math.min(15, crashes.bicyclistFatalities * 5);

  // Bonus: if no fatalities at all
  if (crashes.totalFatalities === 0 && crashes.totalFatalCrashes === 0) score += 10;

  return clamp(score);
}

/**
 * Equity score: directly from the equity screening module.
 */
function computeEquity(equity: EquityScreening): number {
  return clamp(equity.equityScore);
}

/**
 * Compute all three scores and an overall composite.
 */
export function computeCorridorScores(
  census: CensusSummary,
  lodes: LODESSummary,
  transit: TransitAccessSummary,
  crashes: CrashSummary,
  equity: EquityScreening
): CorridorScores {
  const accessibilityScore = computeAccessibility(census, lodes, transit);
  const safetyScore = computeSafety(crashes);
  const equityScore = computeEquity(equity);

  // Overall: weighted average over the components that EXIST. When no crash
  // source answered there is no safety score, and its 35% is redistributed
  // across accessibility and equity rather than filled with a fabricated value.
  const weighted: Array<[number, number]> =
    safetyScore === null
      ? [
          [accessibilityScore, 0.35],
          [equityScore, 0.3],
        ]
      : [
          [accessibilityScore, 0.35],
          [safetyScore, 0.35],
          [equityScore, 0.3],
        ];
  const weightTotal = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  const overallScore = clamp(
    weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / weightTotal
  );

  // Data quality assessment
  const censusAvailable = census.tracts.length > 0;
  // Ask the summary, not its source string. This used to test for "estimate",
  // a tier that no longer exists — so it silently reported every study area as
  // having crash data, including areas where no source covers them at all.
  const crashDataAvailable = crashes.observed;
  const crashDataComplete = crashes.observed && !crashes.truncated;
  const transitDataAvailable = transit.observed;

  // A missing transit inventory cannot leave confidence at "high": the
  // accessibility score was built from fewer inputs than it normally is.
  const confidence =
    censusAvailable && crashDataComplete && transitDataAvailable
      ? "high"
      : censusAvailable || crashDataAvailable
        ? "medium"
        : "low";

  return {
    accessibilityScore,
    safetyScore,
    equityScore,
    overallScore,
    confidence,
    dataQuality: {
      censusAvailable,
      crashDataAvailable,
      crashDataComplete,
      transitDataAvailable,
      lodesSource: lodes.source,
      equitySource: equity.source,
    },
  };
}
