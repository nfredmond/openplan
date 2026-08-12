/**
 * Transverse Mercator.
 *
 * EPSG method 9807, using the Krüger series as published in EPSG Guidance
 * Note 7 part 2 (the "JHS" formulas) rather than Snyder's shorter series. The
 * choice matters: Snyder's expansion loses accuracy a few degrees from the
 * central meridian, and a UTM zone is six degrees wide. The series below holds
 * to well under a millimetre across a UTM zone, which is far below anything a
 * planning geometry can express.
 *
 * This is the method behind every UTM zone and behind the north–south US State
 * Plane zones — most of the eastern seaboard, Illinois, Indiana, Arizona,
 * Idaho, and the Wisconsin and Minnesota county coordinate systems that county
 * GIS shops actually publish in.
 */

import type { CrsProjectionParams } from "../types";
import { DEG_TO_RAD, RAD_TO_DEG, eccentricity, longitudeDelta, normalizeLongitude, required } from "./shared";

type TmercConstants = {
  e: number;
  B: number;
  m0: number;
  lon0: number;
  k0: number;
  x0: number;
  y0: number;
  h: [number, number, number, number];
  hInv: [number, number, number, number];
};

/** The isometric-latitude term the series is built on. */
function isometric(phi: number, e: number): number {
  return Math.asinh(Math.tan(phi)) - e * Math.atanh(e * Math.sin(phi));
}

function constants(params: CrsProjectionParams): TmercConstants {
  const e = eccentricity(params.invF);
  const f = 1 / params.invF;
  const n = f / (2 - f);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;

  const B = (params.a / (1 + n)) * (1 + n2 / 4 + n4 / 64);

  const h: [number, number, number, number] = [
    n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4,
    (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4,
    (61 / 240) * n3 - (103 / 140) * n4,
    (49561 / 161280) * n4,
  ];

  const hInv: [number, number, number, number] = [
    n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4,
    (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4,
    (17 / 480) * n3 - (37 / 840) * n4,
    (4397 / 161280) * n4,
  ];

  const lat0 = required(params, "lat0") * DEG_TO_RAD;
  let m0 = 0;
  if (Math.abs(lat0) > 1e-12) {
    if (Math.abs(Math.abs(lat0) - Math.PI / 2) < 1e-12) {
      m0 = Math.sign(lat0) * B * (Math.PI / 2);
    } else {
      const beta0 = Math.atan(Math.sinh(isometric(lat0, e)));
      const xi0 = Math.asin(Math.sin(beta0));
      const xi =
        xi0 +
        h[0] * Math.sin(2 * xi0) +
        h[1] * Math.sin(4 * xi0) +
        h[2] * Math.sin(6 * xi0) +
        h[3] * Math.sin(8 * xi0);
      m0 = B * xi;
    }
  }

  return {
    e,
    B,
    m0,
    lon0: required(params, "lon0") * DEG_TO_RAD,
    k0: required(params, "k0"),
    x0: required(params, "x0"),
    y0: required(params, "y0"),
    h,
    hInv,
  };
}

/** Longitude/latitude in degrees from an easting/northing in metres. */
export function tmercInverse(
  easting: number,
  northing: number,
  params: CrsProjectionParams
): [number, number] {
  const { e, B, m0, lon0, k0, x0, y0, hInv } = constants(params);

  const eta = (easting - x0) / (B * k0);
  const xi = (northing - y0 + k0 * m0) / (B * k0);

  let xi0 = xi;
  let eta0 = eta;
  for (let term = 0; term < 4; term += 1) {
    const k = 2 * (term + 1);
    xi0 -= hInv[term] * Math.sin(k * xi) * Math.cosh(k * eta);
    eta0 -= hInv[term] * Math.cos(k * xi) * Math.sinh(k * eta);
  }

  const beta = Math.asin(Math.sin(xi0) / Math.cosh(eta0));
  const qPrime = Math.asinh(Math.tan(beta));

  // The isometric latitude has no closed inverse on an ellipsoid; this is the
  // standard fixed-point iteration and converges in three or four passes.
  let q = qPrime;
  for (let pass = 0; pass < 30; pass += 1) {
    const next = qPrime + e * Math.atanh(e * Math.tanh(q));
    if (Math.abs(next - q) < 1e-14) {
      q = next;
      break;
    }
    q = next;
  }

  const phi = Math.atan(Math.sinh(q));
  const lambda = lon0 + Math.asin(Math.tanh(eta0) / Math.cos(beta));

  return [normalizeLongitude(lambda * RAD_TO_DEG), phi * RAD_TO_DEG];
}

/** Easting/northing in metres from a longitude/latitude in degrees. See `lccForward`. */
export function tmercForward(
  longitude: number,
  latitude: number,
  params: CrsProjectionParams
): [number, number] {
  const { e, B, m0, lon0, k0, x0, y0, h } = constants(params);
  const phi = latitude * DEG_TO_RAD;

  const beta = Math.atan(Math.sinh(isometric(phi, e)));
  const eta0 = Math.atanh(Math.cos(beta) * Math.sin(longitudeDelta(longitude, lon0 * RAD_TO_DEG)));
  const xi0 = Math.asin(Math.sin(beta) * Math.cosh(eta0));

  let xi = xi0;
  let eta = eta0;
  for (let term = 0; term < 4; term += 1) {
    const k = 2 * (term + 1);
    xi += h[term] * Math.sin(k * xi0) * Math.cosh(k * eta0);
    eta += h[term] * Math.cos(k * xi0) * Math.sinh(k * eta0);
  }

  return [x0 + k0 * B * eta, y0 + k0 * (B * xi - m0)];
}
