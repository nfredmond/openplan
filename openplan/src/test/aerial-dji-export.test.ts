import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  buildDjiMissionExport,
  isAoiPolygonGeoJson,
  type AoiPolygonGeoJson,
} from "@/lib/aerial/dji-export";
import { GET as supersededExportRoute } from "@/app/api/aerial/missions/[missionId]/export/route";

/**
 * SUPERSEDED LANE (2026-08-11). The perimeter export below is replaced by the
 * flight-plan exports (src/lib/aerial/flight-exports.ts, served by
 * /api/aerial/missions/[missionId]/flight-plan/export). The builder tests are
 * KEPT because the module still exists in the tree (isAoiPolygonGeoJson is
 * live) and a test that stops describing shipped code should be deleted with
 * the code, not before it. The route test asserts the tombstone: 410, with
 * copy that points a stranded caller at the replacement.
 */

describe("superseded DJI export route", () => {
  it("answers 410 Gone and points at the flight-plan exports", async () => {
    const response = await supersededExportRoute(
      new NextRequest(
        "http://localhost/api/aerial/missions/00000000-0000-4000-8000-000000000009/export?format=dji-json"
      )
    );
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error).toContain("no longer exists");
    expect(body.error).toContain("/flight-plan/export");
  });
});

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
