import { describe, expect, it } from "vitest";

import {
  KM_TO_MILES,
  SKETCH_OCCUPANCY_ASSUMPTIONS,
  SKETCH_VEHICLE_MILE_FACTORS,
  SKETCH_ZERO_VEHICLE_MILE_MODES,
  buildSketchAbmKpiRows,
  sketchExpansionFactor,
  sketchSampleVehicleKm,
} from "@/lib/models/sketch-abm/vmt-kpis";
import { diagnoseZoneResolution } from "@/lib/models/zone-resolution";
import type { ABMOutputs, TravelMode, Trip } from "@/lib/models/sketch-abm/types";

/**
 * TWO SILENT CONVERSIONS STAND BETWEEN A SKETCH RUN AND THE WORD "VMT":
 * a unit (kilometres → miles) and an occupancy (person-trips → vehicles).
 *
 * Neither produces an implausible number when it is wrong. A sketch VMT
 * reported in kilometres is 61% too high and still looks like a VMT; carpool
 * trips counted one vehicle each inflate it again, and still look like a VMT.
 * Nothing downstream can notice: `daily_vmt` and `vmt_per_capita` are the
 * SHARED KPI vocabulary that scenario comparison, evidence packets, and RTP
 * citations read by exact name, so a conversion error propagates as a fact.
 *
 * WHY THIS FILE EXISTS. A mutation sample on 2026-08-10 deleted the
 * kilometre→mile conversion and set every carpool occupancy factor to 1. Both
 * mutations passed the ENTIRE 7,979-test suite. The CEQA determination boundary
 * that keeps this engine's VMT out of a significance finding was sampled in the
 * same pass and killed 8 of 8 — the boundary around the number was guarded and
 * the number was not. This pins the arithmetic itself.
 */

const ZERO_TOUR_STATISTICS: ABMOutputs["summary"]["tour_statistics"] = {
  total_tours: 0,
  by_purpose: {
    work: 0,
    school: 0,
    shopping: 0,
    social: 0,
    recreation: 0,
    dining: 0,
    escort: 0,
    personal: 0,
  },
  by_type: { mandatory: 0, non_mandatory: 0, at_work: 0 },
  avg_tours_per_person: 0,
  avg_stops_per_tour: 0,
};

function trip(mode: TravelMode, distanceKm: number, index: number): Trip {
  return {
    trip_id: `t${index}`,
    person_id: "p1",
    household_id: "hh1",
    tour_id: "tour1",
    // Distinct zones so none of these count as intrazonal — the intrazonal
    // share is a separate KPI with its own guard and must not move the VMT.
    origin_taz: `z${index}`,
    dest_taz: `z${index + 100}`,
    purpose: "work",
    mode,
    mode_agg: "auto",
    departure_time: 480,
    arrival_time: 510,
    travel_time: 30,
    distance_km: distanceKm,
    is_outbound: true,
  };
}

/**
 * One trip per travel mode, with distances chosen so the hand computation is
 * exact:
 *   auto_sov    10 km × 1     = 10
 *   auto_hov2   10 km ÷ 2     =  5
 *   auto_hov3   16 km ÷ 3.2   =  5
 *   taxi_tnc     4 km × 1     =  4
 *   everything else            =  0
 *                        total = 24 vehicle-km
 */
const TRIPS: Trip[] = [
  trip("auto_sov", 10, 1),
  trip("auto_hov2", 10, 2),
  trip("auto_hov3", 16, 3),
  trip("taxi_tnc", 4, 4),
  trip("transit_walk", 20, 5),
  trip("transit_drive", 30, 6),
  trip("walk", 2, 7),
  trip("bike", 3, 8),
  trip("school_bus", 8, 9),
];

const SAMPLE_VEHICLE_KM = 24;

