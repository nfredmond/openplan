/**
 * Hotine Oblique Mercator, variants A and B.
 *
 * EPSG methods 9812 (variant A) and 9815 (variant B); EPSG Guidance Note 7
 * part 2. A Mercator whose line of tangency is a great circle at an arbitrary
 * azimuth — the projection you need when a jurisdiction is long and diagonal,
 * which in the United States means the Alaska panhandle: Alaska zone 1 is the
 * only State Plane zone that is not Lambert or Transverse Mercator.
 *
 * THE TWO VARIANTS DIFFER ONLY IN WHERE THE FALSE ORIGIN SITS — variant A puts
 * the false easting and northing at the natural origin where the initial line
 * crosses the equator, variant B at the projection centre. For Alaska zone 1
 * that is a difference of hundreds of kilometres, and it is invisible in the
 * parameter values: both variants list "false easting" and a number. So the
 * variant is carried on the registry entry and read here, never inferred.
 */

import type { CrsProjectionParams } from "../types";
import { DEG_TO_RAD, RAD_TO_DEG, eccentricity, longitudeDelta, normalizeLongitude, required } from "./shared";

type OmercConstants = {
  e: number;
  B: number;
  A: number;
  H: number;
  gamma0: number;
  lambda0: number;
  gammaC: number;
  /** Signed offset along the initial line, zero for variant A. */
  uOffset: number;
  x0: number;
  y0: number;
};

function constants(params: CrsProjectionParams): OmercConstants {
  const e = eccentricity(params.invF);
  const e2 = e * e;
  const a = params.a;

  const latC = required(params, "lat0") * DEG_TO_RAD;
  const lonC = required(params, "lon0") * DEG_TO_RAD;
  const alphaC = required(params, "azimuth") * DEG_TO_RAD;
  const gammaC = required(params, "gamma") * DEG_TO_RAD;
  const kC = required(params, "k0");

  const sinLatC = Math.sin(latC);
  const cosLatC = Math.cos(latC);

  const B = Math.sqrt(1 + (e2 * cosLatC ** 4) / (1 - e2));
  const A = (a * B * kC * Math.sqrt(1 - e2)) / (1 - e2 * sinLatC * sinLatC);
  const tO =
    Math.tan(Math.PI / 4 - latC / 2) / Math.pow((1 - e * sinLatC) / (1 + e * sinLatC), e / 2);

  // D can fall marginally below 1 at the projection centre through rounding,
  // and (D²−1)^0.5 is then NaN rather than 0. EPSG states the clamp explicitly.
  const dRaw = (B * Math.sqrt(1 - e2)) / (cosLatC * Math.sqrt(1 - e2 * sinLatC * sinLatC));
  const d2 = Math.max(dRaw * dRaw, 1);
  const D = Math.sqrt(d2);

  const F = D + Math.sqrt(d2 - 1) * Math.sign(latC);
  const H = F * Math.pow(tO, B);
  const G = (F - 1 / F) / 2;
  const gamma0 = Math.asin(Math.sin(alphaC) / D);
  const lambda0 = lonC - Math.asin(G * Math.tan(gamma0)) / B;

  const variant = params.hotineVariant ?? "A";
  let uOffset = 0;
  if (variant === "B") {
    const uC =
      Math.abs(alphaC - Math.PI / 2) < 1e-12
        ? A * (lonC - lambda0)
        : (A / B) * Math.atan2(Math.sqrt(d2 - 1), Math.cos(alphaC)) * Math.sign(latC);
    uOffset = Math.abs(uC) * Math.sign(latC);
  }

  return {
    e,
    B,
    A,
    H,
    gamma0,
    lambda0,
    gammaC,
    uOffset,
    x0: required(params, "x0"),
    y0: required(params, "y0"),
  };
}

/**
 * Geodetic latitude from the conformal latitude, by series (Snyder eq. 3-5).
 * Used instead of an iteration because the series is exact to well below a
 * micrometre for every terrestrial eccentricity and has no convergence case.
 */
function latitudeFromConformal(chi: number, e: number): number {
  const e2 = e * e;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const e8 = e4 * e4;
  return (
    chi +
    Math.sin(2 * chi) * (e2 / 2 + (5 * e4) / 24 + e6 / 12 + (13 * e8) / 360) +
    Math.sin(4 * chi) * ((7 * e4) / 48 + (29 * e6) / 240 + (811 * e8) / 11520) +
    Math.sin(6 * chi) * ((7 * e6) / 120 + (81 * e8) / 1120) +
    Math.sin(8 * chi) * ((4279 * e8) / 161280)
  );
}

/** Longitude/latitude in degrees from an easting/northing in metres. */
export function omercInverse(
  easting: number,
  northing: number,
  params: CrsProjectionParams
): [number, number] {
  const { e, B, A, H, gamma0, lambda0, gammaC, uOffset, x0, y0 } = constants(params);

  const dE = easting - x0;
  const dN = northing - y0;
  const v = dE * Math.cos(gammaC) - dN * Math.sin(gammaC);
  const u = dN * Math.cos(gammaC) + dE * Math.sin(gammaC) + uOffset;

  const Q = Math.exp(-(B * v) / A);
  const S = (Q - 1 / Q) / 2;
  const T = (Q + 1 / Q) / 2;
  const V = Math.sin((B * u) / A);
  const U = (V * Math.cos(gamma0) + S * Math.sin(gamma0)) / T;
  const t = Math.pow(H / Math.sqrt((1 + U) / (1 - U)), 1 / B);

  const chi = Math.PI / 2 - 2 * Math.atan(t);
  const phi = latitudeFromConformal(chi, e);
  const lambda =
    lambda0 -
    Math.atan2(S * Math.cos(gamma0) - V * Math.sin(gamma0), Math.cos((B * u) / A)) / B;

  return [normalizeLongitude(lambda * RAD_TO_DEG), phi * RAD_TO_DEG];
}

/** Easting/northing in metres from a longitude/latitude in degrees. See `lccForward`. */
export function omercForward(
  longitude: number,
  latitude: number,
  params: CrsProjectionParams
): [number, number] {
  const { e, B, A, H, gamma0, lambda0, gammaC, uOffset, x0, y0 } = constants(params);
  const phi = latitude * DEG_TO_RAD;

  const sinPhi = Math.sin(phi);
  const t = Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - e * sinPhi) / (1 + e * sinPhi), e / 2);
  const Q = H / Math.pow(t, B);
  const S = (Q - 1 / Q) / 2;
  const T = (Q + 1 / Q) / 2;
  const deltaLambda = longitudeDelta(longitude, lambda0 * RAD_TO_DEG);
  const V = Math.sin(B * deltaLambda);
  const U = (-V * Math.cos(gamma0) + S * Math.sin(gamma0)) / T;

  const v = (A * Math.log((1 - U) / (1 + U))) / (2 * B);
  const u =
    (A * Math.atan2(S * Math.cos(gamma0) + V * Math.sin(gamma0), Math.cos(B * deltaLambda))) /
      B -
    uOffset;

  return [
    v * Math.cos(gammaC) + u * Math.sin(gammaC) + x0,
    u * Math.cos(gammaC) - v * Math.sin(gammaC) + y0,
  ];
}
