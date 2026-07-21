/**
 * M6 — sketch trip-generation engine. Turns a land-use program (dwelling units,
 * building area, rooms) into daily + AM/PM peak-hour vehicle trips and a screening
 * VMT estimate using the average-rate method with published, public-agency rates
 * (see ite-rates.ts). Pure + deterministic: no LLM, no clock, no RNG.
 *
 * CLAIM BOUNDARY (non-negotiable): this is a SCREENING estimate. It is NOT a
 * traffic impact study and NOT a CEQA §15064.3 VMT determination. Its VMT is
 * rate-based (trips × an assumed average trip length), NOT the network/skim-based
 * VMT the CEQA screen consumes — so its KPI names are kept deliberately DISJOINT
 * from the CEQA KPI-name sets (see ITE_TRIP_GEN_KPI_NAMES + the namespace test),
 * guaranteeing this coarser number can never be silently ingested into a CEQA
 * determination. Every result carries ITE_TRIP_GEN_SCREENING_CAVEAT.
 */

import {
  DEFAULT_TRIP_GEN_RATE_BY_KEY,
  ITE_RATE_SOURCE,
  type TripGenRate,
  type TripGenUnitBasis,
} from "./ite-rates";

export const ITE_TRIP_GEN_SCREENING_CAVEAT =
  "Screening-level trip-generation estimate (average-rate method) using published public-agency reference rates. This is NOT a traffic impact study and NOT a CEQA §15064.3 VMT determination; its VMT is rate-based, not network-derived, and it has not been validated against local counts. Verify rates and assumptions against the locally adopted or licensed rate manual before any regulatory, funding, or design use.";

/**
 * Baseline convention for a two-scenario comparison. Both are legitimate — the
 * tool must not pick silently, so it is stored on the program.
 * - `no_build_zero`: the baseline site generates zero trips (greenfield / no build).
 * - `existing_use_net_new`: the baseline is today's on-site use, so a comparison
 *   against it reads as NET NEW trips.
 */
export const TRIP_GEN_COMPARISON_BASES = ["no_build_zero", "existing_use_net_new"] as const;
export type TripGenComparisonBasis = (typeof TRIP_GEN_COMPARISON_BASES)[number];

export type TripGenLineItemInput = {
  /** A key into the default rate table, OR provide `rate` directly for a custom use. */
  rateKey?: string;
  rate?: TripGenRate;
  /** Number of units (dwelling units / ksf / rooms), matching the rate's unitBasis. */
  quantity: number;
  /** Internal-capture reduction (0–1): trips that stay within a mixed-use site. */
  internalCaptureShare?: number;
  /** Pass-by reduction (0–1): trips already on the adjacent street (retail). */
  passByShare?: number;
};

export type TripGenProgramInput = {
  lineItems: TripGenLineItemInput[];
  /** Average vehicle trip length (miles) for the rate-based VMT screen. */
  avgTripLengthMiles: number;
  comparisonBasis: TripGenComparisonBasis;
};

export type TripGenLineItemResult = {
  landUse: string;
  unitBasis: TripGenUnitBasis;
  quantity: number;
  dailyTripsPerUnit: number;
  internalCaptureShare: number;
  passByShare: number;
  grossDailyTrips: number;
  netDailyTrips: number;
  amPeakTrips: number;
  amInboundTrips: number;
  amOutboundTrips: number;
  pmPeakTrips: number;
  pmInboundTrips: number;
  pmOutboundTrips: number;
  dailyVmt: number;
};

export type TripGenResult = {
  comparisonBasis: TripGenComparisonBasis;
  avgTripLengthMiles: number;
  lineItems: TripGenLineItemResult[];
  totals: {
    netDailyTrips: number;
    amPeakTrips: number;
    pmPeakTrips: number;
    dailyVmt: number;
  };
  caveat: string;
};

/** Screening KPI names — deliberately DISJOINT from every CEQA KPI-name set so a
 * rate-based estimate can never be consumed by the CEQA §15064.3 VMT screen. */
export const ITE_TRIP_GEN_KPI_NAMES: ReadonlySet<string> = new Set([
  "project_daily_trip_ends",
  "project_am_peak_hour_trip_ends",
  "project_pm_peak_hour_trip_ends",
  "project_daily_vmt_screen",
  "project_program_units",
]);

