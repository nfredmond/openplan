/**
 * THE ONE PLACE THAT DECIDES WHETHER FOUR NUMBERS ARE A PLACE.
 *
 * Two callers depend on this module for opposite-looking reasons and must not
 * be allowed to drift apart: the workspace-GIS viewport query refuses a window
 * it cannot select inside, and the map camera refuses an extent it cannot fly
 * to. The failure they are both defending against is the silent one — a
 * rectangle that is wrong rather than absent, which looks exactly like a
 * rectangle that is right, on a map and in a query alike.
 *
 * The DEGENERATE case is the one distinction between the two functions and the
 * reason both exist: a single-point layer has a real extent of zero size, and a
 * viewport of zero size is a bug.
 */

import { describe, expect, it } from "vitest";

import { isDegenerateBbox, readWgs84Bbox, readWgs84Viewport } from "@/lib/geo/wgs84-bounds";

describe("readWgs84Bbox", () => {
  it("accepts a rectangle on Earth, unchanged", () => {
    expect(readWgs84Bbox([-121.1, 39.18, -120.98, 39.26])).toEqual([
      -121.1, 39.18, -120.98, 39.26,
    ]);
  });

  it("accepts a degenerate extent — one point is a real place", () => {
    expect(readWgs84Bbox([-121.05, 39.22, -121.05, 39.22])).toEqual([
      -121.05, 39.22, -121.05, 39.22,
    ]);
  });

  it("accepts the extremes of the world exactly", () => {
    expect(readWgs84Bbox([-180, -90, 180, 90])).toEqual([-180, -90, 180, 90]);
  });

  it("refuses anything that is not four numbers", () => {
    expect(readWgs84Bbox(null)).toBeNull();
    expect(readWgs84Bbox(undefined)).toBeNull();
    expect(readWgs84Bbox("−121.1,39.1,−120.9,39.3")).toBeNull();
    expect(readWgs84Bbox([-121.1, 39.1, -120.9])).toBeNull();
    expect(readWgs84Bbox([-121.1, 39.1, -120.9, 39.3, 7])).toBeNull();
    expect(readWgs84Bbox([-121.1, "39.1", -120.9, 39.3])).toBeNull();
    expect(readWgs84Bbox({ west: -121.1, south: 39.1, east: -120.9, north: 39.3 })).toBeNull();
  });

  it("refuses NaN and infinities in any position", () => {
    expect(readWgs84Bbox([Number.NaN, 39.1, -120.9, 39.3])).toBeNull();
    expect(readWgs84Bbox([-121.1, Number.NaN, -120.9, 39.3])).toBeNull();
    expect(readWgs84Bbox([-121.1, 39.1, Number.NaN, 39.3])).toBeNull();
    expect(readWgs84Bbox([-121.1, 39.1, -120.9, Number.NaN])).toBeNull();
    expect(readWgs84Bbox([Number.POSITIVE_INFINITY, 39.1, -120.9, 39.3])).toBeNull();
  });

  /**
   * THE FAILURE THIS IS ACTUALLY FOR. Coordinates that were never reprojected
   * out of survey feet arrive as numbers in the millions, and a State Plane
   * northing read as a latitude is the commonest way a layer lands nowhere.
   */
  it("refuses coordinates outside the range of the world, in each position", () => {
    expect(readWgs84Bbox([-181, 39.1, -120.9, 39.3])).toBeNull();
    expect(readWgs84Bbox([-121.1, -91, -120.9, 39.3])).toBeNull();
    expect(readWgs84Bbox([-121.1, 39.1, 181, 39.3])).toBeNull();
    expect(readWgs84Bbox([-121.1, 39.1, -120.9, 91])).toBeNull();
    expect(readWgs84Bbox([2043211.5, 6712894.2, 2051880.9, 6720113.4])).toBeNull();
  });

  it("refuses an inverted rectangle rather than quietly reading it backwards", () => {
    expect(readWgs84Bbox([-120.9, 39.1, -121.1, 39.3])).toBeNull();
    expect(readWgs84Bbox([-121.1, 39.3, -120.9, 39.1])).toBeNull();
  });
});

describe("readWgs84Viewport", () => {
  it("accepts a window with area", () => {
    expect(readWgs84Viewport([-121.1, 39.18, -120.98, 39.26])).toEqual([
      -121.1, 39.18, -120.98, 39.26,
    ]);
  });

  it("refuses a window of zero area — nothing can be selected inside it", () => {
    expect(readWgs84Viewport([-121.05, 39.22, -121.05, 39.22])).toBeNull();
    expect(readWgs84Viewport([-121.1, 39.22, -120.9, 39.22])).toBeNull();
    expect(readWgs84Viewport([-121.05, 39.1, -121.05, 39.3])).toBeNull();
  });

  /**
   * The two functions share their range rules rather than restating them. If
   * that ever stops being true, this is the assertion that notices — a viewport
   * check that accepted something the bbox check refused would mean two
   * different ideas of the world in one product.
   */
  it("refuses everything the bbox reader refuses", () => {
    const refused: unknown[] = [
      null,
      [-121.1, 39.1, -120.9],
      [Number.NaN, 39.1, -120.9, 39.3],
      [-181, 39.1, -120.9, 39.3],
      [-121.1, 39.1, -120.9, 91],
      [-120.9, 39.1, -121.1, 39.3],
    ];
    for (const value of refused) {
      expect(readWgs84Bbox(value), JSON.stringify(value)).toBeNull();
      expect(readWgs84Viewport(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe("isDegenerateBbox", () => {
  it("separates a point from an area", () => {
    expect(isDegenerateBbox([-121.05, 39.22, -121.05, 39.22])).toBe(true);
    expect(isDegenerateBbox([-121.1, 39.18, -120.98, 39.26])).toBe(false);
    // A zero-width sliver is not a point: it has north-south extent, so a
    // camera can frame it and must not collapse it to a single position.
    expect(isDegenerateBbox([-121.05, 39.18, -121.05, 39.26])).toBe(false);
  });
});