function kpiRows() {
  const summary: ABMOutputs["summary"] = {
    total_households: 100,
    total_persons: 250,
    total_tours: 40,
    total_trips: TRIPS.length,
    mode_split: { auto: 80, transit: 5, walk: 10, bike: 3, shared: 2 },
    tour_statistics: ZERO_TOUR_STATISTICS,
    avg_trip_length_km: 11.4,
    avg_trips_per_person: 0.036,
  };

  return buildSketchAbmKpiRows({
    modelRunId: "run-1",
    summary,
    // Built by the real diagnostic from the real trips, not described by hand.
    zoneResolution: diagnoseZoneResolution(TRIPS, 12),
    sampleVehicleKm: sketchSampleVehicleKm(TRIPS),
    populationTotal: 1000,
    totalRealHouseholds: 500,
    syntheticHouseholds: 100,
    expansionFactor: sketchExpansionFactor(500, 100),
  });
}

function valueOf(name: string): number | null {
  const row = kpiRows().find((candidate) => candidate.kpi_name === name);
  if (!row) throw new Error(`no ${name} KPI row`);
  return row.value;
}

describe("sketch vehicle-kilometres", () => {
  it("divides a shared vehicle's distance between its occupants", () => {
    // The whole point of an occupancy factor: three people in one car are one
    // car. 16 km carrying 3.2 average occupants is 5 vehicle-km, not 16.
    expect(sketchSampleVehicleKm([trip("auto_hov3", 16, 1)])).toBeCloseTo(5, 12);
    expect(sketchSampleVehicleKm([trip("auto_hov2", 10, 1)])).toBe(5);
    // ...and a lone driver is the undivided case.
    expect(sketchSampleVehicleKm([trip("auto_sov", 10, 1)])).toBe(10);
    // A taxi/TNC person-trip IS a vehicle trip; it is not divided.
    expect(sketchSampleVehicleKm([trip("taxi_tnc", 4, 1)])).toBe(4);
  });

  it("counts no vehicle-miles for a trip taken without a vehicle", () => {
    for (const mode of SKETCH_ZERO_VEHICLE_MILE_MODES) {
      expect(sketchSampleVehicleKm([trip(mode, 25, 1)])).toBe(0);
    }
    expect([...SKETCH_ZERO_VEHICLE_MILE_MODES].sort()).toEqual([
      "bike",
      "school_bus",
      "transit_drive",
      "transit_walk",
      "walk",
    ]);
  });

  it("sums a mixed-mode day to the hand-computed total", () => {
    expect(sketchSampleVehicleKm(TRIPS)).toBeCloseTo(SAMPLE_VEHICLE_KM, 12);
  });

  it("makes every travel mode a decision, so a new one cannot default to zero", () => {
    // A partial map read with `?? 0` would give a newly added mode silent zero
    // vehicle-miles — lowering VMT with nothing failing. The complete Record
    // means adding to TravelMode breaks the build until someone decides.
    const decided = Object.keys(SKETCH_VEHICLE_MILE_FACTORS).sort();
    expect(decided).toEqual(
      [
        "auto_sov",
        "auto_hov2",
        "auto_hov3",
        "taxi_tnc",
        "transit_walk",
        "transit_drive",
        "walk",
        "bike",
        "school_bus",
      ].sort()
    );
    for (const factor of Object.values(SKETCH_VEHICLE_MILE_FACTORS)) {
      expect(Number.isFinite(factor)).toBe(true);
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });
});

describe("sketch expansion factor", () => {
  it("scales the capped sample back to the real household base", () => {
    expect(sketchExpansionFactor(500, 100)).toBe(5);
  });

  it("never scales DOWN a sample that already covers the household base", () => {
    // Per-zone minimums can push the synthetic sample above the real count.
    // Weighting by 100/500 there would shrink a real study area's travel.
    expect(sketchExpansionFactor(100, 500)).toBe(1);
    expect(sketchExpansionFactor(100, 100)).toBe(1);
  });

  it("returns 1 rather than dividing by an empty sample", () => {
    expect(sketchExpansionFactor(500, 0)).toBe(1);
  });
});

describe("sketch VMT KPI rows", () => {
  it("reports daily VMT in MILES, expansion-weighted — the exact number", () => {
    // 24 vehicle-km × 5 (expansion) = 120 vehicle-km = 74.56452 vehicle-miles.
    // Dropping the unit conversion would report 120 and call it miles.
    expect(valueOf("daily_vmt")).toBeCloseTo(SAMPLE_VEHICLE_KM * 5 * 0.621371, 9);
    expect(valueOf("daily_vmt")).toBeCloseTo(74.56452, 9);
    expect(valueOf("daily_vmt")).not.toBeCloseTo(120, 3);
  });

  it("divides expanded VMT by the ACS population, not by the synthetic sample", () => {
    // Numerator and denominator must be at the same scale. Dividing by the 100
    // synthetic households instead of the 1,000 real people would report a
    // per-capita figure ten times too high.
    expect(valueOf("vmt_per_capita")).toBeCloseTo(74.56452 / 1000, 12);
    expect(valueOf("population_total")).toBe(1000);
  });

  it("expansion-weights tour and trip totals too", () => {
    expect(valueOf("total_tours")).toBe(200);
    expect(valueOf("total_trips")).toBe(TRIPS.length * 5);
  });

  it("stores mode splits as 0–1 shares from the runner's 0–100 percentages", () => {
    expect(valueOf("mode_share_auto")).toBeCloseTo(0.8, 12);
    expect(valueOf("mode_share_transit")).toBeCloseTo(0.05, 12);
  });

  it("does not expansion-weight the intrazonal share, which is a ratio", () => {
    // Every fixture trip crosses zones, so the measured share is zero — and it
    // stays zero rather than being multiplied by anything.
    expect(valueOf("intrazonal_trip_share")).toBe(0);
  });

  it("states the arithmetic it actually performed", () => {
    // The provenance string is what a planner reads to defend the number. If a
    // factor changes and the sentence does not, the KPI describes an arithmetic
    // it did not do — which is worse than an unexplained number.
    const row = kpiRows().find((candidate) => candidate.kpi_name === "daily_vmt");
    const provenance = String(row?.breakdown_json.provenance ?? "");

    expect(provenance).toContain(`x ${KM_TO_MILES}`);
    expect(provenance).toContain(`auto_hov2 /${SKETCH_OCCUPANCY_ASSUMPTIONS.auto_hov2}`);
    expect(provenance).toContain(`auto_hov3 /${SKETCH_OCCUPANCY_ASSUMPTIONS.auto_hov3}`);
    expect(row?.breakdown_json.occupancy_assumptions).toEqual(SKETCH_OCCUPANCY_ASSUMPTIONS);
    expect(row?.breakdown_json.km_to_miles).toBe(KM_TO_MILES);
    expect(row?.breakdown_json.sample_vehicle_km).toBeCloseTo(SAMPLE_VEHICLE_KM, 12);
    expect(row?.unit).toBe("vehicle-miles/day");
  });

  it("keeps the occupancy assumptions and the vehicle-mile factors reciprocal", () => {
    // The breakdown publishes persons-per-vehicle; the arithmetic uses
    // vehicles-per-person-trip. Two numbers for one assumption drift apart
    // silently, so they are checked against each other rather than trusted.
    for (const [mode, persons] of Object.entries(SKETCH_OCCUPANCY_ASSUMPTIONS)) {
      expect(SKETCH_VEHICLE_MILE_FACTORS[mode as TravelMode]).toBeCloseTo(1 / persons, 12);
    }
  });

  it("uses the words 'validated' and 'calibrated' only to deny them", () => {
    // The COPY THIS MODULE AUTHORS: labels and provenance sentences. Not the
    // whole serialized row — `supports_link_level_validation` is a field name,
    // and the zone-resolution `interpretation` is another module's copy with
    // its own guard. A word ban that matches a key checks nothing about claims.
    const rows = kpiRows();
    const authored = rows
      .flatMap((row) => [row.kpi_label, String(row.breakdown_json.provenance ?? "")])
      .join("\n");

    const disclaimer = "Not a validated travel model or calibrated forecast.";
    expect(authored).toContain(disclaimer);
    // It is the ONLY place either word may appear. Banning them outright would
    // ban the disclaimer; allowing them anywhere would let a future edit
    // describe this engine's output as calibrated.
    expect(authored.split(disclaimer).join(" ")).not.toMatch(/calibrat|validat/i);
  });
});
