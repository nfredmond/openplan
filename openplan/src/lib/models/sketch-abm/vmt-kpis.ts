/**
 * Sketch ABM → `model_run_kpis`: the arithmetic that turns a synthetic-sample
 * run into the numbers a planner reads.
 *
 * WHY THIS IS A MODULE AND NOT A HELPER INSIDE THE ROUTE. It used to live
 * inside `POST /api/models/[modelId]/runs`, where nothing could reach it. A
 * mutation sample on 2026-08-10 confirmed the cost: deleting the kilometre→mile
 * conversion (reporting km as miles, ~61% high) and setting every carpool
 * occupancy factor to 1 (counting each person-trip in a shared vehicle as its
 * own vehicle) both passed the ENTIRE 7,979-test suite. The determination
 * boundary around this engine held 8/8 in the same sample — the boundary was
 * guarded and the number it guards was not.
 *
 * Two conversions decide whether `daily_vmt` means anything, and both are
 * silent when wrong: a unit and an occupancy. Neither produces an implausible
 * number — a sketch VMT 61% high still looks like a VMT — which is why they
 * need pinned arithmetic rather than a range check.
 *
 * WHAT THESE KPIs MAY NOT BE USED FOR. `daily_vmt`, `vmt_per_capita`, and
 * `population_total` are the shared VMT KPI vocabulary (cross-run comparison
 * reads them by exact name), but the CEQA §15064.3 screen must NOT consume them
 * from a sketch run, and does not: sketch VMT runs far below the CARB reference
 * (documented ~56% low), which is how a false "less than significant" gets
 * issued. The determination boundary is `VMT_DETERMINATION_ELIGIBLE_ENGINE_KEYS`
 * (aequilibrae only), enforced in the vmt-significance route, in
 * `ModelRunCeqaVmtScreen` itself, and at the mount site. Do not read the shared
 * names as an invitation to point the CEQA screen at this engine.
 */

import type { ZoneResolutionDiagnostic } from "@/lib/models/zone-resolution";
import type { ABMOutputs, TravelMode, Trip } from "./types";

/** Kilometres → miles for the sketch VMT KPI derivation. */
export const KM_TO_MILES = 0.621371;

/**
 * Screening occupancy assumptions for converting sketch person-trip distance to
 * vehicle-miles.
 *
 * TYPED AS A COMPLETE `Record<TravelMode, number>` ON PURPOSE. The previous
 * shape was a partial `Record<string, number>` read with `?? 0`, so adding a
 * travel mode gave it a silent zero vehicle-miles — a new mode would have
 * lowered VMT with nothing failing. Every mode now has to be decided, and
 * adding one to `TravelMode` breaks the build until it is:
 *
 *   - `auto_sov` ×1.0 — one occupant, one vehicle.
 *   - `auto_hov2` ÷2, `auto_hov3` ÷3.2 — the person-trips in a shared vehicle
 *     divide one vehicle's miles between them (3.2 = average occupancy of the
 *     3+ class).
 *   - `taxi_tnc` ×1.0 — each taxi/TNC person-trip is a vehicle trip.
 *   - `transit_drive` 0 — its park-and-ride leg IS driven, but the sketch skims
 *     carry no separate drive-access distance, so the trip's full distance would
 *     count the line-haul as driving. Zero understates; the alternative
 *     overstates by more.
 *   - `transit_walk`, `walk`, `bike` 0 — no vehicle.
 *   - `school_bus` 0 — a bus is a vehicle, but a person-trip on it is not one
 *     vehicle's miles, and the sketch carries no bus routing to apportion.
 */
export const SKETCH_VEHICLE_MILE_FACTORS: Record<TravelMode, number> = {
  auto_sov: 1,
  auto_hov2: 1 / 2,
  auto_hov3: 1 / 3.2,
  taxi_tnc: 1,
  transit_drive: 0,
  transit_walk: 0,
  walk: 0,
  bike: 0,
  school_bus: 0,
};

