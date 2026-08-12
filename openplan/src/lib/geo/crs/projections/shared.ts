/**
 * Shared ellipsoidal helpers for the projection methods.
 *
 * Everything here is a published formula, and every one of them is verified in
 * `src/test/a-projected-shapefile-lands-inside-its-area-of-use.test.ts` against
 * control points produced by PROJ itself — not against numbers written by hand,
 * which is the failure mode this whole module is built to avoid.
 */

import type { CrsProjectionParams } from "../types";

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * First eccentricity of the ellipsoid, from its inverse flattening.
 *
 * `invF` is `Infinity` for a sphere, for which `f` is 0 and `e` is 0. Written
 * as a division rather than a branch so that a sphere falls out of the same
 * arithmetic instead of needing a special case somebody can forget.
 */
export function eccentricity(invF: number): number {
  const f = 1 / invF;
  return Math.sqrt(2 * f - f * f);
}

/**
 * Read a parameter that the caller's method requires.
 *
 * A missing projection parameter must never default to zero. A false easting
 * silently read as 0 instead of 2,000,000 metres puts every shape two thousand
 * kilometres west, and nothing downstream can tell that from a real position.
 * So the absence throws, the registry generator refuses to emit an entry whose
 * method lacks a parameter it needs, and
 * `every-crs-entry-has-an-implemented-method.test.ts` proves that of the whole
 * shipped registry.
 */
export function required(params: CrsProjectionParams, key: keyof CrsProjectionParams): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`coordinate system is missing the projection parameter "${key}"`);
  }
  return value;
}

/**
 * Snyder's `t`: the isometric-latitude term shared by every conformal method
 * here (Snyder 1987, eq. 15-9).
 */
export function conformalT(phi: number, e: number): number {
  const sinPhi = Math.sin(phi);
  const eSin = e * sinPhi;
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - eSin) / (1 + eSin), e / 2);
}

/**
 * Snyder's `m`: the radius of the parallel of latitude (Snyder 1987, eq. 14-15).
 */
export function parallelRadius(phi: number, e: number): number {
  const sinPhi = Math.sin(phi);
  return Math.cos(phi) / Math.sqrt(1 - e * e * sinPhi * sinPhi);
}

/**
 * Invert Snyder's `t` back to a geodetic latitude (Snyder 1987, eq. 3-4).
 *
 * The series has no closed form, so this iterates. It converges in three or
 * four passes for every terrestrial eccentricity; the iteration cap exists only
 * so that a corrupt ellipsoid cannot hang an import, and it is far above what
 * convergence needs.
 */
export function latitudeFromConformalT(t: number, e: number): number {
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let pass = 0; pass < 30; pass += 1) {
    const eSin = e * Math.sin(phi);
    const next = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - eSin) / (1 + eSin), e / 2));
    if (Math.abs(next - phi) < 1e-12) return next;
    phi = next;
  }
  return phi;
}

/**
 * Fold a longitude in degrees into (-180, 180].
 *
 * Every inverse projection here adds the central meridian back to an angle it
 * derived from an arctangent, so a zone whose central meridian is near the
 * antimeridian — the western Aleutians — can produce 190°E, which is a real
 * position that no GeoJSON reader will accept.
 */
export function normalizeLongitude(degrees: number): number {
  if (degrees > -180 && degrees <= 180) return degrees;
  const folded = ((degrees + 180) % 360 + 360) % 360 - 180;
  return folded === -180 ? 180 : folded;
}

/**
 * The signed difference between a longitude and a central meridian, folded into
 * (-180, 180].
 *
 * REQUIRED, NOT DEFENSIVE. A conic projection's forward direction computes
 * `theta = n * (lambda - lambda0)`, and the Aleutian State Plane zones sit at
 * about 176 degrees EAST of Greenwich with a central meridian at 154 degrees
 * WEST. The raw difference is 330 degrees; multiplied by the cone constant it
 * produces an easting several million metres from anything real, and the
 * inverse — which folds its own output — brings the point back at 84 degrees
 * east, in Kazakhstan. Alaska is not an edge case; it is a state, and rule one
 * of this product is that it works for anyone in the United States.
 */
export function longitudeDelta(longitude: number, centralMeridian: number): number {
  return normalizeLongitude(longitude - centralMeridian) * DEG_TO_RAD;
}
