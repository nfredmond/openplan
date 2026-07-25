export type WalkBikeAccessTier = "low" | "medium" | "high";

export interface WalkBikeAccessInputs {
  pctWalk: number;
  pctBike: number;
  pctZeroVehicle: number;
  /**
   * Null when no transit source answered. The stop-density term is then dropped
   * and the remaining signals rescaled — treating "not measured" as 0/sq mi
   * would score an unmeasured area as if it had been measured and found bare.
   */
  transitStopsPerSqMile: number | null;

  // Future network provider signals (OpenTripPlanner, Valhalla, etc.) can be
  // merged here once deterministic catchments are available from OSM routing.
  walkCatchmentCoveragePct?: number;
  bikeCatchmentCoveragePct?: number;
  destinationOpportunityDensity?: number;
}

export interface WalkBikeAccessClassification {
  tier: WalkBikeAccessTier;
  scoreBoost: number;
  rationale: string;
  rawScore: number;
}

function bucketScore(
  value: number,
  buckets: Array<[maxExclusive: number, score: number]>,
  fallback: number
): number {
  for (const [maxExclusive, score] of buckets) {
    if (value < maxExclusive) return score;
  }
  return fallback;
}

function roundPct(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

/** Component ceilings, named so the rescale cannot drift from the buckets. */
const MAX_STOP_DENSITY_SCORE = 14;
const MAX_WITHOUT_STOP_DENSITY = 30 + 14; // mode share, zero-vehicle
const MAX_WITH_STOP_DENSITY = MAX_WITHOUT_STOP_DENSITY + MAX_STOP_DENSITY_SCORE;

/**
 * Deterministic baseline for network accessibility classification.
 *
 * Current release intentionally avoids external network APIs and uses
 * transparent proxy signals available in the analysis request pipeline.
 *
 * Future integration: replace or augment proxy components with observed
 * walk/bike isochrone catchments and destination opportunities.
 */
export function classifyWalkBikeAccess(inputs: WalkBikeAccessInputs): WalkBikeAccessClassification {
  const walkBikeModeShare = Math.max(0, inputs.pctWalk + inputs.pctBike);

  // Proxy components (all deterministic).
  const modeShareScore = bucketScore(
    walkBikeModeShare,
    [
      [5, 4],
      [10, 10],
      [15, 16],
      [25, 24],
    ],
    30
  );

  const zeroVehicleScore = bucketScore(
    Math.max(0, inputs.pctZeroVehicle),
    [
      [5, 2],
      [10, 6],
      [20, 10],
    ],
    14
  );

  const stopDensityMeasured = inputs.transitStopsPerSqMile !== null;
  const stopDensityScore = stopDensityMeasured
    ? bucketScore(
        Math.max(0, inputs.transitStopsPerSqMile as number),
        [
          [5, 2],
          [15, 6],
          [30, 10],
        ],
        14
      )
    : 0;

  // Reserved for future deterministic network metrics.
  const networkCoverageScore = 0;
  const opportunityScore = 0;

  const measuredScore =
    modeShareScore + zeroVehicleScore + networkCoverageScore + opportunityScore;

  // Rescale onto the full range when the transit term is absent, so the tier
  // thresholds below keep meaning the same thing.
  const rawScore = stopDensityMeasured
    ? measuredScore + stopDensityScore
    : Math.round((measuredScore / MAX_WITHOUT_STOP_DENSITY) * MAX_WITH_STOP_DENSITY);

  let tier: WalkBikeAccessTier = "low";
  let scoreBoost = 0;

  if (rawScore >= 39) {
    tier = "high";
    scoreBoost = 8;
  } else if (rawScore >= 21) {
    tier = "medium";
    scoreBoost = 4;
  }

  const rationale =
    `Proxy signals: walk+bike mode share ${roundPct(walkBikeModeShare)}%, ` +
    `zero-vehicle households ${roundPct(inputs.pctZeroVehicle)}%, ` +
    (stopDensityMeasured
      ? `transit stop density ${roundPct(inputs.transitStopsPerSqMile as number)}/sq mi.`
      : "transit stop density not available — scored without it, not as zero.");

  return {
    tier,
    scoreBoost,
    rationale,
    rawScore,
  };
}