/** Occupancy assumptions surfaced in KPI breakdowns (persons per vehicle). */
export const SKETCH_OCCUPANCY_ASSUMPTIONS = {
  auto_sov: 1,
  auto_hov2: 2,
  auto_hov3: 3.2,
  taxi_tnc: 1,
} as const;

/** Modes carrying no vehicle-miles, named in the KPI breakdown. */
export const SKETCH_ZERO_VEHICLE_MILE_MODES: readonly TravelMode[] = (
  Object.keys(SKETCH_VEHICLE_MILE_FACTORS) as TravelMode[]
).filter((mode) => SKETCH_VEHICLE_MILE_FACTORS[mode] === 0);

/**
 * Sample-scale vehicle-kilometres: person-trip distance weighted by the
 * per-mode vehicle-mile factors above. Sample scale — expansion is applied
 * once, downstream, so it cannot be applied twice.
 */
export function sketchSampleVehicleKm(trips: readonly Trip[]): number {
  return trips.reduce(
    (sum, trip) => sum + trip.distance_km * (SKETCH_VEHICLE_MILE_FACTORS[trip.mode] ?? 0),
    0
  );
}

/**
 * Expansion factor scaling the capped synthetic-household sample back to the
 * full ACS household base. Factor 1 when the sample covers (or exceeds, via
 * per-zone minimums) the real household count, or when the sample is empty.
 */
export function sketchExpansionFactor(
  totalRealHouseholds: number,
  syntheticHouseholds: number
): number {
  if (syntheticHouseholds <= 0) return 1;
  return totalRealHouseholds > syntheticHouseholds
    ? totalRealHouseholds / syntheticHouseholds
    : 1;
}

export type SketchAbmKpiRow = {
  run_id: string;
  kpi_name: string;
  kpi_label: string;
  kpi_category: "sketch_abm";
  value: number | null;
  unit: string;
  breakdown_json: Record<string, unknown>;
};

/**
 * Shape sketch ABM outputs into `model_run_kpis` rows.
 *
 * Trip-derived totals (total_tours, total_trips, daily_vmt) are computed at the
 * capped synthetic-sample scale and expansion-weighted back to the full ACS
 * household base; vmt_per_capita divides the EXPANDED daily_vmt by the full ACS
 * population so the numerator and denominator are at the same scale.
 */
