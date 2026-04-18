import { describe, expect, it } from "vitest";
import {
  buildDjiMissionExport,
  isAoiPolygonGeoJson,
  type AoiPolygonGeoJson,
} from "@/lib/aerial/dji-export";

const nevadaCountySquare: AoiPolygonGeoJson = {
  type: "Polygon",
  coordinates: [
    [
      [-121.05, 39.22],
      [-121.0, 39.22],
      [-121.0, 39.27],
      [-121.05, 39.27],
      [-121.05, 39.22],
    ],
  ],
};

describe("isAoiPolygonGeoJson", () => {
  it("accepts a valid closed polygon", () => {
    expect(isAoiPolygonGeoJson(nevadaCountySquare)).toBe(true);
  });

  it("rejects non-Polygon types", () => {
    expect(isAoiPolygonGeoJson({ type: "Point", coordinates: [0, 0] })).toBe(false);
    expect(isAoiPolygonGeoJson(null)).toBe(false);
    expect(isAoiPolygonGeoJson(undefined)).toBe(false);
  });

  it("rejects rings with fewer than 4 positions", () => {
    expect(
      isAoiPolygonGeoJson({
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [0, 0]]],
      })
    ).toBe(false);
  });

  it("rejects rings with non-numeric positions", () => {
    expect(
      isAoiPolygonGeoJson({
        type: "Polygon",
        coordinates: [[["a", 0], [1, 1], [1, 0], ["a", 0]]],
      })
    ).toBe(false);
  });
});

describe("buildDjiMissionExport", () => {
  const now = new Date("2026-04-18T12:00:00Z");

  it("drops the closing vertex and emits one waypoint per perimeter vertex", () => {
    const result = buildDjiMissionExport({
      missionId: "00000000-0000-4000-8000-000000000001",
      missionTitle: "Nevada County test",
      aoiGeojson: nevadaCountySquare,
      now,
    });
    expect(result.waypointCount).toBe(4);
    expect(result.waypoints).toHaveLength(4);
    expect(result.waypoints[0].index).toBe(0);
  });

  it("applies default altitude and speed when not provided", () => {
    const result = buildDjiMissionExport({
      missionId: "00000000-0000-4000-8000-000000000002",
      missionTitle: "defaults-test",
      aoiGeojson: nevadaCountySquare,
      now,
    });
    expect(result.defaults.altitudeMeters).toBe(90);
    expect(result.defaults.speedMetersPerSecond).toBe(5);
    expect(result.waypoints.every((w) => w.altitude === 90)).toBe(true);
    expect(result.waypoints.every((w) => w.speed === 5)).toBe(true);
  });

  it("honors override altitude and speed", () => {
    const result = buildDjiMissionExport({
      missionId: "00000000-0000-4000-8000-000000000003",
      missionTitle: "override-test",
      aoiGeojson: nevadaCountySquare,
      altitudeMeters: 120,
      speedMetersPerSecond: 7,
      now,
    });
    expect(result.defaults.altitudeMeters).toBe(120);
    expect(result.defaults.speedMetersPerSecond).toBe(7);
    expect(result.waypoints.every((w) => w.altitude === 120)).toBe(true);
    expect(result.waypoints.every((w) => w.speed === 7)).toBe(true);
  });

  it("computes headings between 0 and 360 degrees", () => {
    const result = buildDjiMissionExport({
      missionId: "00000000-0000-4000-8000-000000000004",
      missionTitle: "heading-test",
      aoiGeojson: nevadaCountySquare,
      now,
    });
    for (const waypoint of result.waypoints) {
      expect(waypoint.heading).toBeGreaterThanOrEqual(0);
      expect(waypoint.heading).toBeLessThan(360);
    }
  });

  it("pins the schema version and generation timestamp", () => {
    const result = buildDjiMissionExport({
      missionId: "00000000-0000-4000-8000-000000000005",
      missionTitle: "schema-test",
      aoiGeojson: nevadaCountySquare,
      now,
    });
    expect(result.schemaVersion).toBe("natford-dji-1");
    expect(result.generatedAt).toBe("2026-04-18T12:00:00.000Z");
  });

  it("throws on invalid GeoJSON input", () => {
    expect(() =>
      buildDjiMissionExport({
        missionId: "00000000-0000-4000-8000-000000000006",
        missionTitle: "bad-input",
        // @ts-expect-error intentional invalid input
        aoiGeojson: { type: "Point", coordinates: [0, 0] },
        now,
      })
    ).toThrow("valid GeoJSON Polygon");
  });
});
