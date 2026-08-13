import { describe, expect, it, vi } from "vitest";

import {
  applyFitInstruction,
  fitInstructionFromExtent,
  fitInstructionFromGeometry,
  FIT_DURATION_MS,
  FIT_MAX_ZOOM,
  FIT_PADDING,
  POINT_FIT_ZOOM,
  type FitTarget,
} from "@/lib/cartographic/geometry-bbox";

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

/**
 * A LAYER'S RECORDED EXTENT, TURNED INTO A CAMERA.
 *
 * The ingest writes `[west, south, east, north]` onto the version row. Until
 * v0.20.1 nothing read it: "Show on the map" switched a layer on and left the
 * map at the continental default, so a thirteen-kilometre bike network was
 * drawn inside a view spanning a continent — present, correct, and invisible.
 * These are the rules for reading that number back.
 */
describe("fitInstructionFromExtent", () => {
  it("frames a recorded extent as its two corners, in [[w,s],[e,n]] order", () => {
    expect(fitInstructionFromExtent([-121.1, 39.18, -120.98, 39.26])).toEqual({
      kind: "bbox",
      bbox: [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
    });
  });

  /**
   * A layer holding one point has west === east and south === north, and
   * `fitBounds` on a rectangle of no size asks Mapbox for infinite zoom. The
   * center branch is the same one a click on a Point feature takes.
   */
  it("uses the center branch for a single-point extent", () => {
    expect(fitInstructionFromExtent([-121.05, 39.22, -121.05, 39.22])).toEqual({
      kind: "center",
      center: [-121.05, 39.22],
    });
  });

  it("refuses to move for an extent that was never recorded", () => {
    expect(fitInstructionFromExtent(null)).toBeNull();
    expect(fitInstructionFromExtent(undefined)).toBeNull();
  });

  /**
   * REFUSING IS THE FEATURE. A camera flown to a bogus extent puts a planner in
   * empty ocean with no reason to doubt what they are looking at, which is
   * strictly worse than leaving them where they were.
   */
  it("refuses an extent that cannot be a place on Earth", () => {
    expect(fitInstructionFromExtent([Number.NaN, 39.18, -120.98, 39.26])).toBeNull();
    expect(fitInstructionFromExtent([-121.1, 39.18, -120.98, 95])).toBeNull();
    expect(fitInstructionFromExtent([-181, 39.18, -120.98, 39.26])).toBeNull();
    // Inverted: east west of west.
    expect(fitInstructionFromExtent([-120.98, 39.18, -121.1, 39.26])).toBeNull();
    // Unprojected State Plane northings, the classic way a layer lands nowhere.
    expect(fitInstructionFromExtent([2043211.5, 6712894.2, 2051880.9, 6720113.4])).toBeNull();
    expect(fitInstructionFromExtent([-121.1, 39.18, -120.98])).toBeNull();
  });
});

/**
 * THE CAMERA VOCABULARY ITSELF.
 *
 * jsdom has no box model and Mapbox will not initialise in it, so this asserts
 * the INSTRUCTION — which branch, which zoom, which padding, which duration —
 * and not that any pixel moved. What stays unproven here is only that Mapbox
 * honours its own documented options.
 */
describe("applyFitInstruction", () => {
  function fakeMap() {
    const easeTo = vi.fn();
    const fitBounds = vi.fn();
    return { easeTo, fitBounds } satisfies FitTarget;
  }

  it("eases to a point at the point zoom", () => {
    const map = fakeMap();
    applyFitInstruction(map, { kind: "center", center: [-121.05, 39.22] });

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.easeTo).toHaveBeenCalledWith({
      center: [-121.05, 39.22],
      zoom: POINT_FIT_ZOOM,
      duration: FIT_DURATION_MS,
    });
  });

  it("fits to two corners with the shared padding and ceiling", () => {
    const map = fakeMap();
    applyFitInstruction(map, {
      kind: "bbox",
      bbox: [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
    });

    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
      { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: FIT_DURATION_MS }
    );
  });

  /**
   * VARIED BINDING. One extent cannot tell "passes the instruction through"
   * apart from "hardcodes a rectangle": both pass with a single fixture.
   */
  it("passes the instruction through rather than a remembered one", () => {
    const map = fakeMap();
    applyFitInstruction(map, {
      kind: "bbox",
      bbox: [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
    });
    applyFitInstruction(map, {
      kind: "bbox",
      bbox: [
        [-84.6, 39.05],
        [-84.4, 39.2],
      ],
    });

    expect(map.fitBounds.mock.calls.map((call) => call[0])).toEqual([
      [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
      [
        [-84.6, 39.05],
        [-84.4, 39.2],
      ],
    ]);
  });
});