export function buildSketchAbmKpiRows(params: {
  modelRunId: string;
  summary: ABMOutputs["summary"];
  /** Measured from the run's own trips — see `diagnoseZoneResolution`. */
  zoneResolution: ZoneResolutionDiagnostic;
  sampleVehicleKm: number;
  populationTotal: number;
  totalRealHouseholds: number;
  syntheticHouseholds: number;
  expansionFactor: number;
}): SketchAbmKpiRow[] {
  const {
    modelRunId,
    summary,
    zoneResolution,
    sampleVehicleKm,
    populationTotal,
    totalRealHouseholds,
    syntheticHouseholds,
    expansionFactor,
  } = params;
  const dailyVmt = sampleVehicleKm * expansionFactor * KM_TO_MILES;
  const vmtPerCapita = populationTotal > 0 ? dailyVmt / populationTotal : null;
  const totalTours = Math.round(summary.total_tours * expansionFactor);
  const totalTrips = Math.round(summary.total_trips * expansionFactor);

  const expansionBreakdown = {
    expansion_factor: expansionFactor,
    synthetic_households: syntheticHouseholds,
    total_real_households: totalRealHouseholds,
  };

  const row = (
    kpiName: string,
    kpiLabel: string,
    value: number | null,
    unit: string,
    breakdown: Record<string, unknown> = {}
  ): SketchAbmKpiRow => ({
    run_id: modelRunId,
    kpi_name: kpiName,
    kpi_label: kpiLabel,
    kpi_category: "sketch_abm",
    value,
    unit,
    breakdown_json: breakdown,
  });

  // summary.mode_split values are percentages (0–100); KPIs store 0–1 shares.
  const share = (mode: string) => (summary.mode_split[mode] ?? 0) / 100;

  return [
    row("total_tours", "Total tours (sketch)", totalTours, "tours", {
      provenance:
        "Screening-grade sketch output: tours from a capped synthetic-household sample, expansion-weighted to the full ACS household base (factor = real households / synthetic households).",
      sample_tours: summary.total_tours,
      ...expansionBreakdown,
    }),
    row("total_trips", "Total trips (sketch)", totalTrips, "trips", {
      provenance:
        "Screening-grade sketch output: trips from a capped synthetic-household sample, expansion-weighted to the full ACS household base (factor = real households / synthetic households).",
      sample_trips: summary.total_trips,
      ...expansionBreakdown,
    }),
    row("mode_share_auto", "Auto mode share (sketch)", share("auto"), "share"),
    row("mode_share_transit", "Transit mode share (sketch)", share("transit"), "share"),
    row("mode_share_walk", "Walk mode share (sketch)", share("walk"), "share"),
    row("mode_share_bike", "Bike mode share (sketch)", share("bike"), "share"),
    row("mode_share_shared", "Shared-ride mode share (sketch)", share("shared"), "share"),
    row("daily_vmt", "Daily VMT (sketch)", dailyVmt, "vehicle-miles/day", {
      provenance:
        "Screening-grade sketch output: vehicle-miles from a synthetic-population sketch activity model over distance-based screening skims, expansion-weighted from the capped household sample to the full ACS household base (factor = real households / synthetic households). Person-trip distances convert to vehicle-miles under screening occupancy assumptions: auto_sov x1.0, auto_hov2 /2, auto_hov3 /3.2, taxi_tnc x1.0 (a vehicle trip); transit_drive access legs are excluded because the skims carry no separate drive-access distance. Converted km to miles (x 0.621371). Not a validated travel model or calibrated forecast.",
      sample_vehicle_km: sampleVehicleKm,
      km_to_miles: KM_TO_MILES,
      occupancy_assumptions: SKETCH_OCCUPANCY_ASSUMPTIONS,
      excluded_modes: ["transit_drive"],
      ...expansionBreakdown,
    }),
    row("vmt_per_capita", "VMT per capita (sketch)", vmtPerCapita, "vehicle-miles/person/day", {
      provenance:
        "Screening-grade sketch output: expansion-weighted daily_vmt divided by total ACS population across the county-bbox-scale tract set (every tract in the counties overlapping the study-area bounding box, not clipped to the drawn corridor). Not a validated travel model or calibrated forecast.",
      population_total: populationTotal,
      ...expansionBreakdown,
    }),
    row("population_total", "Population (zones)", populationTotal, "persons", {
      provenance:
        "Total ACS population across the county-bbox-scale tract set (every tract in the counties overlapping the study-area bounding box, not clipped to the drawn corridor).",
    }),
    /**
     * HOW MUCH OF THIS RUN'S TRAVEL NEVER REACHES A LINK.
     *
     * A trip that begins and ends in the same zone contributes to VMT and mode
     * share and to no link at all — there are no streets inside a zone. Without
     * this number a planner comparing modelled volumes to traffic counts reads
     * the gap as a failed model. OpenPlan's own county validation hit 36% at 26
     * zones and link-level AADT comparison failed there for exactly this
     * reason.
     *
     * The share is measured on the SAMPLE trips rather than expanded, because
     * expansion multiplies both sides of the ratio and would not change it —
     * saying so here so nobody "fixes" it by weighting.
     */
    row(
      "intrazonal_trip_share",
      "Trips that never reach the network",
      zoneResolution.intrazonalSharePct === null ? null : zoneResolution.intrazonalSharePct / 100,
      "share",
      {
        provenance:
          "Measured directly from this run's trip table: trips whose origin and destination zone are " +
          "the same, over all trips. Expansion weighting is not applied because it scales numerator " +
          "and denominator equally.",
        zone_count: zoneResolution.zoneCount,
        intrazonal_trips: zoneResolution.intrazonalTripCount,
        sample_trips: zoneResolution.tripCount,
        band: zoneResolution.band,
        supports_link_level_validation: zoneResolution.supportsLinkLevelValidation,
        interpretation: zoneResolution.summary,
      }
    ),
  ];
}
