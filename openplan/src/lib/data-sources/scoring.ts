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
  safetyScore: number;
  equityScore: number;
  overallScore: number;
  confidence: "high" | "medium" | "low";
  dataQuality: {
    censusAvailable: boolean;
    crashDataAvailable: boolean;
    lodesSource: string;
    equitySource: string;
  };
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

/**
 * Compute accessibility score based on multimodal commute patterns
 * and employment density.
 *
 * Higher transit/walk/bike mode share → higher score
 * Higher jobs-per-resident ratio → higher score
 * Lower zero-vehicle rate with good alternatives → higher score
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
  const stopDensityComponent = Math.min(20, transit.stopsPerSqMile * 2.2);

  // Vehicle independence: areas where people CAN get around without a car
  const vehicleIndependence =
    census.pctZeroVehicle > 5 && multimodalShare > 15
      ? 16
      : census.pctZeroVehicle > 3 && multimodalShare > 8
        ? 10
        : 4;

  return clamp(
    multimodalComponent +
      jobAccessComponent +
      commuteTransitComponent +
      stopDensityComponent +
      vehicleIndependence
  );
}

/**
 * Compute safety score. INVERTED: higher crash rate → LOWER score.
 * This represents how safe the corridor currently is.
 * A low safety score = strong justification for safety investment.
 */
function computeSafety(crashes: CrashSummary): number {
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

  // Overall: weighted average (accessibility 35%, safety 35%, equity 30%)
  const overallScore = clamp(
    accessibilityScore * 0.35 + safetyScore * 0.35 + equityScore * 0.30
  );

  // Data quality assessment
  const censusAvailable = census.tracts.length > 0;
  const crashDataAvailable = !crashes.source.includes("estimate");

  const confidence =
    censusAvailable && crashDataAvailable
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
      lodesSource: lodes.source,
      equitySource: equity.source,
    },
  };
}
