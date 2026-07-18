/**
 * buildSketchAbmInputs tests — deterministic screening-grade zones,
 * synthetic households, and distance skims from corridor tract/LODES
 * summaries.
 */

import { describe, expect, it } from "vitest";

import {
  AUTO_COST_PER_KM,
  AUTO_PARKING_COST,
  CIRCUITY_FACTOR,
  DEFAULT_ZONE_AREA_SQ_KM,
  SKETCH_ABM_SECTOR_SHARES,
  SKETCH_ABM_ZONE_SECTOR_MAPPING,
  SYNTHETIC_HOUSEHOLD_CAP,
  TRANSIT_FARE,
  buildSketchAbmInputs,
  seedFromRunId,
  type SketchAbmTractInput,
} from "@/lib/models/sketch-abm/sketch-abm-inputs";

const FIXTURE_TRACTS: SketchAbmTractInput[] = [
  {
    geoid: "06021010100",
    population: 3200,
    totalHouseholds: 1250,
    lon: -121.55,
    lat: 39.51,
    areaSqKm: 6,
  },
  {
    geoid: "06021010200",
    population: 2100,
    totalHouseholds: 830,
    lon: -121.5,
    lat: 39.53,
    areaSqKm: 3.5,
  },
  {
    geoid: "06021010300",
    population: 1500,
    totalHouseholds: 620,
    lon: -121.47,
    lat: 39.49,
  },
];

const FIXTURE_LODES = { totalJobs: 4000 };

function build(seed = 20260718) {
  return buildSketchAbmInputs({
    censusTracts: FIXTURE_TRACTS,
    lodesJobs: FIXTURE_LODES,
    seed,
  });
}

