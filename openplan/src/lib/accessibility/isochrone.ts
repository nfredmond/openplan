export type WalkBikeAccessTier = "low" | "medium" | "high";

export interface WalkBikeAccessInputs {
  pctWalk: number;
  pctBike: number;
  pctZeroVehicle: number;
  transitStopsPerSqMile: number;

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

  const stopDensityScore = bucketScore(
    Math.max(0, inputs.transitStopsPerSqMile),
    [
      [5, 2],
      [15, 6],
      [30, 10],
    ],
    14
  );

  // Reserved for future deterministic network metrics.
  const networkCoverageScore = 0;
  const opportunityScore = 0;

  const rawScore =
    modeShareScore +
    zeroVehicleScore +
    stopDensityScore +
    networkCoverageScore +
    opportunityScore;

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
    `transit stop density ${roundPct(inputs.transitStopsPerSqMile)}/sq mi.`;

  return {
    tier,
    scoreBoost,
    rationale,
    rawScore,
  };
}
