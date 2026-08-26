import { describe, expect, it } from "vitest";
import {
  matchSafetyRoadIdentity,
  readCachedUsRoadContext,
} from "@/lib/safety/road-context";
import { renderSafetyStreetContextSvg } from "@/lib/safety/street-context-svg";

const TIGER_ROW = {
  id: "road-1",
  name: "State Route 49",
  geometry_geojson: {
    type: "LineString",
    coordinates: [[-121.061, 39.218], [-121.061, 39.222]],
  },
  source: "U.S. Census TIGER/Line",
  vintage: "2025",
};

describe("cached US road context", () => {
  it("accepts named TIGER and OSM lines with source and vintage", () => {
    const roads = readCachedUsRoadContext([
      TIGER_ROW,
      { ...TIGER_ROW, id: "road-2", name: "Empire Street", source: "OpenStreetMap" },
    ]);
    expect(roads.map((road) => road.sourceId)).toEqual([
      "us-census-tiger-line-cache",
      "osm-network-cache",
    ]);
  });

  it("rejects unlabeled, undated, malformed, and unregistered road evidence", () => {
    expect(readCachedUsRoadContext([
      { ...TIGER_ROW, name: "" },
      { ...TIGER_ROW, vintage: null },
      { ...TIGER_ROW, geometry_geojson: { type: "Point", coordinates: [-121, 39] } },
      { ...TIGER_ROW, source: "A road somebody drew" },
    ])).toEqual([]);
  });

  it("records the road, provider, vintage, distance, and match quality", () => {
    const [road] = readCachedUsRoadContext([TIGER_ROW]);
    expect(matchSafetyRoadIdentity(-121.0611, 39.219, [road])).toEqual({
      status: "matched",
      name: "State Route 49",
      sourceId: "us-census-tiger-line-cache",
      sourceLabel: "U.S. Census TIGER/Line roads",
      vintage: "2025",
      matchQuality: "high",
      distanceMeters: 9,
    });
  });

  it("discloses unavailable identity when the evidence is missing or too far away", () => {
    const [road] = readCachedUsRoadContext([TIGER_ROW]);
    expect(matchSafetyRoadIdentity(-121, 39, [])).toEqual({
      status: "unavailable",
      reason: "no_registered_road_evidence",
    });
    expect(matchSafetyRoadIdentity(-120, 38, [road])).toEqual({
      status: "unavailable",
      reason: "no_named_road_within_150m",
    });
  });

  it("renders project, road, crash, scale, and north context without tiles", () => {
    const [road] = readCachedUsRoadContext([TIGER_ROW]);
    const svg = renderSafetyStreetContextSvg({
      roads: [road],
      crashLocations: [[-121.0611, 39.219]],
      projectGeometry: {
        type: "Polygon",
        coordinates: [[
          [-121.07, 39.21], [-121.05, 39.21], [-121.05, 39.23],
          [-121.07, 39.23], [-121.07, 39.21],
        ]],
      },
    });
    expect(svg).toContain("<polyline");
    expect(svg).toContain("<polygon");
    expect(svg).toContain("<circle");
    expect(svg).toContain(">N</text>");
    expect(svg).toMatch(/(?:m|km)<\/text>/);
    expect(svg).not.toMatch(/mapbox|tile|<image|href=/i);
  });
});
