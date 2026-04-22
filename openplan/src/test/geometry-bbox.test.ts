import { describe, expect, it } from "vitest";

import { fitInstructionFromGeometry } from "@/lib/cartographic/geometry-bbox";

describe("fitInstructionFromGeometry", () => {
  it("returns a center instruction for a Point", () => {
    expect(
      fitInstructionFromGeometry({ type: "Point", coordinates: [-121.05, 39.22] })
    ).toEqual({ kind: "center", center: [-121.05, 39.22] });
  });

  it("returns a bbox instruction for a LineString", () => {
    expect(
      fitInstructionFromGeometry({
        type: "LineString",
        coordinates: [
          [-121.1, 39.0],
          [-121.0, 39.1],
          [-121.05, 39.2],
        ],
      })
    ).toEqual({
      kind: "bbox",
      bbox: [
        [-121.1, 39.0],
        [-121.0, 39.2],
      ],
    });
  });

  it("returns a bbox instruction for a Polygon using the outer ring", () => {
    expect(
      fitInstructionFromGeometry({
        type: "Polygon",
        coordinates: [
          [
            [-121.1, 39.0],
            [-121.0, 39.0],
            [-121.0, 39.1],
            [-121.1, 39.1],
            [-121.1, 39.0],
          ],
          [
            // Interior hole — should be ignored for bbox math.
            [-121.08, 39.02],
            [-121.06, 39.02],
            [-121.06, 39.04],
            [-121.08, 39.04],
            [-121.08, 39.02],
          ],
        ],
      })
    ).toEqual({
      kind: "bbox",
      bbox: [
        [-121.1, 39.0],
        [-121.0, 39.1],
      ],
    });
  });

  it("returns a bbox union across every polygon in a MultiPolygon", () => {
    expect(
      fitInstructionFromGeometry({
        type: "MultiPolygon",
        coordinates: [
          [
            // Polygon A — outer ring only.
            [
              [-121.1, 39.0],
              [-121.0, 39.0],
              [-121.0, 39.1],
              [-121.1, 39.1],
              [-121.1, 39.0],
            ],
          ],
          [
            // Polygon B — outer + interior hole; hole is ignored.
            [
              [-120.9, 39.2],
              [-120.8, 39.2],
              [-120.8, 39.3],
              [-120.9, 39.3],
              [-120.9, 39.2],
            ],
            [
              [-120.87, 39.22],
              [-120.82, 39.22],
              [-120.82, 39.27],
              [-120.87, 39.27],
              [-120.87, 39.22],
            ],
          ],
        ],
      })
    ).toEqual({
      kind: "bbox",
      bbox: [
        [-121.1, 39.0],
        [-120.8, 39.3],
      ],
    });
  });

  it("returns null for an empty MultiPolygon", () => {
    expect(fitInstructionFromGeometry({ type: "MultiPolygon", coordinates: [] })).toBeNull();
  });

  it("skips malformed polygons inside a MultiPolygon without throwing", () => {
    expect(
      fitInstructionFromGeometry({
        type: "MultiPolygon",
        coordinates: [
          "garbage",
          [
            [
              [-121.0, 39.0],
              [-120.9, 39.0],
              [-120.9, 39.1],
              [-121.0, 39.1],
              [-121.0, 39.0],
            ],
          ],
          [[[1]]],
        ],
      })
    ).toEqual({
      kind: "bbox",
      bbox: [
        [-121.0, 39.0],
        [-120.9, 39.1],
      ],
    });
  });

  it("returns null for unsupported geometry types", () => {
    expect(
      fitInstructionFromGeometry({ type: "GeometryCollection", geometries: [] })
    ).toBeNull();
    expect(
      fitInstructionFromGeometry({ type: "MultiLineString", coordinates: [] })
    ).toBeNull();
  });

  it("returns null for malformed or missing inputs", () => {
    expect(fitInstructionFromGeometry(null)).toBeNull();
    expect(fitInstructionFromGeometry(undefined)).toBeNull();
    expect(fitInstructionFromGeometry({})).toBeNull();
    expect(fitInstructionFromGeometry({ type: "Point" })).toBeNull();
    expect(fitInstructionFromGeometry({ type: "Point", coordinates: "not-an-array" })).toBeNull();
    expect(
      fitInstructionFromGeometry({ type: "Point", coordinates: [Number.NaN, 0] })
    ).toBeNull();
    expect(
      fitInstructionFromGeometry({
        type: "LineString",
        coordinates: [[Number.POSITIVE_INFINITY, 0]],
      })
    ).toBeNull();
    expect(
      fitInstructionFromGeometry({
        type: "Polygon",
        coordinates: [[[1]]],
      })
    ).toBeNull();
  });

  it("skips malformed positions inside a LineString without throwing", () => {
    expect(
      fitInstructionFromGeometry({
        type: "LineString",
        coordinates: [
          [-121.1, 39.0],
          "garbage",
          [-121.0, 39.1],
        ],
      })
    ).toEqual({
      kind: "bbox",
      bbox: [
        [-121.1, 39.0],
        [-121.0, 39.1],
      ],
    });
  });
});