describe("buildSketchAbmInputs", () => {
  it("is deterministic — same seed produces identical output", () => {
    const first = build();
    const second = build();
    expect(second).toEqual(first);
  });

  it("varies the synthetic sample when the seed changes", () => {
    const first = build(1).inputs;
    const second = build(2).inputs;
    expect(second.households.map((hh) => hh.income)).not.toEqual(
      first.households.map((hh) => hh.income),
    );
    // Zones and skims are seed-independent (no stochastic draws feed them).
    expect(second.zones).toEqual(first.zones);
    expect(second.skims).toEqual(first.skims);
  });

  it("builds one zone per tract with population, households, and centroid", () => {
    const { zones } = build().inputs;
    expect(zones).toHaveLength(3);

    const zoneA = zones.find((zone) => zone.id === "06021010100")!;
    expect(zoneA.population).toBe(3200);
    expect(zoneA.total_households).toBe(1250);
    expect(zoneA.lon).toBeCloseTo(-121.55);
    expect(zoneA.lat).toBeCloseTo(39.51);
    expect(zoneA.area_sq_km).toBe(6);

    // Tract without provided area falls back to the documented default.
    const zoneC = zones.find((zone) => zone.id === "06021010300")!;
    expect(zoneC.area_sq_km).toBe(DEFAULT_ZONE_AREA_SQ_KM);
  });

  it("distributes LODES jobs across zones and preserves the corridor total", () => {
    const { zones } = build().inputs;
    const totalEmployment = zones.reduce((sum, zone) => sum + zone.total_employment, 0);
    // Rounding may drift by at most one job per zone.
    expect(Math.abs(totalEmployment - FIXTURE_LODES.totalJobs)).toBeLessThanOrEqual(zones.length);

    // Sector fields follow the fixed AequilibraE-worker shares mapping.
    for (const zone of zones) {
      expect(zone.retail_employment).toBe(
        Math.round(zone.total_employment * SKETCH_ABM_ZONE_SECTOR_MAPPING.retail_employment),
      );
      expect(zone.service_employment).toBe(
        Math.round(zone.total_employment * SKETCH_ABM_ZONE_SECTOR_MAPPING.service_employment),
      );
      expect(zone.office_employment).toBe(
        Math.round(zone.total_employment * SKETCH_ABM_ZONE_SECTOR_MAPPING.office_employment),
      );
      expect(zone.industrial_employment).toBe(0);
    }
  });

  it("keeps the worker sector shares and the zone mapping each summing to <= 1", () => {
    const workerShareSum = Object.values(SKETCH_ABM_SECTOR_SHARES).reduce((a, b) => a + b, 0);
    expect(workerShareSum).toBeLessThanOrEqual(1);

    const mappedShareSum = Object.values(SKETCH_ABM_ZONE_SECTOR_MAPPING).reduce((a, b) => a + b, 0);
    expect(mappedShareSum).toBeLessThanOrEqual(1);
    expect(mappedShareSum).toBeCloseTo(workerShareSum);
  });

  it("caps synthetic households and keeps per-zone counts proportional", () => {
    const { households, zones } = build().inputs;
    expect(households.length).toBeLessThanOrEqual(SYNTHETIC_HOUSEHOLD_CAP + zones.length);

    const totalReal = zones.reduce((sum, zone) => sum + zone.total_households, 0);
    for (const zone of zones) {
      const zoneCount = households.filter((hh) => hh.home_taz_id === zone.id).length;
      const expected = (zone.total_households / totalReal) * Math.min(totalReal, SYNTHETIC_HOUSEHOLD_CAP);
      expect(Math.abs(zoneCount - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("exposes the real and synthetic household counts callers need for expansion weighting", () => {
    const result = build();
    const fixtureRealHouseholds = FIXTURE_TRACTS.reduce((sum, tract) => sum + tract.totalHouseholds, 0);

    expect(result.totalRealHouseholds).toBe(fixtureRealHouseholds);
    expect(result.syntheticHouseholds).toBe(result.inputs.households.length);
    // The 2,700-household fixture is above the 2,000 cap, so the sample is
    // genuinely smaller than the real base and the caller's expansion factor
    // (real / synthetic) lands above 1.
    expect(fixtureRealHouseholds).toBeGreaterThan(SYNTHETIC_HOUSEHOLD_CAP);
    expect(result.syntheticHouseholds).toBeLessThan(result.totalRealHouseholds);
  });

  it("synthesizes plausible screening households and persons", () => {
    const { households } = build().inputs;

    const incomes = households.map((hh) => hh.income).sort((a, b) => a - b);
    const median = incomes[Math.floor(incomes.length / 2)];
    // Lognormal-ish around the $75k screening median.
    expect(median).toBeGreaterThan(50000);
    expect(median).toBeLessThan(105000);

    for (const hh of households) {
      expect(hh.persons.length).toBeGreaterThanOrEqual(1);
      expect(hh.persons.length).toBeLessThanOrEqual(5);
      expect(hh.vehicles).toBeGreaterThanOrEqual(0);
      expect(hh.vehicles).toBeLessThanOrEqual(3);
      for (const person of hh.persons) {
        expect(person.household_id).toBe(hh.id);
        expect(person.income_category).toBeGreaterThanOrEqual(1);
        expect(person.income_category).toBeLessThanOrEqual(6);
        if (person.worker) expect(person.age).toBeGreaterThanOrEqual(25);
        if (person.student) expect(person.age).toBeLessThan(18);
      }
    }
  });

  it("builds a full symmetric OD skim matrix from circuity-adjusted distances", () => {
    const { zones, skims } = build().inputs;
    const ids = zones.map((zone) => zone.id);

    for (const origin of ids) {
      for (const dest of ids) {
        const row = skims[origin][dest];
        expect(row).toBeDefined();
        // Symmetry sanity: great-circle distances are direction-independent.
        expect(row.auto_dist).toBeCloseTo(skims[dest][origin].auto_dist, 9);
        expect(row.auto_time).toBeCloseTo(skims[dest][origin].auto_time, 9);
        // Documented screening constants.
        expect(row.transit_wait_time).toBe(8);
        expect(row.transit_walk_time).toBe(8);
        expect(row.transit_fare).toBe(TRANSIT_FARE);
        expect(row.auto_cost).toBeCloseTo(row.auto_dist * AUTO_COST_PER_KM + AUTO_PARKING_COST, 9);
        expect(row.transit_ivtt).toBeCloseTo(row.auto_time * 1.5, 9);
      }
    }
  });

  it("uses half the distance to the nearest other zone for intrazonal skims", () => {
    const { zones, skims } = build().inputs;

    for (const origin of zones) {
      const nearestSkimDist = Math.min(
        ...zones
          .filter((zone) => zone.id !== origin.id)
          .map((zone) => skims[origin.id][zone.id].auto_dist),
      );
      expect(skims[origin.id][origin.id].auto_dist).toBeCloseTo(nearestSkimDist / 2, 9);
    }
  });

  it("places zones on a deterministic grid when tract centroids are missing", () => {
    const gridless = FIXTURE_TRACTS.map(({ lon: _lon, lat: _lat, ...tract }) => tract);
    const first = buildSketchAbmInputs({ censusTracts: gridless, lodesJobs: FIXTURE_LODES, seed: 7 }).inputs;
    const second = buildSketchAbmInputs({ censusTracts: gridless, lodesJobs: FIXTURE_LODES, seed: 7 }).inputs;
    expect(second.zones).toEqual(first.zones);

    // Distinct grid positions with a positive intrazonal distance.
    const positions = new Set(first.zones.map((zone) => `${zone.lon},${zone.lat}`));
    expect(positions.size).toBe(first.zones.length);
    for (const zone of first.zones) {
      expect(first.skims[zone.id][zone.id].auto_dist).toBeGreaterThan(0);
    }
  });

  it("applies the documented circuity factor to interzonal distances", () => {
    const twoTracts: SketchAbmTractInput[] = [
      { geoid: "A", population: 100, totalHouseholds: 40, lon: -121.5, lat: 39.5 },
      // ~0.9 degree of longitude apart at this latitude.
      { geoid: "B", population: 100, totalHouseholds: 40, lon: -120.6, lat: 39.5 },
    ];
    const { skims } = buildSketchAbmInputs({
      censusTracts: twoTracts,
      lodesJobs: { totalJobs: 100 },
      seed: 1,
    }).inputs;
    const greatCircleKm = skims.A.B.auto_dist / CIRCUITY_FACTOR;
    // ~77.3 km great-circle for 0.9° longitude at 39.5°N.
    expect(greatCircleKm).toBeGreaterThan(74);
    expect(greatCircleKm).toBeLessThan(81);
  });
});

describe("seedFromRunId", () => {
  it("derives a stable 32-bit seed from a run UUID", () => {
    const runId = "22222222-2222-4222-8222-222222222222";
    expect(seedFromRunId(runId)).toBe(seedFromRunId(runId));
    expect(seedFromRunId(runId)).toBe(0x22222222);
    expect(seedFromRunId("ffffffff-0000-4000-8000-000000000000")).toBe(0xffffffff);
  });

  it("falls back to 0 for non-hex input", () => {
    expect(seedFromRunId("not-a-uuid")).toBe(0);
  });
});
