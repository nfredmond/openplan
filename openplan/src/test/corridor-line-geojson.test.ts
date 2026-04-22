import { describe, expect, it } from "vitest";

import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";

const valid = {
  type: "LineString" as const,
  coordinates: [
    [-121.05, 39.22],
    [-121.04, 39.23],
    [-121.03, 39.24],
  ] as [number, number][],
};

describe("isCorridorLineGeoJson", () => {
  it("accepts a well-formed LineString with >=2 positions", () => {
    expect(isCorridorLineGeoJson(valid)).toBe(true);
  });

  it("accepts exactly 2 positions (minimum valid segment)", () => {
    expect(
      isCorridorLineGeoJson({
        type: "LineString",
        coordinates: [
          [-121.0, 39.0],
          [-121.1, 39.1],
        ],
      }),
    ).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isCorridorLineGeoJson(null)).toBe(false);
    expect(isCorridorLineGeoJson(undefined)).toBe(false);
    expect(isCorridorLineGeoJson("LineString")).toBe(false);
    expect(isCorridorLineGeoJson(123)).toBe(false);
  });

  it("rejects wrong geometry type", () => {
    expect(
      isCorridorLineGeoJson({ ...valid, type: "Polygon" }),
    ).toBe(false);
    expect(
      isCorridorLineGeoJson({ ...valid, type: "Point" }),
    ).toBe(false);
  });

  it("rejects fewer than 2 positions", () => {
    expect(
      isCorridorLineGeoJson({ type: "LineString", coordinates: [[-121, 39]] }),
    ).toBe(false);
    expect(
      isCorridorLineGeoJson({ type: "LineString", coordinates: [] }),
    ).toBe(false);
  });

  it("rejects non-numeric coordinate positions", () => {
    expect(
      isCorridorLineGeoJson({
        type: "LineString",
        coordinates: [["-121", "39"], [-121.1, 39.1]],
      }),
    ).toBe(false);
  });

  it("rejects non-finite coordinates", () => {
    expect(
      isCorridorLineGeoJson({
        type: "LineString",
        coordinates: [
          [Number.NaN, 39],
          [-121, 39.1],
        ],
      }),
    ).toBe(false);
    expect(
      isCorridorLineGeoJson({
        type: "LineString",
        coordinates: [
          [Number.POSITIVE_INFINITY, 39],
          [-121, 39.1],
        ],
      }),
    ).toBe(false);
  });

  it("rejects coordinates outside the WGS84 range", () => {
    expect(
      isCorridorLineGeoJson({
        type: "LineString",
        coordinates: [
          [-200, 39],
          [-121, 39.1],
        ],
      }),
    ).toBe(false);
    expect(
      isCorridorLineGeoJson({
        type: "LineString",
        coordinates: [
          [-121, 39],
          [-121.1, 95],
        ],
      }),
    ).toBe(false);
  });
});
