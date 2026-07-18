import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSketchAbmInputs } from "@/lib/models/sketch-abm/sketch-abm-inputs";
import { runABM } from "@/lib/models/sketch-abm/abm-runner";

/**
 * Benchmark validation for the sketch activity model, run against the real
 * Nevada County pilot package (26 census tracts, ~102k population). This is a
 * *sanity-band* gate, not an observed-count match: the sketch model is
 * deliberately uncalibrated and screening-grade, so it is expected to deviate
 * from local observations (the benchmark-fit block surfaces that deviation to
 * users). What this gate protects is that the pipeline produces non-degenerate,
 * believable-order outputs — it would fail loudly on a broken pipeline (zero
 * trips, all-auto collapse, NaN VMT, or an implausible order of magnitude).
 *
 * Determinism: runABM draws Math.random internally, so the run is seeded here
 * with a fixed mulberry32 stream. In production the mode split converges within
 * ~1 percentage point across ~2,000 synthetic households, so the bands below
 * carry ample slack for the unseeded production variance.
 *
 * Reference anchors (documented, not local observations):
 *   - NHTS 2022: ~3.5-4 person-trips/person/day (all purposes)
 *   - CARB / statewide: ~20-25 VMT/capita for small-urban/rural CA counties
 *   - ACS B08301: rural CA counties are ~85-92% auto for commute mode
 * The sketch model measured ~3.16 trips/capita, ~9.71 VMT/capita, ~82% auto on
 * this package (2026-07-18) — below the VMT reference because it models a
 * subset of daily travel and divides for vehicle occupancy. The bands accept
 * that honest under-estimate while rejecting a broken run.
 */

const PACKAGE_CSV = join(
  process.cwd(),
  "../data/pilot-nevada-county/package/zone_attributes.csv"
);
const AVG_HOUSEHOLD_SIZE = 2.55; // screening assumption for HH synthesis from ACS population
const KM_TO_MILES = 0.621371;
const VEHICLE_MILE_FACTORS: Record<string, number> = {
  auto_sov: 1,
  auto_hov2: 1 / 2,
  auto_hov3: 1 / 3.2,
  taxi_tnc: 1,
};

function loadNevadaCountyTracts() {
  const lines = readFileSync(PACKAGE_CSV, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const rows = lines.slice(1).map((line) => line.split(","));
  const tracts = rows.map((r) => ({
    geoid: r[col("GEOID")],
    population: Number(r[col("est_population")]),
    totalHouseholds: Math.round(Number(r[col("est_population")]) / AVG_HOUSEHOLD_SIZE),
    lon: Number(r[col("centroid_lon")]),
    lat: Number(r[col("centroid_lat")]),
    areaSqKm: Number(r[col("area_sq_mi")]) * 2.59,
  }));
  const totalJobs = rows.reduce((s, r) => s + Number(r[col("total_jobs")]), 0);
  const totalPop = tracts.reduce((s, t) => s + t.population, 0);
  return { tracts, totalJobs, totalPop };
}

describe("sketch ABM benchmark validation (Nevada County pilot)", () => {
  const realRandom = Math.random;

  beforeEach(() => {
    let state = 20260718 >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

  afterEach(() => {
    Math.random = realRandom;
  });

  it("produces believable-band metrics on the real 26-tract package", async () => {
    const { tracts, totalJobs, totalPop } = loadNevadaCountyTracts();

    const { inputs, totalRealHouseholds, syntheticHouseholds } = buildSketchAbmInputs({
      censusTracts: tracts,
      lodesJobs: { totalJobs },
      seed: 20260718,
    });

    expect(inputs.zones.length).toBe(26);
    expect(syntheticHouseholds).toBeGreaterThan(0);
    const expansionFactor = totalRealHouseholds / syntheticHouseholds;
    expect(expansionFactor).toBeGreaterThan(1); // capped sample stands in for the full base

    const out = await runABM(inputs);
    const summary = out.summary;

    // Non-degenerate: real tours and trips came out.
    expect(out.tours.length).toBeGreaterThan(0);
    expect(out.trips.length).toBeGreaterThan(0);

    // Trips per capita (expanded) in a believable band around NHTS ~3.5-4.
    const tripsPerCapita = (out.trips.length * expansionFactor) / totalPop;
    expect(tripsPerCapita).toBeGreaterThan(2);
    expect(tripsPerCapita).toBeLessThan(6);

    // Mode split: every mode a finite share, shares sum to ~100 (pct points),
    // and auto is dominant but not a degenerate 100% collapse.
    const modes = ["auto", "transit", "walk", "bike", "shared"] as const;
    let shareSum = 0;
    for (const m of modes) {
      const share = summary.mode_split[m];
      expect(Number.isFinite(share)).toBe(true);
      expect(share).toBeGreaterThanOrEqual(0);
      shareSum += share;
    }
    expect(shareSum).toBeCloseTo(100, 5);
    expect(summary.mode_split.auto).toBeGreaterThan(60);
    expect(summary.mode_split.auto).toBeLessThan(97);

    // Expansion-weighted vehicle-miles, computed exactly as the launch route does.
    const sampleVehicleKm = out.trips.reduce(
      (sum, trip) => sum + trip.distance_km * (VEHICLE_MILE_FACTORS[trip.mode] ?? 0),
      0
    );
    const dailyVmt = sampleVehicleKm * expansionFactor * KM_TO_MILES;
    const vmtPerCapita = dailyVmt / totalPop;

    expect(Number.isFinite(dailyVmt)).toBe(true);
    expect(dailyVmt).toBeGreaterThan(0);
    // Wide sanity band: the sketch model under-estimates absolute VMT vs the
    // CARB ~22 reference (subset of travel + occupancy division), so accept the
    // honest low value while rejecting zero/absurd output.
    expect(vmtPerCapita).toBeGreaterThan(4);
    expect(vmtPerCapita).toBeLessThan(35);

    // Average trip length is a sane over-the-road distance for a small county.
    expect(summary.avg_trip_length_km).toBeGreaterThan(1);
    expect(summary.avg_trip_length_km).toBeLessThan(40);
  });
});
