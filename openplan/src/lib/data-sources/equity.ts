/**
 * Equity screening using CEJST (Climate & Economic Justice Screening Tool)
 * and EJScreen data.
 *
 * CEJST identifies "disadvantaged communities" per the Justice40 Initiative.
 * This module checks whether corridor tracts are flagged as disadvantaged
 * and provides equity indicators.
 *
 * Data source: https://screeningtool.geoplatform.gov/
 * API: https://screeningtool.geoplatform.gov/en/methodology
 */

export interface EquityScreening {
  totalTracts: number;
  disadvantagedTracts: number;
  pctDisadvantaged: number;
  ejIndicators: {
    lowIncome: boolean;           // Below 65th percentile FPL
    highMinority: boolean;        // Above area median minority %
    linguisticallyIsolated: boolean;
    highPoverty: boolean;         // Above 20% poverty rate
    lowVehicleAccess: boolean;    // Above 10% zero-vehicle HH
    transitDependent: boolean;    // High transit mode share relative to area
  };
  title6Flags: string[];
  justice40Eligible: boolean;
  equityScore: number; // 0-100 composite
  source: "census-derived";
}

/**
 * Derive equity screening from Census ACS data already fetched.
 * This avoids an additional API call to CEJST (which has rate limits)
 * by using the same underlying indicators the CEJST tool uses.
 */
export function screenEquity(
  censusData: {
    pctMinority: number;
    pctBelowPoverty: number;
    pctZeroVehicle: number;
    pctTransit: number;
    medianIncomeWeighted: number | null;
    tracts: Array<{
      geoid: string;
      pctMinority: number;
      pctBelowPoverty: number;
      medianIncome: number | null;
      zeroVehicleHouseholds: number;
      totalHouseholds: number;
    }>;
  }
): EquityScreening {
  const tracts = censusData.tracts;

  // Determine disadvantaged status per tract using CEJST-aligned thresholds
  // A tract is "disadvantaged" if it exceeds thresholds on income AND at least
  // one environmental/health/transportation burden indicator
  const disadvantagedCount = tracts.filter((t) => {
    const isLowIncome = t.medianIncome !== null && t.medianIncome < 50000; // ~65th percentile nationally
    const hasBurden =
      t.pctBelowPoverty > 20 ||
      t.pctMinority > 50 ||
      (t.totalHouseholds > 0 && t.zeroVehicleHouseholds / t.totalHouseholds > 0.1);
    return isLowIncome && hasBurden;
  }).length;

  const pctDisadvantaged =
    tracts.length > 0 ? Math.round((disadvantagedCount / tracts.length) * 1000) / 10 : 0;

  // Indicator flags
  const ejIndicators = {
    lowIncome:
      censusData.medianIncomeWeighted !== null && censusData.medianIncomeWeighted < 50000,
    highMinority: censusData.pctMinority > 40,
    linguisticallyIsolated: false, // would need ACS B16002 data; omit for MVP
    highPoverty: censusData.pctBelowPoverty > 20,
    lowVehicleAccess: censusData.pctZeroVehicle > 10,
    transitDependent: censusData.pctTransit > 15,
  };

  // Title VI flags — call out specific concerns for grant applications
  const title6Flags: string[] = [];
  if (ejIndicators.highMinority)
    title6Flags.push("Corridor serves a high proportion of minority residents");
  if (ejIndicators.lowIncome)
    title6Flags.push("Median household income is below the 65th percentile threshold");
  if (ejIndicators.highPoverty)
    title6Flags.push("Poverty rate exceeds 20% — qualifies as a high-poverty area");
  if (ejIndicators.lowVehicleAccess)
    title6Flags.push("Significant proportion of households lack vehicle access");
  if (ejIndicators.transitDependent)
    title6Flags.push("High transit dependency indicates need for multimodal investment");

  // Justice40 eligibility: any disadvantaged tract in the corridor
  const justice40Eligible = disadvantagedCount > 0;

  // Composite equity score: higher = MORE equitable need (i.e., higher priority for investment)
  // Inverted so that higher disadvantage = higher score = higher priority
  const factors = [
    censusData.pctMinority > 50 ? 20 : censusData.pctMinority > 30 ? 12 : 5,
    censusData.pctBelowPoverty > 25 ? 20 : censusData.pctBelowPoverty > 15 ? 12 : 5,
    censusData.pctZeroVehicle > 15 ? 20 : censusData.pctZeroVehicle > 8 ? 12 : 5,
    pctDisadvantaged > 50 ? 20 : pctDisadvantaged > 25 ? 12 : 5,
    ejIndicators.lowIncome ? 10 : 3,
    ejIndicators.transitDependent ? 10 : 3,
  ];
  const equityScore = Math.min(100, factors.reduce((s, f) => s + f, 0));

  return {
    totalTracts: tracts.length,
    disadvantagedTracts: disadvantagedCount,
    pctDisadvantaged,
    ejIndicators,
    title6Flags,
    justice40Eligible,
    equityScore,
    source: "census-derived",
  };
}
