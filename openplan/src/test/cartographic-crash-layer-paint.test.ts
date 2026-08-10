import { describe, expect, it } from "vitest";
// Mapbox's own style validator — the same code the browser runs before it will
// accept a layer. Testing against anything else would only test our opinion of
// the spec.
// @ts-expect-error — mapbox-gl ships no type declarations for the style-spec
// cjs entry point; if it ever does, this directive fails and can be removed.
import { validate } from "mapbox-gl/dist/style-spec/index.cjs";

import {
  CRASH_CORE_CIRCLE_PAINT,
  CRASH_HALO_CIRCLE_PAINT,
} from "@/components/cartographic/cartographic-map-backdrop";

/**
 * A LAYER THE STYLE SPEC REJECTS IS NEVER ADDED, AND NOTHING SAYS SO.
 *
 * `map.addLayer` validates before it adds and throws on a bad paint property.
 * The map carries on, the other layers are fine, and the only evidence is a
 * console message nobody has open. Found on 2026-08-08 during a manual browser
 * pass: the crash CORE circles used
 *
 *     ["case", <selected>, 9, ["interpolate", ["linear"], ["zoom"], …]]
 *
 * which nests the zoom expression inside a branch. Mapbox permits `zoom` only
 * as the input to a TOP-LEVEL `step`/`interpolate`, so the layer threw while
 * the halo layer beneath it — whose interpolate was already top-level — was
 * accepted. Crashes therefore drew as blurred halos with no dot in the middle,
 * and hover and selection keyed to the core layer did nothing.
 *
 * It survived because an empty layer and an absent layer look the same, and
 * crash data is California-only today, so almost every workspace renders zero
 * crashes either way. Nothing short of validating the spec could catch it.
 */
function styleWith(paint: unknown) {
  return {
    version: 8 as const,
    sources: {
      crashes: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } },
    },
    layers: [{ id: "crashes-layer", type: "circle" as const, source: "crashes", paint }],
  };
}

function errorsFor(paint: unknown): string[] {
  return validate(styleWith(paint)).map((error: { message: string }) => error.message);
}

describe("cartographic crash layers are valid Mapbox styles", () => {
  it("accepts the core circle paint", () => {
    expect(errorsFor(CRASH_CORE_CIRCLE_PAINT)).toEqual([]);
  });

  it("accepts the halo circle paint", () => {
    expect(errorsFor(CRASH_HALO_CIRCLE_PAINT)).toEqual([]);
  });

  /**
   * The negative control. Without it, the two assertions above would pass just
   * as happily against a validator that accepts everything — and a validator
   * that never rejects is not a guard, it is decoration.
   */
  it("rejects a zoom expression nested inside a branch — the shape that shipped", () => {
    const nestedZoom = {
      ...CRASH_CORE_CIRCLE_PAINT,
      "circle-radius": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        9,
        ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7],
      ],
    };

    expect(errorsFor(nestedZoom)).toEqual([
      expect.stringContaining('"zoom" expression may only be used as input to a top-level'),
    ]);
  });

  /**
   * The behaviour the fix had to preserve, asserted on the values rather than
   * described in a comment: a selected crash stays the same size at every zoom
   * while an unselected one grows with zoom. Restoring the old nesting would
   * fail the validator above; flattening the case away would fail this.
   */
  it("keeps a selected crash one size at every zoom, and grows the rest", () => {
    const radius = CRASH_CORE_CIRCLE_PAINT["circle-radius"] as unknown[];

    expect(radius[0]).toBe("interpolate");
    expect(radius[2]).toEqual(["zoom"]);

    const [lowZoom, lowValue, highZoom, highValue] = radius.slice(3) as [
      number,
      unknown[],
      number,
      unknown[],
    ];
    expect(lowZoom).toBe(5);
    expect(highZoom).toBe(11);
    // Selected output is identical at both stops; unselected is not.
    expect(lowValue[2]).toBe(highValue[2]);
    expect(lowValue[3]).not.toBe(highValue[3]);
    expect(Number(highValue[3])).toBeGreaterThan(Number(lowValue[3]));
  });
});
