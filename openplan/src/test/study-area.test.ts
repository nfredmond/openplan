import { describe, expect, it } from "vitest";
import {
  LARGE_AREA_KM2,
  parseCorridorText,
  studyAreaPrefillFromHomeGeography,
  summarizeCorridorText,
} from "@/lib/models/study-area";
import type { WorkspaceHomeGeography } from "@/lib/workspaces/home-geography";

/** A boundary fixture. Synthetic coordinates; no place is known to the code. */
const BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-83.2, 39.8],
      [-82.8, 39.8],
      [-82.8, 40.1],
      [-83.2, 40.1],
      [-83.2, 39.8],
    ],
  ],
};

function homeGeography(over: Partial<WorkspaceHomeGeography> = {}): WorkspaceHomeGeography {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "99999",
    home_geography_label: "Example County, ZZ",
    home_country_code: "US",
    home_subdivision_code: "ZZ",
    home_min_lon: -83.2,
    home_min_lat: 39.8,
    home_max_lon: -82.8,
    home_max_lat: 40.1,
    home_geometry_geojson: BOUNDARY,
    home_geography_set_at: "2026-07-27T00:00:00.000Z",
    ...over,
  };
}

describe("summarizeCorridorText", () => {
  it("returns invalid for empty, non-JSON, or non-polygon input", () => {
    expect(summarizeCorridorText("")).toEqual({ valid: false, bbox: null, areaKm2: null });
    expect(summarizeCorridorText("not json")).toEqual({ valid: false, bbox: null, areaKm2: null });
    expect(summarizeCorridorText(JSON.stringify({ type: "Point", coordinates: [0, 0] }))).toEqual({
      valid: false,
      bbox: null,
      areaKm2: null,
    });
  });

  it("computes a bbox and approximate area for a Polygon", () => {
    const polygon = JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-121.8, 38.5],
          [-121.8, 38.6],
          [-121.7, 38.6],
          [-121.7, 38.5],
          [-121.8, 38.5],
        ],
      ],
    });
    const summary = summarizeCorridorText(polygon);
    expect(summary.valid).toBe(true);
    expect(summary.bbox).toEqual({ minLon: -121.8, minLat: 38.5, maxLon: -121.7, maxLat: 38.6 });
    // ~0.1deg lat (11km) x ~0.1deg lon (~8.7km at 38.5N) ≈ 96 km²; small, not "large".
    expect(summary.areaKm2).toBeGreaterThan(50);
    expect(summary.areaKm2).toBeLessThan(LARGE_AREA_KM2);
  });

  it("walks every ring of a MultiPolygon for the bounding extent", () => {
    const multi = JSON.stringify({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-122, 38],
            [-122, 39],
            [-121, 39],
            [-121, 38],
            [-122, 38],
          ],
        ],
        [
          [
            [-120, 40],
            [-120, 41],
            [-119, 41],
            [-119, 40],
            [-120, 40],
          ],
        ],
      ],
    });
    const summary = summarizeCorridorText(multi);
    expect(summary.bbox).toEqual({ minLon: -122, minLat: 38, maxLon: -119, maxLat: 41 });
    expect(summary.areaKm2).toBeGreaterThan(LARGE_AREA_KM2);
  });
});

describe("parseCorridorText", () => {
  it("returns the geometry a study-area text carries", () => {
    expect(parseCorridorText(JSON.stringify(BOUNDARY))).toEqual(BOUNDARY);
  });

  it("returns null for empty, unparseable, or non-corridor text", () => {
    expect(parseCorridorText("")).toBeNull();
    expect(parseCorridorText("   ")).toBeNull();
    expect(parseCorridorText("not json")).toBeNull();
    expect(parseCorridorText(JSON.stringify({ type: "Point", coordinates: [0, 0] }))).toBeNull();
    // A ring of three points is not a ring the run APIs would accept either.
    expect(
      parseCorridorText(
        JSON.stringify({ type: "Polygon", coordinates: [[[-83.2, 39.8], [-82.8, 39.8], [-83.2, 39.8]]] })
      )
    ).toBeNull();
  });
});

describe("studyAreaPrefillFromHomeGeography", () => {
  it("reconstructs the study area, its text, and the place identity", () => {
    const prefill = studyAreaPrefillFromHomeGeography(homeGeography());

    expect(prefill.geometry).toEqual(BOUNDARY);
    expect(prefill.corridorText).toBe(JSON.stringify(BOUNDARY));
    expect(prefill.label).toBe("Example County, ZZ");
    expect(prefill.place).toEqual({
      kind: "county",
      geoid: "99999",
      label: "Example County, ZZ",
      geojson: BOUNDARY,
      bbox: { minLon: -83.2, minLat: 39.8, maxLon: -82.8, maxLat: 40.1 },
    });
  });

  it("prefills nothing when the workspace has no home geography", () => {
    for (const unset of [null, undefined]) {
      const prefill = studyAreaPrefillFromHomeGeography(unset);
      expect(prefill.geometry).toBeNull();
      expect(prefill.corridorText).toBe("");
      expect(prefill.place).toBeNull();
      expect(prefill.label).toBeNull();
    }
  });

  it("prefills nothing when the stored boundary geometry is missing or malformed", () => {
    // A bbox is not a boundary. Substituting the rectangle would analyze a shape
    // the agency never chose.
    expect(studyAreaPrefillFromHomeGeography(homeGeography({ home_geometry_geojson: null })).geometry).toBeNull();
    expect(
      studyAreaPrefillFromHomeGeography(homeGeography({ home_geometry_geojson: { type: "Point", coordinates: [0, 0] } }))
        .geometry
    ).toBeNull();
  });

  it("keeps the boundary but drops the place identity for another resolver's refs", () => {
    const prefill = studyAreaPrefillFromHomeGeography(homeGeography({ home_geography_source: "some-other-resolver" }));

    expect(prefill.geometry).toEqual(BOUNDARY);
    expect(prefill.place).toBeNull();
  });
});
