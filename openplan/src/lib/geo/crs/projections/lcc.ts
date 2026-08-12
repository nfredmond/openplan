/**
 * Lambert Conformal Conic, one and two standard parallels.
 *
 * EPSG methods 9801 (1SP) and 9802 (2SP); Snyder 1987 chapter 15. This is the
 * projection of most US State Plane zones that run east-to-west — California,
 * Ohio, Pennsylvania, Texas — and of most statewide Lambert systems.
 *
 * The two variants differ only in how the cone constant `n` and the scale
 * factor are obtained: from two standard parallels, or from one parallel and an
 * explicit scale factor. Everything after that is the same arithmetic, so they
 * share it rather than existing as two near-copies that can drift apart.
 */

import type { CrsProjectionParams } from "../types";
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  conformalT,
  eccentricity,
  latitudeFromConformalT,
  longitudeDelta,
  normalizeLongitude,
  parallelRadius,
  required,
} from "./shared";

type LccConstants = {
  n: number;
  aF: number;
  rho0: number;
  lon0: number;
  x0: number;
  y0: number;
  e: number;
};

function constants(params: CrsProjectionParams, twoParallels: boolean): LccConstants {
  const e = eccentricity(params.invF);
  const a = params.a;
  const lat0 = required(params, "lat0") * DEG_TO_RAD;
  const lon0 = required(params, "lon0") * DEG_TO_RAD;
  const x0 = required(params, "x0");
  const y0 = required(params, "y0");

  let n: number;
  let aF: number;

  if (twoParallels) {
    const lat1 = required(params, "lat1") * DEG_TO_RAD;
    const lat2 = required(params, "lat2") * DEG_TO_RAD;
    const m1 = parallelRadius(lat1, e);
    const m2 = parallelRadius(lat2, e);
    const t1 = conformalT(lat1, e);
    const t2 = conformalT(lat2, e);
    // Two standard parallels that coincide are a legal degenerate case — a few
    // EPSG entries state the same latitude twice — and the log ratio below is
    // 0/0 there. The limit is sin(lat1), which is the 1SP cone constant.
    n = Math.abs(lat1 - lat2) < 1e-12 ? Math.sin(lat1) : Math.log(m1 / m2) / Math.log(t1 / t2);
    aF = (a * m1) / (n * Math.pow(t1, n));
  } else {
    const k0 = required(params, "k0");
    const m0 = parallelRadius(lat0, e);
    const t0 = conformalT(lat0, e);
    n = Math.sin(lat0);
    aF = (a * m0 * k0) / (n * Math.pow(t0, n));
  }

  const rho0 = aF * Math.pow(conformalT(lat0, e), n);
  return { n, aF, rho0, lon0, x0, y0, e };
}

/** Longitude/latitude in degrees from an easting/northing in metres. */
export function lccInverse(
  easting: number,
  northing: number,
  params: CrsProjectionParams,
  twoParallels: boolean
): [number, number] {
  const { n, aF, rho0, lon0, x0, y0, e } = constants(params, twoParallels);

  const dx = easting - x0;
  const dy = rho0 - (northing - y0);
  // The sign of `n` is the sign of the hemisphere: for a southern-hemisphere
  // cone `rho` is negative, and taking the positive root there mirrors every
  // position across the central meridian.
  const rho = Math.sign(n) * Math.hypot(dx, dy);
  const theta = Math.atan2(Math.sign(n) * dx, Math.sign(n) * dy);

  // ρ AND aF, NOT |ρ| AND aF. In the southern hemisphere `n` is negative and so
  // is `aF`, so both of these are negative and their RATIO is positive — which
  // is what the fractional power needs. Using the absolute value of ρ against a
  // negative aF raises a negative number to a fractional power, and every
  // southern-hemisphere zone comes back as a NaN latitude with a perfectly
  // ordinary longitude beside it. That shape is worth remembering: the failure
  // was invisible to a sweep that compared errors with `> tolerance`, because
  // every comparison against NaN is false.
  const t = Math.pow(rho / aF, 1 / n);
  const phi = latitudeFromConformalT(t, e);
  const lambda = theta / n + lon0;

  return [normalizeLongitude(lambda * RAD_TO_DEG), phi * RAD_TO_DEG];
}

/**
 * Easting/northing in metres from a longitude/latitude in degrees.
 *
 * Present so the inverse can be proved to be an inverse. The import path only
 * ever goes projected → geographic; a round trip is the cheapest evidence that
 * the constants above are the constants the formula intends, and it fails
 * loudly when they are not.
 */
export function lccForward(
  longitude: number,
  latitude: number,
  params: CrsProjectionParams,
  twoParallels: boolean
): [number, number] {
  const { n, aF, rho0, lon0, x0, y0, e } = constants(params, twoParallels);
  const phi = latitude * DEG_TO_RAD;
  const rho = aF * Math.pow(conformalT(phi, e), n);
  const theta = n * longitudeDelta(longitude, (lon0 * RAD_TO_DEG));
  return [x0 + rho * Math.sin(theta), y0 + rho0 - rho * Math.cos(theta)];
}
