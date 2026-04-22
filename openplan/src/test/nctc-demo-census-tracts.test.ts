import { describe, expect, it } from "vitest";

import {
  DEMO_TRACT_GRASS_VALLEY_CORE,
  DEMO_TRACT_GRASS_VALLEY_CORE_GEOID,
  DEMO_TRACT_GRASS_VALLEY_SOUTH,
  DEMO_TRACT_GRASS_VALLEY_SOUTH_GEOID,
  DEMO_TRACT_NEVADA_CITY,
  DEMO_TRACT_NEVADA_CITY_GEOID,
  DEMO_TRACT_RURAL_EAST,
  DEMO_TRACT_RURAL_EAST_GEOID,
} from "../../scripts/seed-nctc-demo";

type Tract = { type: "MultiPolygon"; coordinates: number[][][][] };

const tracts: Array<[string, Tract, string]> = [
  ["GRASS_VALLEY_CORE", DEMO_TRACT_GRASS_VALLEY_CORE, DEMO_TRACT_GRASS_VALLEY_CORE_GEOID],
  ["GRASS_VALLEY_SOUTH", DEMO_TRACT_GRASS_VALLEY_SOUTH, DEMO_TRACT_GRASS_VALLEY_SOUTH_GEOID],
  ["NEVADA_CITY", DEMO_TRACT_NEVADA_CITY, DEMO_TRACT_NEVADA_CITY_GEOID],
  ["RURAL_EAST", DEMO_TRACT_RURAL_EAST, DEMO_TRACT_RURAL_EAST_GEOID],
];

describe("NCTC demo census tracts", () => {
  it.each(tracts)("%s is a valid MultiPolygon with a closed outer ring", (_name, tract) => {
    expect(tract.type).toBe("MultiPolygon");
    expect(Array.isArray(tract.coordinates)).toBe(true);
    expect(tract.coordinates.length).toBeGreaterThan(0);

    const outer = tract.coordinates[0][0];
    expect(outer.length).toBeGreaterThanOrEqual(4);
    const first = outer[0];
    const last = outer[outer.length - 1];
    expect(first[0]).toBe(last[0]);
    expect(first[1]).toBe(last[1]);
  });

  it.each(tracts)("%s uses Nevada County (FIPS 06057) GEOID %s", (_name, _tract, geoid) => {
    expect(geoid).toMatch(/^06057\d{6}$/);
  });

  it("every tract's positions land in WGS84 lat/lng range", () => {
    for (const [, tract] of tracts) {
      for (const ring of tract.coordinates[0]) {
        for (const [lng, lat] of ring) {
          expect(lng).toBeGreaterThan(-180);
          expect(lng).toBeLessThan(180);
          expect(lat).toBeGreaterThan(-90);
          expect(lat).toBeLessThan(90);
        }
      }
    }
  });

  it("tract GEOIDs are unique across the demo set", () => {
    const ids = tracts.map(([, , geoid]) => geoid);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
