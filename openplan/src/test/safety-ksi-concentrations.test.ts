import { describe, expect, it } from "vitest";

import {
  readSafetyKsiBounds,
  readSafetyKsiConcentrations,
} from "@/lib/safety/ksi-concentrations";

describe("readSafetyKsiConcentrations", () => {
  it("uses the union of the project acquisition extents", () => {
    expect(readSafetyKsiBounds([
      { min_lon: -123, min_lat: 38, max_lon: -122, max_lat: 39 },
      { min_lon: -122.5, min_lat: 38.5, max_lon: -121, max_lat: 40 },
    ])).toEqual({ minLon: -123, minLat: 38, maxLon: -121, maxLat: 40 });
  });

  it("maps the database ranking into the planner-visible response", () => {
    expect(readSafetyKsiConcentrations([
      {
        rank: 1,
        longitude: -121.061,
        latitude: 39.219,
        crash_count: 7,
        fatal_crash_count: 2,
        serious_injury_crash_count: 5,
        radius_meters: 150,
      },
    ])).toEqual([
      {
        rank: 1,
        longitude: -121.061,
        latitude: 39.219,
        crashCount: 7,
        fatalCrashCount: 2,
        seriousInjuryCrashCount: 5,
        radiusMeters: 150,
      },
    ]);
  });

  it("drops partial and internally inconsistent database rows", () => {
    expect(readSafetyKsiConcentrations([
      { rank: 1, longitude: -121, latitude: 39 },
      {
        rank: 2,
        longitude: -121,
        latitude: 39,
        crash_count: 3,
        fatal_crash_count: 1,
        serious_injury_crash_count: 1,
        radius_meters: 150,
      },
    ])).toEqual([]);
  });
});
