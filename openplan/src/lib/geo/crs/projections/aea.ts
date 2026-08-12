/**
 * Albers Equal Area Conic.
 *
 * EPSG method 9822; Snyder 1987 chapter 14. Not a State Plane method — it is
 * how statewide and national analysis layers are published, because it
 * preserves area and therefore lets a planner sum acreage off the map without
 * a correction. California Albers (EPSG:3310), Florida GDL Albers, and the
 * USGS national Albers are all this method, and they are among the layers most
 * likely to arrive at a planning department from a state agency.
 */

import type { CrsProjectionParams } from "../types";
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  eccentricity,
  longitudeDelta,
  normalizeLongitude,
  parallelRadius,
  required,
} from "./shared";

/**
 * Snyder's `q`, the authalic-latitude term (eq. 3-12).
 *
 * The published form divides by the eccentricity, which is zero on a sphere.
 * The limit there is `2 sin φ`, and a few registry entries really are spherical,
 * so the branch is a correctness requirement rather than defensive padding.
 */
function authalicQ(phi: number, e: number): number {
  const sinPhi = Math.sin(phi);
  if (e < 1e-12) return 2 * sinPhi;
  const eSin = e * sinPhi;
  return (
    (1 - e * e) *
    (sinPhi / (1 - eSin * eSin) - (1 / (2 * e)) * Math.log((1 - eSin) / (1 + eSin)))
  );
}

type AeaConstants = {
  e: number;
  a: number;
  n: number;
  C: number;
  rho0: number;
  lon0: number;
  x0: number;
  y0: number;
};

function constants(params: CrsProjectionParams): AeaConstants {
  const e = eccentricity(params.invF);
  const a = params.a;
  const lat0 = required(params, "lat0") * DEG_TO_RAD;
  const lat1 = required(params, "lat1") * DEG_TO_RAD;
  const lat2 = required(params, "lat2") * DEG_TO_RAD;

  const m1 = parallelRadius(lat1, e);
  const m2 = parallelRadius(lat2, e);
  const q1 = authalicQ(lat1, e);
  const q2 = authalicQ(lat2, e);

  const n = Math.abs(lat1 - lat2) < 1e-12 ? Math.sin(lat1) : (m1 * m1 - m2 * m2) / (q2 - q1);
  const C = m1 * m1 + n * q1;
  const rho0 = (a * Math.sqrt(C - n * authalicQ(lat0, e))) / n;

  return {
    e,
    a,
    n,
    C,
    rho0,
    lon0: required(params, "lon0") * DEG_TO_RAD,
    x0: required(params, "x0"),
    y0: required(params, "y0"),
  };
}

/** Longitude/latitude in degrees from an easting/northing in metres. */
export function aeaInverse(
  easting: number,
  northing: number,
  params: CrsProjectionParams
): [number, number] {
  const { e, a, n, C, rho0, lon0, x0, y0 } = constants(params);

  const dx = easting - x0;
  const dy = rho0 - (northing - y0);
  const rho = Math.hypot(dx, dy);
  const theta = Math.atan2(Math.sign(n) * dx, Math.sign(n) * dy);

  const q = (C - (rho * rho * n * n) / (a * a)) / n;
  const lambda = lon0 + theta / n;

  // Snyder eq. 3-16: Newton iteration from the spherical authalic latitude.
  let phi = Math.asin(Math.max(-1, Math.min(1, q / 2)));
  if (e >= 1e-12) {
    for (let pass = 0; pass < 30; pass += 1) {
      const sinPhi = Math.sin(phi);
      const eSin = e * sinPhi;
      const factor = (1 - eSin * eSin) ** 2 / (2 * Math.cos(phi));
      const delta =
        factor *
        (q / (1 - e * e) -
          sinPhi / (1 - eSin * eSin) +
          (1 / (2 * e)) * Math.log((1 - eSin) / (1 + eSin)));
      phi += delta;
      if (Math.abs(delta) < 1e-13) break;
    }
  }

  return [normalizeLongitude(lambda * RAD_TO_DEG), phi * RAD_TO_DEG];
}

/** Easting/northing in metres from a longitude/latitude in degrees. See `lccForward`. */
export function aeaForward(
  longitude: number,
  latitude: number,
  params: CrsProjectionParams
): [number, number] {
  const { e, a, n, C, rho0, lon0, x0, y0 } = constants(params);
  const phi = latitude * DEG_TO_RAD;
  const rho = (a * Math.sqrt(C - n * authalicQ(phi, e))) / n;
  const theta = n * longitudeDelta(longitude, lon0 * RAD_TO_DEG);
  return [x0 + rho * Math.sin(theta), y0 + rho0 - rho * Math.cos(theta)];
}
