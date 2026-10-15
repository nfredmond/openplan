import { describe, expect, it } from "vitest";
import { fitInstructionFromSavedGeometry } from "@/lib/cartographic/saved-geometry-frame";
import type { FitInstruction } from "@/lib/cartographic/geometry-bbox";

const rectangle = (west: number, east: number): GeoJSON.Polygon => ({
  type: "Polygon", coordinates: [[[west, 51], [east, 51], [east, 51.2], [west, 51.2], [west, 51]]],
});
const split: GeoJSON.MultiPolygon = {
  type: "MultiPolygon", coordinates: [rectangle(179.7, 180).coordinates, rectangle(-180, -179.7).coordinates],
};
const fixtures: { name: string; geometries: GeoJSON.Geometry[]; expected: FitInstruction | null }[] = [
  { name: "empty", geometries: [], expected: null },
  { name: "split-date-line", geometries: [split], expected: { kind: "bbox", bbox: [[179.7, 51], [180.3, 51.2]] } },
  { name: "both-side-points", geometries: [
    { type: "Point", coordinates: [179.8, 51.1] }, { type: "Point", coordinates: [-179.8, 51.1] },
  ], expected: { kind: "bbox", bbox: [[179.8, 51.1], [180.2, 51.1]] } },
  { name: "broad-area", geometries: [rectangle(-170, 170)], expected: { kind: "bbox", bbox: [[-170, 51], [170, 51.2]] } },
  { name: "full-world", geometries: [rectangle(-180, 180)], expected: { kind: "bbox", bbox: [[-180, 51], [180, 51.2]] } },
  { name: "overlapping-parts", geometries: [{
    type: "MultiPolygon", coordinates: [rectangle(-170, 170).coordinates, rectangle(-30, 30).coordinates],
  }, { type: "Point", coordinates: [175, 51.1] }], expected: { kind: "bbox", bbox: [[-170, 51], [175, 51.2]] } },
  { name: "broad-line", geometries: [{ type: "LineString", coordinates: [[-170, 51], [170, 51.2]] }], expected: { kind: "bbox", bbox: [[-170, 51], [170, 51.2]] } },
  { name: "local-zero-with-hole", geometries: [{
    type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]]],
  }], expected: { kind: "bbox", bbox: [[0, 0], [2, 2]] } },
  { name: "zero-point", geometries: [{ type: "Point", coordinates: [0, 0] }], expected: { kind: "center", center: [0, 0] } },
  { name: "ordinary-gap-tie", geometries: [{ type: "Point", coordinates: [-90, 0] }, { type: "Point", coordinates: [90, 0] }], expected: { kind: "bbox", bbox: [[-90, 0], [90, 0]] } },
];

describe("saved geometry framing", () => {
  it.each(fixtures)("frames $name without rewriting source", ({ name, geometries, expected }) => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection", features: geometries.map((geometry) => ({ type: "Feature", properties: {}, geometry })),
    };
    const before = JSON.stringify(collection);
    expect(fitInstructionFromSavedGeometry(collection), `camera-frame:${name}`).toEqual(expected);
    expect(collection, `source-parity:${name}`).toEqual(JSON.parse(before));
  });
});
