/**
 * Popular Visualisation Pseudo-Mercator — "Web Mercator", EPSG:3857.
 *
 * EPSG method 1024. A spherical Mercator computed on the ellipsoid's semi-major
 * axis: the formula treats the Earth as a sphere of radius `a` while the
 * coordinates are nominally on WGS 84, which is why EPSG gives it a method of
 * its own rather than calling it Mercator. Positions differ from a true
 * ellipsoidal Mercator by up to ~20 km in northing at high latitudes, so it
 * must never be computed with the Mercator formulas.
 *
 * Present because a planner who exports a layer out of a web-mapping tool gets
 * this and nothing else, and being unable to read the most common web CRS in
 * the world would be an absurd gap.
 */

import type { CrsProjectionParams } from "../types";
import { DEG_TO_RAD, RAD_TO_DEG, longitudeDelta, normalizeLongitude, required } from "./shared";

/** Longitude/latitude in degrees from an easting/northing in metres. */
export function webMercatorInverse(
  easting: number,
  northing: number,
  params: CrsProjectionParams
): [number, number] {
  const a = params.a;
  const lon0 = required(params, "lon0") * DEG_TO_RAD;
  const x0 = required(params, "x0");
  const y0 = required(params, "y0");

  const lambda = (easting - x0) / a + lon0;
  const phi = Math.PI / 2 - 2 * Math.atan(Math.exp(-(northing - y0) / a));

  return [normalizeLongitude(lambda * RAD_TO_DEG), phi * RAD_TO_DEG];
}

/** Easting/northing in metres from a longitude/latitude in degrees. See `lccForward`. */
export function webMercatorForward(
  longitude: number,
  latitude: number,
  params: CrsProjectionParams
): [number, number] {
  const a = params.a;
  const lon0 = required(params, "lon0") * DEG_TO_RAD;
  const x0 = required(params, "x0");
  const y0 = required(params, "y0");

  return [
    x0 + a * longitudeDelta(longitude, lon0 * RAD_TO_DEG),
    y0 + a * Math.log(Math.tan(Math.PI / 4 + (latitude * DEG_TO_RAD) / 2)),
  ];
}
