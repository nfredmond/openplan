/**
 * ACS income + burden equity PROXY screening.
 *
 * This module applies transparent proxy thresholds to the tract-level ACS inputs
 * we already fetch (low income + burden indicators: poverty, minority
 * concentration, low vehicle access, transit dependency). It is a SCREENING
 * PROXY that runs anywhere ACS exists — it is deliberately NOT a federal
 * Justice40 / CEJST or California SB 535 designation.
 *
 * The real, official disadvantaged-community determination is a separate,
 * looked-up value: `federalJustice40` is injected by the caller from
 * `@/lib/data-sources/equity-designation`, and defaults to `not_determined` so
 * this module can never fabricate a designation from the income proxy. Keeping
 * the two apart is the whole point — the field name used to be `justice40Eligible`
 * and asserted a federal designation the code never actually computed.
 */

import { notDeterminedJustice40, type Justice40Determination } from "./equity-designation/types";

export type { Justice40Determination, Justice40Status } from "./equity-designation/types";

export interface EquityScreening {
  totalTracts: number;
  disadvantagedTracts: number;
  pctDisadvantaged: number;
  lowIncomeTracts: number;
  highPovertyTracts: number;
  highMinorityTracts: number;
  lowVehicleAccessTracts: number;
  highTransitDependencyTracts: number;
  burdenedLowIncomeTracts: number;
  /**
   * `linguisticallyIsolated` USED TO LIVE HERE, hardcoded `false`, with no
   * consumer anywhere in the app. It is deleted rather than left dormant.
   *
   * Limited English Proficiency is a real and legally load-bearing Title VI
   * factor — it is one of the four factors in the DOT LEP guidance — so a field
   * asserting `false` for every study area in the United States is not a
   * harmless stub. The moment anything rendered it, OpenPlan would publish "not
   * linguistically isolated" about places that are, under a Title VI heading.
   *
   * Measuring it needs ACS B16004 / C16002 (household language and English
   * proficiency), which this module does not fetch. When that lands it comes
   * back as a measured value with its own universe in `CensusMeasuredUniverses`,
   * never as a default.
   */
  ejIndicators: {
    lowIncome: boolean;
    highMinority: boolean;
    highPoverty: boolean;
    lowVehicleAccess: boolean;
    transitDependent: boolean;
  };
  title6Flags: string[];
  /**
   * Did ANY study-area tract trip the ACS income + burden proxy? This is the
   * honestly-named successor to the old `justice40Eligible` boolean: a proxy
   * signal, NOT a federal Justice40 designation.
   */
  proxyDisadvantagedFlag: boolean;
  /**
   * The real, looked-up federal Justice40 / CEJST determination (or an honest
   * `not_determined`). Never derived from the proxy above.
   */
  federalJustice40: Justice40Determination;
  equityScore: number;
  source: "proxy-census";
}

interface CensusTractForEquity {
  geoid: string;
  pctMinority: number;
  pctBelowPoverty: number;
  medianIncome: number | null;
  zeroVehicleHouseholds: number;
  totalHouseholds: number;
  transitCommuters?: number;
  totalCommuters?: number;
}

/**
 * The ACS income + burden proxy thresholds.
 *
 * EXPORTED, and the only copy. `census-geometry.ts` paints the same
 * `isDisadvantaged` flag onto the tract choropleth and used to carry its own
 * inline literals (`< 50000 && (>= 30 || >= 50 || >= 10 || >= 15)`) held in sync
 * with this table by nothing but a comment saying "same thresholds as
 * screenEquity". Two copies of one rule, in two files, is the divergence
 * CLAUDE.md names as a seam defect — and here it would have meant the map
 * shading a tract disadvantaged while the scorecard did not, with no way to see
 * which was wrong. `evaluateProxyDisadvantage` below is now the single
 * evaluator; changing a number here changes both surfaces or neither.
 */
export const EQUITY_PROXY_THRESHOLDS = {
  lowIncomeMedian: 50000,
  highPovertyPct: 30,
  highMinorityPct: 50,
  lowVehicleAccessPct: 10,
  transitDependencyPct: 15,
} as const;

const THRESHOLDS = EQUITY_PROXY_THRESHOLDS;

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** The per-tract inputs the proxy needs. Both call sites already have these. */
export interface ProxyDisadvantageInput {
  pctMinority: number;
  pctBelowPoverty: number;
  medianIncome: number | null;
  zeroVehicleHouseholds: number;
  totalHouseholds: number;
  transitCommuters?: number;
  totalCommuters?: number;
}

export interface ProxyDisadvantageResult {
  lowIncome: boolean;
  highPoverty: boolean;
  highMinority: boolean;
  lowVehicleAccess: boolean;
  transitDependency: boolean;
  /** Low income AND at least one burden. Both call sites must agree on this. */
  disadvantaged: boolean;
  zeroVehiclePct: number;
  transitCommutePct: number;
}

/**
 * Does one tract trip the ACS income + burden PROXY?
 *
 * A screening heuristic, NOT the federal CEJST / Justice40 designation and NOT
 * California SB 535 — those are looked up, never derived (see `federalJustice40`).
 */