function share(value: number | undefined, label: string): number {
  const v = value ?? 0;
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`Invalid ${label}: expected a share between 0 and 1, got ${value}`);
  }
  return v;
}

/** Validate a resolved rate's numeric fields. Custom (caller-supplied) rates are
 * only shape-checked by TypeScript, so a negative rate or an out-of-range share
 * would otherwise slip through to a silently-wrong result — validate both paths. */
function validateRate(rate: TripGenRate): TripGenRate {
  if (!Number.isFinite(rate.dailyTripsPerUnit) || rate.dailyTripsPerUnit < 0) {
    throw new Error(`Invalid dailyTripsPerUnit for ${rate.landUse}: expected a non-negative number, got ${rate.dailyTripsPerUnit}`);
  }
  share(rate.amPeakShareOfDaily, `amPeakShareOfDaily for ${rate.landUse}`);
  share(rate.amInboundShare, `amInboundShare for ${rate.landUse}`);
  share(rate.pmPeakShareOfDaily, `pmPeakShareOfDaily for ${rate.landUse}`);
  share(rate.pmInboundShare, `pmInboundShare for ${rate.landUse}`);
  return rate;
}

function resolveRate(item: TripGenLineItemInput): TripGenRate {
  if (item.rate) return validateRate(item.rate);
  if (item.rateKey) {
    const found = DEFAULT_TRIP_GEN_RATE_BY_KEY.get(item.rateKey);
    if (!found) throw new Error(`Unknown trip-generation rate key: ${item.rateKey}`);
    return validateRate(found);
  }
  throw new Error("Trip-generation line item needs a rateKey or an explicit rate.");
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Compute daily + peak-hour trips and a screening VMT for a land-use program.
 * Deterministic; throws on invalid input rather than silently estimating.
 * Reduction order is documented + fixed: gross → internal capture → pass-by.
 */
export function computeTripGeneration(program: TripGenProgramInput): TripGenResult {
  const avgTripLengthMiles = program.avgTripLengthMiles;
  if (!Number.isFinite(avgTripLengthMiles) || avgTripLengthMiles <= 0) {
    throw new Error(`Invalid avgTripLengthMiles: expected a positive number, got ${avgTripLengthMiles}`);
  }

  const lineItems: TripGenLineItemResult[] = program.lineItems.map((item) => {
    const rate = resolveRate(item);
    const quantity = item.quantity;
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`Invalid quantity for ${rate.landUse}: expected a non-negative number, got ${quantity}`);
    }
    const internalCaptureShare = share(item.internalCaptureShare, "internalCaptureShare");
    const passByShare = share(item.passByShare, "passByShare");

    const grossDailyTrips = rate.dailyTripsPerUnit * quantity;
    // External trips = gross, less internal capture, less pass-by (fixed order).
    const netDailyTrips = grossDailyTrips * (1 - internalCaptureShare) * (1 - passByShare);

    const amPeakTrips = netDailyTrips * rate.amPeakShareOfDaily;
    const pmPeakTrips = netDailyTrips * rate.pmPeakShareOfDaily;
    const dailyVmt = netDailyTrips * avgTripLengthMiles;

    return {
      landUse: rate.landUse,
      unitBasis: rate.unitBasis,
      quantity,
      dailyTripsPerUnit: rate.dailyTripsPerUnit,
      internalCaptureShare,
      passByShare,
      grossDailyTrips: round2(grossDailyTrips),
      netDailyTrips: round2(netDailyTrips),
      amPeakTrips: round2(amPeakTrips),
      amInboundTrips: round2(amPeakTrips * rate.amInboundShare),
      amOutboundTrips: round2(amPeakTrips * (1 - rate.amInboundShare)),
      pmPeakTrips: round2(pmPeakTrips),
      pmInboundTrips: round2(pmPeakTrips * rate.pmInboundShare),
      pmOutboundTrips: round2(pmPeakTrips * (1 - rate.pmInboundShare)),
      dailyVmt: round2(dailyVmt),
    };
  });

  const sum = (pick: (li: TripGenLineItemResult) => number): number =>
    round2(lineItems.reduce((acc, li) => acc + pick(li), 0));

  const totals = {
    netDailyTrips: sum((li) => li.netDailyTrips),
    amPeakTrips: sum((li) => li.amPeakTrips),
    pmPeakTrips: sum((li) => li.pmPeakTrips),
    dailyVmt: sum((li) => li.dailyVmt),
  };

  // Finite inputs can still overflow to Infinity through multiplication
  // (e.g. a 1e308 quantity); a non-finite total must fail loudly, never ship
  // as a "succeeded" run with null-ish KPI values.
  for (const [key, value] of Object.entries(totals)) {
    if (!Number.isFinite(value)) {
      throw new Error(`Trip-generation total ${key} is not a finite number — check program magnitudes.`);
    }
  }

  return {
    comparisonBasis: program.comparisonBasis,
    avgTripLengthMiles,
    lineItems,
    totals,
    caveat: ITE_TRIP_GEN_SCREENING_CAVEAT,
  };
}

