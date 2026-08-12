/**
 * The one place a coordinate system's method becomes arithmetic.
 *
 * The switch is exhaustive over `CrsMethod` and deliberately has no `default`.
 * That is the whole safety property of this file: adding a method to the
 * registry's vocabulary without implementing it stops the build here, rather
 * than reaching a planner as a layer drawn in the wrong hemisphere. A `default`
 * branch that "passed the coordinates through" would be exactly the silent
 * failure this module exists to make impossible.
 */

import type { CrsMethod, CrsProjectionParams } from "../types";
import { aeaForward, aeaInverse } from "./aea";
import { lccForward, lccInverse } from "./lcc";
import { omercForward, omercInverse } from "./omerc";
import { tmercForward, tmercInverse } from "./tmerc";
import { webMercatorForward, webMercatorInverse } from "./webmerc";

/**
 * Projected coordinates, in the projection's own linear unit converted to
 * METRES, to longitude/latitude in degrees on the entry's own datum.
 *
 * The datum is not changed here. Nothing in this file knows about WGS 84; the
 * caller decides what to do about the datum and, in OpenPlan, discloses it.
 */
export function inverseProject(
  method: CrsMethod,
  x: number,
  y: number,
  params: CrsProjectionParams
): [number, number] {
  switch (method) {
    case "geographic":
      // Already longitude/latitude degrees, so this is the identity — EXCEPT on
      // a datum whose prime meridian is not Greenwich, where the file's
      // longitudes are measured from Rome, Paris or Ferro and `lon0` carries
      // the offset back to Greenwich. Eighteen systems in the registry are like
      // that; for every other entry `lon0` is absent and this is the identity a
      // shapefile on NAD83 geographic needs.
      return [x + (params.lon0 ?? 0), y];
    case "lambert_conformal_conic_1sp":
      return lccInverse(x, y, params, false);
    case "lambert_conformal_conic_2sp":
      return lccInverse(x, y, params, true);
    case "transverse_mercator":
      return tmercInverse(x, y, params);
    case "hotine_oblique_mercator":
      return omercInverse(x, y, params);
    case "albers_equal_area":
      return aeaInverse(x, y, params);
    case "pseudo_mercator":
      return webMercatorInverse(x, y, params);
  }
}

/**
 * The inverse of `inverseProject`, in metres.
 *
 * OpenPlan's import path never needs this — files come in projected and leave
 * in longitude/latitude. It exists so that `inverseProject` can be proved to
 * invert something: a round trip through both directions catches a transposed
 * constant that a one-way test would score as a plausible position.
 */
export function forwardProject(
  method: CrsMethod,
  longitude: number,
  latitude: number,
  params: CrsProjectionParams
): [number, number] {
  switch (method) {
    case "geographic":
      // Mirrors `inverseProject`: back onto the system's own prime meridian.
      return [longitude - (params.lon0 ?? 0), latitude];
    case "lambert_conformal_conic_1sp":
      return lccForward(longitude, latitude, params, false);
    case "lambert_conformal_conic_2sp":
      return lccForward(longitude, latitude, params, true);
    case "transverse_mercator":
      return tmercForward(longitude, latitude, params);
    case "hotine_oblique_mercator":
      return omercForward(longitude, latitude, params);
    case "albers_equal_area":
      return aeaForward(longitude, latitude, params);
    case "pseudo_mercator":
      return webMercatorForward(longitude, latitude, params);
  }
}