export function evaluateProxyDisadvantage(tract: ProxyDisadvantageInput): ProxyDisadvantageResult {
  const zeroVehiclePct = pct(tract.zeroVehicleHouseholds, tract.totalHouseholds);
  const transitCommutePct = pct(tract.transitCommuters ?? 0, tract.totalCommuters ?? 0);

  const lowIncome =
    tract.medianIncome !== null && tract.medianIncome < THRESHOLDS.lowIncomeMedian;
  const highPoverty = tract.pctBelowPoverty >= THRESHOLDS.highPovertyPct;
  const highMinority = tract.pctMinority >= THRESHOLDS.highMinorityPct;
  const lowVehicleAccess = zeroVehiclePct >= THRESHOLDS.lowVehicleAccessPct;
  const transitDependency = transitCommutePct >= THRESHOLDS.transitDependencyPct;

  const burdenCount = [highPoverty, highMinority, lowVehicleAccess, transitDependency].filter(
    Boolean
  ).length;

  return {
    lowIncome,
    highPoverty,
    highMinority,
    lowVehicleAccess,
    transitDependency,
    disadvantaged: lowIncome && burdenCount >= 1,
    zeroVehiclePct,
    transitCommutePct,
  };
}

export function screenEquity(
  censusData: {
    pctMinority: number;
    pctBelowPoverty: number;
    pctZeroVehicle: number;
    pctTransit: number;
    medianIncomeWeighted: number | null;
    tracts: CensusTractForEquity[];
  },
  // The real federal determination is INJECTED — resolved from the
  // equity-designation registry by the caller. Defaults to not_determined so a
  // caller that forgets it can never accidentally publish the proxy as Justice40.
  federalJustice40: Justice40Determination = notDeterminedJustice40(censusData.tracts.length)
): EquityScreening {
  const tracts = censusData.tracts;

  const tractFlags = tracts.map((tract) => ({
    geoid: tract.geoid,
    ...evaluateProxyDisadvantage(tract),
  }));

  const disadvantagedTracts = tractFlags.filter((t) => t.disadvantaged).length;
  const lowIncomeTracts = tractFlags.filter((t) => t.lowIncome).length;
  const highPovertyTracts = tractFlags.filter((t) => t.highPoverty).length;
  const highMinorityTracts = tractFlags.filter((t) => t.highMinority).length;
  const lowVehicleAccessTracts = tractFlags.filter((t) => t.lowVehicleAccess).length;
  const highTransitDependencyTracts = tractFlags.filter((t) => t.transitDependency).length;
  const burdenedLowIncomeTracts = tractFlags.filter(
    (t) =>
      t.lowIncome &&
      (t.highPoverty || t.highMinority || t.lowVehicleAccess || t.transitDependency)
  ).length;

  const pctDisadvantaged = pct(disadvantagedTracts, tracts.length);

  const ejIndicators = {
    lowIncome:
      censusData.medianIncomeWeighted !== null &&
      censusData.medianIncomeWeighted < THRESHOLDS.lowIncomeMedian,
    highMinority: censusData.pctMinority >= 40,
    highPoverty: censusData.pctBelowPoverty >= 20,
    lowVehicleAccess: censusData.pctZeroVehicle >= 10,
    transitDependent: censusData.pctTransit >= 12,
  };

  const title6Flags: string[] = [];
  if (ejIndicators.highMinority) {
    title6Flags.push("Corridor serves a high proportion of minority residents");
  }
  if (ejIndicators.lowIncome) {
    title6Flags.push("Corridor median household income is below CEJST-proxy low-income threshold");
  }
  if (ejIndicators.highPoverty) {
    title6Flags.push("Corridor poverty rate indicates concentrated economic burden");
  }
  if (ejIndicators.lowVehicleAccess) {
    title6Flags.push("A significant share of households lacks vehicle access");
  }
  if (ejIndicators.transitDependent) {
    title6Flags.push("Transit-dependent households indicate strong multimodal investment need");
  }

  // Honest name: "did any tract trip the income+burden proxy", NOT a Justice40
  // designation. The real determination lives in `federalJustice40`.
  const proxyDisadvantagedFlag = disadvantagedTracts > 0;

  const equityScore = Math.min(
    100,
    Math.round(
      pctDisadvantaged * 0.4 +
        pct(highPovertyTracts, tracts.length) * 0.2 +
        pct(lowVehicleAccessTracts, tracts.length) * 0.2 +
        pct(highTransitDependencyTracts, tracts.length) * 0.2
    )
  );

  return {
    totalTracts: tracts.length,
    disadvantagedTracts,
    pctDisadvantaged,
    lowIncomeTracts,
    highPovertyTracts,
    highMinorityTracts,
    lowVehicleAccessTracts,
    highTransitDependencyTracts,
    burdenedLowIncomeTracts,
    ejIndicators,
    title6Flags,
    proxyDisadvantagedFlag,
    federalJustice40,
    equityScore,
    source: "proxy-census",
  };
}