/** `model_run_kpis` row shape for this engine (mirrors the sketch_abm rows). */
export type IteTripGenKpiRow = {
  run_id: string;
  kpi_name: string;
  kpi_label: string;
  kpi_category: "ite_trip_generation";
  value: number | null;
  unit: string;
  breakdown_json: Record<string, unknown>;
};

/**
 * Map a TripGenResult onto `model_run_kpis` rows. Every kpi_name comes from
 * ITE_TRIP_GEN_KPI_NAMES (the CEQA-disjoint namespace); each row carries a
 * provenance string and the screening caveat in breakdown_json, mirroring
 * buildSketchAbmKpiRows.
 */
export function buildIteTripGenerationKpiRows(runId: string, result: TripGenResult): IteTripGenKpiRow[] {
  const provenance = `${ITE_RATE_SOURCE}; average-rate method, gross → internal capture → pass-by; VMT = net daily trip ends × ${result.avgTripLengthMiles} mi average trip length (${result.comparisonBasis} basis).`;
  const shared = {
    provenance,
    caveat: ITE_TRIP_GEN_SCREENING_CAVEAT,
    comparisonBasis: result.comparisonBasis,
    avgTripLengthMiles: result.avgTripLengthMiles,
  };
  const totalProgramUnits = result.lineItems.reduce((acc, li) => acc + li.quantity, 0);

  const rows: IteTripGenKpiRow[] = [
    {
      run_id: runId,
      kpi_name: "project_daily_trip_ends",
      kpi_label: "Daily vehicle trip ends (net external)",
      kpi_category: "ite_trip_generation",
      value: result.totals.netDailyTrips,
      unit: "trip ends/day",
      // The full per-line-item table rides on the headline KPI so the
      // worksheet UI can render it from one row.
      breakdown_json: { ...shared, lineItems: result.lineItems },
    },
    {
      run_id: runId,
      kpi_name: "project_am_peak_hour_trip_ends",
      kpi_label: "AM peak-hour vehicle trip ends",
      kpi_category: "ite_trip_generation",
      value: result.totals.amPeakTrips,
      unit: "trip ends/hour",
      breakdown_json: shared,
    },
    {
      run_id: runId,
      kpi_name: "project_pm_peak_hour_trip_ends",
      kpi_label: "PM peak-hour vehicle trip ends",
      kpi_category: "ite_trip_generation",
      value: result.totals.pmPeakTrips,
      unit: "trip ends/hour",
      breakdown_json: shared,
    },
    {
      run_id: runId,
      kpi_name: "project_daily_vmt_screen",
      kpi_label: "Daily VMT (rate-based screening)",
      kpi_category: "ite_trip_generation",
      value: result.totals.dailyVmt,
      unit: "vehicle-miles/day",
      breakdown_json: shared,
    },
    {
      run_id: runId,
      kpi_name: "project_program_units",
      kpi_label: "Land-use program size (summed units)",
      kpi_category: "ite_trip_generation",
      value: Math.round(totalProgramUnits * 100) / 100,
      unit: "units (mixed bases)",
      breakdown_json: shared,
    },
  ];

  for (const row of rows) {
    if (!ITE_TRIP_GEN_KPI_NAMES.has(row.kpi_name)) {
      throw new Error(`KPI name ${row.kpi_name} is outside the ITE trip-gen namespace`);
    }
  }
  return rows;
}
