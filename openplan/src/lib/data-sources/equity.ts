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
  ejIndicators: {
    lowIncome: boolean;
    highMinority: boolean;
    linguisticallyIsolated: boolean;
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

const THRESHOLDS = {
  lowIncomeMedian: 50000,
  highPovertyPct: 30,
  highMinorityPct: 50,
  lowVehicleAccessPct: 10,
  transitDependencyPct: 15,
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
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

  const tractFlags = tracts.map((tract) => {
    const zeroVehiclePct = pct(tract.zeroVehicleHouseholds, tract.totalHouseholds);
    const transitPct = pct(tract.transitCommuters ?? 0, tract.totalCommuters ?? 0);

    const lowIncome = tract.medianIncome !== null && tract.medianIncome < THRESHOLDS.lowIncomeMedian;
    const highPoverty = tract.pctBelowPoverty >= THRESHOLDS.highPovertyPct;
    const highMinority = tract.pctMinority >= THRESHOLDS.highMinorityPct;
    const lowVehicleAccess = zeroVehiclePct >= THRESHOLDS.lowVehicleAccessPct;
    const transitDependency = transitPct >= THRESHOLDS.transitDependencyPct;

    const burdenCount = [highPoverty, highMinority, lowVehicleAccess, transitDependency].filter(Boolean).length;
    const disadvantaged = lowIncome && burdenCount >= 1;

    return {
      geoid: tract.geoid,
      lowIncome,
      highPoverty,
      highMinority,
      lowVehicleAccess,
      transitDependency,
      disadvantaged,
    };
  });

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
    linguisticallyIsolated: false,
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
