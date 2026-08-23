/**
 * Generate `src/lib/geo/crs/crs-registry.generated.ts` from PROJ's `proj.db`.
 *
 *   npx tsx scripts/generate-crs-registry.ts            # writes the registry
 *   PROJ_DB=/path/to/proj.db npx tsx scripts/generate-crs-registry.ts
 *
 * ═══ WHY A GENERATOR ═══
 *
 * A hand-curated list of coordinate systems is wrong on the day it is written:
 * SPCS 83 alone has well over a hundred zones, each of which exists in EPSG in
 * several unit and realization flavours, and that is before the UTM zones, the
 * statewide Albers and Lambert systems, and the Wisconsin, Minnesota and
 * Kentucky COUNTY coordinate systems that county GIS shops actually publish in.
 * Whoever curated it would omit exactly the one a given planner needs.
 *
 * A full EPSG dump is also wrong: most of it is methods OpenPlan does not
 * implement, and an entry whose method is unimplemented is a promise that
 * breaks at the worst moment.
 *
 * So this reads the authoritative database and emits every CRS whose method IS
 * implemented and whose area of use is known — no more, no less. Regenerating
 * after a PROJ upgrade is the whole maintenance story, and
 * `crs-registry-is-generated-and-complete.test.ts` asserts the entry count as an
 * EQUALITY so a regeneration that silently drops half the country fails loudly
 * rather than shrinking the world OpenPlan works in.
 *
 * ═══ LICENCE — CHECKED 2026-08-12, AND WHY IT IS SETTLED ═══
 *
 * PROJ itself is MIT (see the copyright file in the distribution's libproj
 * package — on Debian and Ubuntu, /usr/share/doc/libproj25). The CONTENT of
 * proj.db is largely derived from the EPSG Geodetic Parameter Dataset, which is
 * owned by IOGP and carries its own terms of use. Those terms permit extracting
 * a subset and redistributing it, including inside a software package, on three
 * conditions that this generator and its output satisfy:
 *
 *   1. Recipients must be informed of the terms and of IOGP's ownership — the
 *      emitted file carries `EPSG_ATTRIBUTION` as a header comment, and
 *      `crs-registry-is-generated-and-complete.test.ts` fails if it is absent.
 *   2. Commerciality may not be ascribed to the dataset — OpenPlan is free and
 *      open source and charges for nothing, so there is no commerciality at all.
 *   3. Modified values may not be attributed to EPSG. This generator converts
 *      units (sexagesimal degrees to decimal, feet to metres) — permitted,
 *      because those preserve numeric equivalence in the geodetic calculation —
 *      and changes no parameter's meaning.
 *
 * VERIFICATION CAVEAT, RECORDED HONESTLY: epsg.org returned HTTP 403 to an
 * automated fetch, so the terms were read from GeoTools' bundled verbatim copy
 * (`geotools/licenses/EPSG.md`) and IOGP's own summary, not from the primary
 * document directly. Before OpenPlan is distributed anywhere that matters
 * commercially, someone should read the primary text at https://epsg.org/terms-of-use.html
 * in a browser and confirm nothing above has changed.
 */

import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { inverseProject } from "../src/lib/geo/crs/projections";
import type { CrsMethod, CrsProjectionParams } from "../src/lib/geo/crs/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, "../src/lib/geo/crs/crs-registry.generated.ts");
const CONTROL_POINTS_OUTPUT = resolve(HERE, "../src/test/fixtures/crs-control-points.json");
const PROJ_DB = process.env.PROJ_DB ?? "/usr/share/proj/proj.db";

const EPSG_ATTRIBUTION = [
  "This registry is derived from the EPSG Geodetic Parameter Dataset via PROJ's proj.db.",
  "The EPSG Dataset is owned by the International Association of Oil and Gas Producers (IOGP)",
  "and that ownership is hereby acknowledged. It is used here under the EPSG Terms of Use",
  "(https://epsg.org/terms-of-use.html), which permit extraction of a subset and redistribution",
  "provided recipients are informed of those terms. Units have been converted (sexagesimal to",
  "decimal degrees, feet to metres) preserving numeric equivalence; no parameter's meaning is",
  "changed. Entries additionally sourced from Esri's projection engine definitions carry the",
  "ESRI authority. The dataset is provided AS IS, without warranty of any kind.",
];

/**
 * EPSG's method names, mapped onto the methods OpenPlan implements.
 *
 * A method absent from this map means every CRS using it is excluded from the
 * registry — which is the honest outcome, because the alternative is an entry
 * that resolves and then reprojects with the wrong formula. Adding a method
 * here without adding it to `projections/index.ts` does not compile.
 */
const METHODS: Record<string, { method: CrsMethod; hotineVariant?: "A" | "B" }> = {
  "Lambert Conic Conformal (1SP)": { method: "lambert_conformal_conic_1sp" },
  "Lambert Conic Conformal (2SP)": { method: "lambert_conformal_conic_2sp" },
  "Transverse Mercator": { method: "transverse_mercator" },
  "Albers Equal Area": { method: "albers_equal_area" },
  "Popular Visualisation Pseudo Mercator": { method: "pseudo_mercator" },
  "Hotine Oblique Mercator (variant A)": { method: "hotine_oblique_mercator", hotineVariant: "A" },
  "Hotine Oblique Mercator (variant B)": { method: "hotine_oblique_mercator", hotineVariant: "B" },
};

/**
 * Where each EPSG parameter name lands in `CrsProjectionParams`.
 *
 * Keyed by the parameter's NAME rather than by its position, because the
 * position varies between methods and a positional read that drifts by one slot
 * swaps a false easting for a scale factor without any type error.
 */
const PARAMETER_SLOTS: Record<string, "lat0" | "lon0" | "lat1" | "lat2" | "k0" | "x0" | "y0" | "azimuth" | "gamma"> = {
  "Latitude of natural origin": "lat0",
  "Longitude of natural origin": "lon0",
  "Latitude of false origin": "lat0",
  "Longitude of false origin": "lon0",
  "Latitude of projection centre": "lat0",
  "Longitude of projection centre": "lon0",
  "Latitude of 1st standard parallel": "lat1",
  "Latitude of 2nd standard parallel": "lat2",
  "Scale factor at natural origin": "k0",
  "Scale factor on initial line": "k0",
  "Scale factor at projection centre": "k0",
  "False easting": "x0",
  "False northing": "y0",
  "Easting at false origin": "x0",
  "Northing at false origin": "y0",
  "Easting at projection centre": "x0",
  "Northing at projection centre": "y0",
  "Azimuth at projection centre": "azimuth",
  "Azimuth of initial line": "azimuth",
  "Angle from Rectified to Skew Grid": "gamma",
};

/** Which parameters each method cannot be computed without. */
const REQUIRED_BY_METHOD: Record<CrsMethod, string[]> = {
  geographic: [],
  lambert_conformal_conic_1sp: ["lat0", "lon0", "k0", "x0", "y0"],
  lambert_conformal_conic_2sp: ["lat0", "lon0", "lat1", "lat2", "x0", "y0"],
  transverse_mercator: ["lat0", "lon0", "k0", "x0", "y0"],
  hotine_oblique_mercator: ["lat0", "lon0", "azimuth", "gamma", "k0", "x0", "y0"],
  albers_equal_area: ["lat0", "lon0", "lat1", "lat2", "x0", "y0"],
  pseudo_mercator: ["lon0", "x0", "y0"],
};

/**
 * Above this many metres, reading a datum's coordinates as WGS 84 is something
 * a planner has to be told about and acknowledge.
 *
 * Five metres is chosen against the thing OpenPlan draws: a layer is placed
 * over aerial imagery and street centrelines, and a five-metre shift is a
 * lane's width — visible, and enough to put a parcel line on the wrong side of
 * a fence. Below it sits the NAD83/WGS 84 difference (one to two metres), which
 * is disclosed but not gated, because gating it would put an acknowledgement in
 * front of essentially every American shapefile and train planners to click
 * through the one that matters.
 */
const DATUM_ACKNOWLEDGEMENT_METRES = 5;

// ── Unit conversion ──────────────────────────────────────────────────────────

/**
 * EPSG unit-of-measure 9110, "sexagesimal DMS", to decimal degrees.
 *
 * THE LITERAL `38.5` IN THIS ENCODING MEANS 38°50′00″, NOT 38.5 DEGREES. That
 * is a difference of twenty kilometres on the ground, and EPSG uses this
 * encoding for the origin latitude of most US State Plane zones — so reading it
 * as decimal degrees would place essentially every State Plane layer in the
 * country wrongly, consistently, and plausibly.
 *
 * Parsed from the DECIMAL STRING rather than by arithmetic on the double.
 * `Math.floor((45.1833 - 45) * 100)` is 17, not 18, because the subtraction
 * lands at 18.329999999999984 — and the minute lost that way becomes an error
 * of about a kilometre. The digits are unambiguous; the arithmetic is not.
 */
export function sexagesimalToDegrees(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const text = Math.abs(value).toFixed(10);
  const [wholeText, fractionText = ""] = text.split(".");
  const degrees = Number(wholeText);
  const minutes = Number(fractionText.slice(0, 2).padEnd(2, "0"));
  const secondsDigits = fractionText.slice(2);
  const seconds = secondsDigits
    ? Number(`${secondsDigits.slice(0, 2).padEnd(2, "0")}.${secondsDigits.slice(2) || "0"}`)
    : 0;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

type Uom = { name: string; type: string; factor: number | null };

function normalizeParameter(value: number, uom: Uom | undefined, slot: string): number | null {
  if (!uom) return null;
  if (slot === "k0") return uom.type === "scale" && uom.factor !== null ? value * uom.factor : null;
  if (slot === "x0" || slot === "y0") {
    return uom.type === "length" && uom.factor !== null ? value * uom.factor : null;
  }
  // Angles.
  if (uom.type !== "angle") return null;
  if (uom.name === "sexagesimal DMS") return sexagesimalToDegrees(value);
  if (uom.factor === null) return null;
  return (value * uom.factor * 180) / Math.PI;
}

/**
 * A datum's prime meridian, in degrees EAST OF GREENWICH.
 *
 * ═══ THE BUG THIS EXISTS TO CLOSE ═══
 *
 * EPSG states a projection's longitude of origin relative to the prime meridian
 * OF ITS OWN DATUM. Almost always that is Greenwich and the distinction never
 * comes up. For 34 projected and 18 geographic systems here it is not: the NTF
 * (Paris), MGI (Ferro), NGO 1948 (Oslo), Lisbon, Madrid, Brussels and ATF
 * (Paris RGS) families measure longitude from their own national meridian.
 *
 * EPSG:27571, NTF (Paris) / Lambert zone I, declares a longitude of origin of
 * exactly 0 — the Paris meridian, 2.337229° east of Greenwich. Emitted as 0 and
 * read downstream as Greenwich, it placed real Paris 171.4 km west of itself,
 * in the English Channel. The registry's own area-of-use check passed it,
 * because 171 km west of Paris is still inside France.
 *
 * So the meridian is FOLDED INTO `lon0` here, once, at generation time — the
 * same treatment sexagesimal degrees get, for the same reason. Every projection
 * method OpenPlan implements takes exactly one longitude of origin, so adding
 * the offset to it is not an approximation of the correct transformation; it IS
 * the correct transformation. A geographic system has no projection, so there
 * `lon0` is the offset itself and `inverseProject` applies it.
 *
 * Returns null when the meridian's unit cannot be converted, which is a skip
 * rather than an assumption of Greenwich — see the call sites.
 */
function primeMeridianDegrees(row: Row, uoms: Map<string, Uom>): number | null {
  const value = row.pm_value as number | null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value === 0) return 0;
  const uom = uoms.get(`${row.pm_uom_auth}:${row.pm_uom_code}`);
  // Reuses the parameter converter, so "sexagesimal DMS" (Ferro is -17.4,
  // meaning 17°40′ W, not 17.4°) and grads (Paris is 2.5969213 grad) are
  // handled by the code that is already tested for exactly those encodings.
  const degrees = normalizeParameter(value, uom, "lon0");
  return degrees !== null && Number.isFinite(degrees) ? degrees : null;
}

// ── Datum shift, measured with PROJ rather than estimated ────────────────────

type DatumShift = { metres: number | null };

/**
 * How far treating this CRS's own longitude/latitude as WGS 84 moves a point.
 *
 * MEASURED, NOT ASSUMED. OpenPlan ships no NADCON or NTv2 grids and applies no
 * Helmert transformation: a shapefile on NAD27 is reprojected to NAD27
 * longitude/latitude and then drawn as though it were WGS 84. That is a real
 * positional error, it is large in the western United States, and a planner has
 * to be told its size — which means having its size, from the authority, rather
 * than from a round number somebody remembered.
 *
 * A datum for which PROJ offers only a "Ballpark geographic offset" has NO
 * published transformation at all, so the magnitude is unknown. Unknown is
 * returned as null and treated downstream as worse than large, never as zero:
 * measuring 0 metres through a null transformation and reporting "no shift"
 * would be the exact silent lie this file exists to prevent.
 */
function measureDatumShift(geographicCrs: string, samples: [number, number][]): DatumShift {
  let summary: string;
  try {
    summary = execFileSync(
      "projinfo",
      ["-s", geographicCrs, "-t", "EPSG:4326", "--summary", "--spatial-test", "intersects"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    return { metres: null };
  }

  // projinfo prints a "Candidate operations found: N" header and then one line
  // per operation. The lines are NOT all prefixed "EPSG:" — a transformation
  // reached through a datum's parent appears as `DERIVED_FROM(EPSG):1946, …`
  // and a reversed one as `INVERSE(PROJ):…`. Filtering on "EPSG:" therefore
  // reported "no transformation exists" for every WGS 84 realization and for
  // NAD83(CSRS96), which would have put a scary unknown-shift acknowledgement
  // in front of correct, sub-metre data. So the lines after the header are
  // taken as they come, and only the word Ballpark disqualifies them.
  const lines = summary.split("\n").map((line) => line.trim());
  const headerAt = lines.findIndex((line) => /^Candidate operations found:/i.test(line));
  const operations = (headerAt === -1 ? [] : lines.slice(headerAt + 1)).filter((line) => line.length > 0);
  if (operations.length === 0) return { metres: null };
  if (operations.every((line) => /Ballpark/i.test(line))) return { metres: null };

  let worst = 0;
  for (const [lon, lat] of samples) {
    let output: string;
    try {
      output = execFileSync("cs2cs", [geographicCrs, "EPSG:4326", "-f", "%.9f"], {
        input: `${lat} ${lon}\n`,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      return { metres: null };
    }
    const [outLat, outLon] = output.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(outLat) || !Number.isFinite(outLon)) return { metres: null };
    const dLat = (outLat - lat) * 111_320;
    const dLon = (outLon - lon) * 111_320 * Math.cos((lat * Math.PI) / 180);
    worst = Math.max(worst, Math.hypot(dLat, dLon));
  }
  return { metres: Math.round(worst * 10) / 10 };
}

function samplePoints(west: number, south: number, east: number, north: number): [number, number][] {
  const midLon = west <= east ? (west + east) / 2 : west;
  return [
    [midLon, (south + north) / 2],
    [west, south],
    [east, south],
    [west, north],
    [east, north],
  ];
}

// ── The query ────────────────────────────────────────────────────────────────

type Row = {
  auth_name: string;
  code: string;
  name: string;
  method_name: string | null;
  datum_name: string;
  datum_auth: string;
  datum_code: string;
  geodetic_auth: string;
  geodetic_code: string;
  /** The datum's prime meridian, in `pm_uom_*`'s unit — NOT necessarily degrees. */
  pm_name: string;
  pm_value: number | null;
  pm_uom_auth: string | null;
  pm_uom_code: string | null;
  a: number;
  inv_flattening: number | null;
  semi_minor_axis: number | null;
  ellipsoid_uom: string;
  axis_uom_name: string;
  axis_uom_factor: number | null;
  axis_uom_type: string;
  south_lat: number;
  north_lat: number;
  west_lon: number;
  east_lon: number;
  extent_name: string;
  [param: string]: unknown;
};

type Entry = {
  authority: string;
  code: string;
  name: string;
  unit: string;
  kind: "geographic" | "projected";
  datum: string;
  datumKey: string;
  geodeticCrs: string;
  requiresDatumAcknowledgement: boolean;
  datumShiftNote: string | null;
  datumShiftMetres: number | null;
  unitToMetres: number;
  method: CrsMethod;
  params: Record<string, number | string>;
  areaOfUse: { west: number; south: number; east: number; north: number; description: string };
  aliases: string[];
};

function ellipsoidAxes(row: Row): { a: number; invF: number } | null {
  // proj.db records the semi-major axis in the ellipsoid's own unit; every
  // terrestrial ellipsoid here is in metres, but a unit that is not metres
  // would silently scale the whole planet, so it is checked rather than assumed.
  if (row.ellipsoid_uom !== "metre") return null;
  if (row.inv_flattening !== null && row.inv_flattening > 0) {
    return { a: row.a, invF: row.inv_flattening };
  }
  if (row.semi_minor_axis !== null && row.semi_minor_axis > 0) {
    if (row.semi_minor_axis === row.a) return { a: row.a, invF: Infinity };
    return { a: row.a, invF: row.a / (row.a - row.semi_minor_axis) };
  }
  return null;
}

function roundParam(value: number): number {
  // Twelve significant figures: below the precision EPSG publishes and far
  // below anything that moves a coordinate by a measurable distance, but enough
  // to keep the emitted file from carrying float noise like 2000000.0000000005.
  return Number(value.toPrecision(12));
}

/** Metres per degree of latitude, for turning an angular error into a distance. */
const METRES_PER_DEGREE = 111_320;

/**
 * How far OpenPlan's inverse projection may differ from PROJ's before an entry
 * is refused a place in the registry.
 *
 * A millimetre. The observed worst disagreement across every entry that passes
 * is around a tenth of that, so this is not a tuned threshold hiding a
 * population of near-misses — it is a bright line with nothing near it, and
 * anything that fails it fails by kilometres.
 */
const PROJ_AGREEMENT_TOLERANCE_METRES = 0.001;

/** The projected CRS's base geographic CRS, so a check isolates the projection. */
let baseOf = new Map<string, string>();
/** Projected CRSs that declare northing before easting; cs2cs honours that. */
let northFirst = new Set<string>();

type ProjCheck =
  | { ok: true; control: { crs: string; x: number; y: number; lon: number; lat: number } | null }
  | { ok: false; why: string };

/**
 * The base geographic CRS as PROJ defines it, FORCED ONTO GREENWICH.
 *
 * ═══ WHY THE CHECK COULD NOT SEE ITS OWN WORST BUG ═══
 *
 * The verification used to round-trip through the projected CRS's own base
 * geographic CRS: Greenwich in, Greenwich out, for almost everything. But for
 * the 34 systems on a Paris, Ferro, Oslo, Lisbon, Madrid or Brussels meridian
 * that base's longitudes are measured from that same national meridian — so
 * the ground truth carried exactly the same offset the registry had dropped,
 * and the two errors cancelled to within a tenth of a millimetre. The check was
 * thorough, ran on every entry, and was structurally incapable of failing for
 * the one defect that put a French layer in the English Channel.
 *
 * A check may not share a frame of reference with the thing it is checking. So
 * the ground truth is now anchored to GREENWICH, which is the frame every
 * consumer of this registry actually uses. Taken from PROJ's own rendering of
 * the base CRS rather than from the ellipsoid this generator read, so a
 * misread ellipsoid cannot cancel either; `+pm` is stripped to move the
 * meridian, and `+towgs84` with it so that no datum shift creeps into a check
 * whose whole purpose is to isolate the projection.
 *
 * Cached: there are a few hundred distinct base CRSs behind six thousand
 * entries, and this shells out.
 */
const greenwichBaseCache = new Map<string, string[] | null>();

function greenwichBaseTokens(base: string): string[] | null {
  const cached = greenwichBaseCache.get(base);
  if (cached !== undefined) return cached;

  let tokens: string[] | null = null;
  try {
    const rendered = execFileSync("projinfo", ["-o", "PROJ", "-q", base], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = rendered
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate.startsWith("+proj=longlat"));
    if (line) {
      const stripped = line
        .split(/\s+/)
        .filter(
          (token) =>
            !token.startsWith("+pm=") && !token.startsWith("+towgs84=") && token !== "+type=crs"
        );
      // A rendering that lost its ellipsoid is not a usable reference frame.
      if (stripped.some((token) => token.startsWith("+ellps=") || token.startsWith("+datum=") || token.startsWith("+a="))) {
        tokens = stripped;
      }
    }
  } catch {
    tokens = null;
  }

  greenwichBaseCache.set(base, tokens);
  return tokens;
}

function verifyAgainstProj(entry: Entry, swap: boolean): ProjCheck {
  const key = `${entry.authority}:${entry.code}`;
  const base = baseOf.get(key);
  if (!base) return { ok: false, why: "no base geographic CRS" };
  const greenwichBase = greenwichBaseTokens(base);
  if (!greenwichBase) return { ok: false, why: "no Greenwich-referenced base CRS" };

  const area = entry.areaOfUse;
  // An area of use that wraps the antimeridian cannot be sampled by linear
  // interpolation between west and east. Rather than skip the check — which
  // would let an unverified entry ship — the sample is taken from the eastern
  // half alone, which is inside the area either way.
  //
  // A LOCAL VALUE, NEVER A MUTATION. This used to assign `area.east = 180`, and
  // `area` IS `entry.areaOfUse` — the object that gets emitted. So a sampling
  // convenience silently rewrote the shipped registry: every wrapped area of
  // use lost its whole eastern half, and the registry went out with none at
  // all. For NAD83 / Alaska Albers that meant a declared extent of 172.42°E to
  // 180° — the Aleutian tail without the mainland — so `checkCrsPlacement`
  // refused statewide Alaska data as outside the area its own coordinate system
  // covers. `contains()` in area-of-use.ts was written for wrapped ranges and
  // had nothing to read.
  const sampleEast = area.west > area.east ? 180 : area.east;
  const points: [number, number][] = [];
  for (const u of [0.3, 0.5, 0.7]) {
    for (const v of [0.3, 0.5, 0.7]) {
      points.push([area.west + (sampleEast - area.west) * u, area.south + (area.north - area.south) * v]);
    }
  }

  let projected: number[][];
  let geographic: number[][];
  try {
    // Longitude first: a `+proj=longlat` reference frame is x/y ordered, unlike
    // the EPSG geographic code this used to pass, which is latitude first.
    const forward = execFileSync("cs2cs", [...greenwichBase, "+to", key, "-f", "%.6f"], {
      input: `${points.map(([lon, lat]) => `${lon} ${lat}`).join("\n")}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    projected = forward
      .trim()
      .split("\n")
      .map((line) => {
        const [first, second] = line.trim().split(/\s+/).map(Number);
        return swap ? [second, first] : [first, second];
      });

    const backward = execFileSync("cs2cs", [key, "+to", ...greenwichBase, "-f", "%.9f"], {
      input: `${projected.map(([x, y]) => (swap ? `${y} ${x}` : `${x} ${y}`)).join("\n")}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    geographic = backward
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
  } catch {
    return { ok: false, why: "cs2cs could not convert it" };
  }

  const params = entry.params as unknown as CrsProjectionParams;
  let control: { crs: string; x: number; y: number; lon: number; lat: number } | null = null;
  let compared = 0;

  for (let index = 0; index < projected.length; index += 1) {
    const [x, y] = projected[index] ?? [];
    // Longitude first, matching the reference frame above.
    const [projLon, projLat] = geographic[index] ?? [];
    if (![x, y, projLat, projLon].every((value) => typeof value === "number" && Number.isFinite(value))) {
      continue;
    }
    let ours: [number, number];
    try {
      ours = inverseProject(entry.method, x * entry.unitToMetres, y * entry.unitToMetres, params);
    } catch (error) {
      return { ok: false, why: `threw: ${(error as Error).message}` };
    }
    // NEGATED RATHER THAN COMPARED DIRECTLY. `error > tolerance` is FALSE when
    // error is NaN, which is exactly the value a broken projection produces —
    // so the obvious spelling of this check passes precisely the entries it
    // exists to catch. That mistake shipped once already; see the header above.
    const error =
      Math.hypot((ours[0] - projLon) * Math.cos((projLat * Math.PI) / 180), ours[1] - projLat) *
      METRES_PER_DEGREE;
    if (!(error < PROJ_AGREEMENT_TOLERANCE_METRES)) {
      return { ok: false, why: Number.isNaN(error) ? "produced NaN" : `off by ${error.toPrecision(3)} m` };
    }
    compared += 1;
    if (index === 4) control = { crs: key, x, y, lon: projLon, lat: projLat };
  }

  if (compared === 0) return { ok: false, why: "no point in its area of use could be checked" };
  return { ok: true, control };
}

function main(): void {
  const db = new Database(PROJ_DB, { readonly: true });
  const projVersion = (db.prepare("SELECT value FROM metadata WHERE key = 'PROJ.VERSION'").get() as { value: string }).value;
  const epsgVersion = (db.prepare("SELECT value FROM metadata WHERE key = 'EPSG.VERSION'").get() as { value: string }).value;

  baseOf = new Map<string, string>();
  northFirst = new Set<string>();
  for (const row of db
    .prepare(
      `SELECT pc.auth_name a, pc.code c, pc.geodetic_crs_auth_name ga, pc.geodetic_crs_code gc, ax.orientation o
         FROM projected_crs pc
         JOIN axis ax ON ax.coordinate_system_auth_name = pc.coordinate_system_auth_name
                     AND ax.coordinate_system_code = pc.coordinate_system_code
                     AND ax.coordinate_system_order = 1`
    )
    .all() as { a: string; c: string; ga: string; gc: string; o: string }[]) {
    baseOf.set(`${row.a}:${row.c}`, `${row.ga}:${row.gc}`);
    if (row.o === "north" || row.o === "south") northFirst.add(`${row.a}:${row.c}`);
  }

  const uoms = new Map<string, Uom>();
  for (const row of db.prepare("SELECT auth_name, code, name, type, conv_factor FROM unit_of_measure").all() as {
    auth_name: string;
    code: string;
    name: string;
    type: string;
    conv_factor: number | null;
  }[]) {
    uoms.set(`${row.auth_name}:${row.code}`, { name: row.name, type: row.type, factor: row.conv_factor });
  }

  const aliases = new Map<string, string[]>();
  for (const row of db.prepare("SELECT auth_name, code, alt_name FROM alias_name WHERE table_name = 'projected_crs'").all() as {
    auth_name: string;
    code: string;
    alt_name: string;
  }[]) {
    const key = `${row.auth_name}:${row.code}`;
    aliases.set(key, [...(aliases.get(key) ?? []), row.alt_name]);
  }

  const entries: Entry[] = [];

  const projectedSql = `
    SELECT pc.auth_name, pc.code, pc.name,
           cv.method_name,
           gd.name AS datum_name, gd.auth_name AS datum_auth, gd.code AS datum_code,
           gc.auth_name AS geodetic_auth, gc.code AS geodetic_code,
           pm.name AS pm_name, pm.longitude AS pm_value,
           pm.uom_auth_name AS pm_uom_auth, pm.uom_code AS pm_uom_code,
           el.semi_major_axis AS a, el.inv_flattening, el.semi_minor_axis,
           eu.name AS ellipsoid_uom,
           au.name AS axis_uom_name, au.conv_factor AS axis_uom_factor, au.type AS axis_uom_type,
           ex.south_lat, ex.north_lat, ex.west_lon, ex.east_lon, ex.name AS extent_name,
           ${Array.from({ length: 7 }, (_, index) =>
             `cv.param${index + 1}_name AS p${index + 1}n, cv.param${index + 1}_value AS p${index + 1}v, ` +
             `cv.param${index + 1}_uom_auth_name AS p${index + 1}ua, cv.param${index + 1}_uom_code AS p${index + 1}uc`
           ).join(", ")}
      FROM projected_crs pc
      JOIN conversion cv ON cv.auth_name = pc.conversion_auth_name AND cv.code = pc.conversion_code
      JOIN geodetic_crs gc ON gc.auth_name = pc.geodetic_crs_auth_name AND gc.code = pc.geodetic_crs_code
      JOIN geodetic_datum gd ON gd.auth_name = gc.datum_auth_name AND gd.code = gc.datum_code
      JOIN prime_meridian pm ON pm.auth_name = gd.prime_meridian_auth_name
                            AND pm.code = gd.prime_meridian_code
      JOIN ellipsoid el ON el.auth_name = gd.ellipsoid_auth_name AND el.code = gd.ellipsoid_code
      JOIN unit_of_measure eu ON eu.auth_name = el.uom_auth_name AND eu.code = el.uom_code
      JOIN axis ax ON ax.coordinate_system_auth_name = pc.coordinate_system_auth_name
                  AND ax.coordinate_system_code = pc.coordinate_system_code
                  AND ax.coordinate_system_order = 1
      JOIN unit_of_measure au ON au.auth_name = ax.uom_auth_name AND au.code = ax.uom_code
      JOIN usage us ON us.object_table_name = 'projected_crs'
                   AND us.object_auth_name = pc.auth_name AND us.object_code = pc.code
      JOIN extent ex ON ex.auth_name = us.extent_auth_name AND ex.code = us.extent_code
     WHERE pc.deprecated = 0
       AND pc.auth_name IN ('EPSG', 'ESRI')
       AND el.celestial_body_auth_name = 'PROJ' AND el.celestial_body_code = 'EARTH'
       AND ex.south_lat IS NOT NULL AND ex.north_lat IS NOT NULL
       AND ex.west_lon IS NOT NULL AND ex.east_lon IS NOT NULL
     GROUP BY pc.auth_name, pc.code
  `;

  const skipped = new Map<string, number>();
  const skip = (why: string): void => {
    skipped.set(why, (skipped.get(why) ?? 0) + 1);
  };

  /**
   * Systems whose datum does not use the Greenwich meridian.
   *
   * Collected so that every one of them is FORCED into the shipped control-point
   * fixture below, rather than left to a one-in-twelve sample. These are the
   * entries whose placement was wrong by up to 1,336 km, and the machine that
   * can prove it has PROJ installed while CI does not — so the fixture is the
   * only way that proof survives to the next contributor.
   */
  const nonGreenwichKeys = new Set<string>();

  for (const row of db.prepare(projectedSql).all() as Row[]) {
    const mapping = row.method_name ? METHODS[row.method_name] : undefined;
    if (!mapping) {
      skip(`method not implemented: ${row.method_name}`);
      continue;
    }
    if (row.axis_uom_type !== "length" || row.axis_uom_factor === null) {
      skip("axis unit is not a length");
      continue;
    }
    const ellipsoid = ellipsoidAxes(row);
    if (!ellipsoid) {
      skip("ellipsoid not usable");
      continue;
    }

    const params: Record<string, number | string> = { a: roundParam(ellipsoid.a), invF: ellipsoid.invF };
    let bad = false;
    for (let index = 1; index <= 7; index += 1) {
      const name = row[`p${index}n`] as string | null;
      if (!name) continue;
      const slot = PARAMETER_SLOTS[name];
      if (!slot) {
        skip(`unmapped parameter: ${name}`);
        bad = true;
        break;
      }
      const uom = uoms.get(`${row[`p${index}ua`]}:${row[`p${index}uc`]}`);
      const value = normalizeParameter(row[`p${index}v`] as number, uom, slot);
      if (value === null || !Number.isFinite(value)) {
        skip(`unconvertible parameter unit: ${name}`);
        bad = true;
        break;
      }
      params[slot] = roundParam(value);
    }
    if (bad) continue;

    if (mapping.hotineVariant) params.hotineVariant = mapping.hotineVariant;
    // pseudo_mercator's EPSG definition omits nothing, but Web Mercator clones
    // in the wild sometimes state no latitude of origin; the method never uses
    // one, so its absence is not a defect.
    const missing = REQUIRED_BY_METHOD[mapping.method].filter((key) => typeof params[key] !== "number");
    if (missing.length > 0) {
      skip(`missing parameters (${mapping.method}): ${missing.join(",")}`);
      continue;
    }

    // THE PRIME MERIDIAN, FOLDED IN. Applied after the completeness check so
    // `lon0` is known to be present: every implemented method requires one, and
    // adding an offset to a parameter that is not there would silently produce
    // a system whose origin is the meridian alone.
    const pmDegrees = primeMeridianDegrees(row, uoms);
    if (pmDegrees === null) {
      // Never assumed to be Greenwich. A system whose meridian cannot be read
      // is one OpenPlan cannot place, and an honest absence is worth more than
      // an entry that is wrong by the width of a country.
      skip(`prime meridian not convertible: ${row.pm_name}`);
      continue;
    }
    if (pmDegrees !== 0) {
      params.lon0 = roundParam((params.lon0 as number) + pmDegrees);
      nonGreenwichKeys.add(`${row.auth_name}:${row.code}`);
    }

    entries.push({
      authority: row.auth_name,
      code: String(row.code),
      name: row.name,
      unit: row.axis_uom_name,
      kind: "projected",
      datum: row.datum_name,
      datumKey: `${row.datum_auth}:${row.datum_code}`,
      geodeticCrs: `${row.geodetic_auth}:${row.geodetic_code}`,
      requiresDatumAcknowledgement: false,
      datumShiftNote: null,
      datumShiftMetres: null,
      unitToMetres: row.axis_uom_factor,
      method: mapping.method,
      params,
      areaOfUse: {
        west: row.west_lon,
        south: row.south_lat,
        east: row.east_lon,
        north: row.north_lat,
        description: row.extent_name,
      },
      aliases: aliases.get(`${row.auth_name}:${row.code}`) ?? [],
    });
  }

  // Geographic CRSs: already longitude/latitude, so there is no projection to
  // apply — but they still carry a datum, and the datum is the whole reason
  // they belong in the registry rather than being waved through as "WGS 84".
  const geographicSql = `
    SELECT gc.auth_name, gc.code, gc.name,
           NULL AS method_name,
           gd.name AS datum_name, gd.auth_name AS datum_auth, gd.code AS datum_code,
           gc.auth_name AS geodetic_auth, gc.code AS geodetic_code,
           pm.name AS pm_name, pm.longitude AS pm_value,
           pm.uom_auth_name AS pm_uom_auth, pm.uom_code AS pm_uom_code,
           el.semi_major_axis AS a, el.inv_flattening, el.semi_minor_axis,
           eu.name AS ellipsoid_uom,
           au.name AS axis_uom_name, au.conv_factor AS axis_uom_factor, au.type AS axis_uom_type,
           ex.south_lat, ex.north_lat, ex.west_lon, ex.east_lon, ex.name AS extent_name
      FROM geodetic_crs gc
      JOIN geodetic_datum gd ON gd.auth_name = gc.datum_auth_name AND gd.code = gc.datum_code
      JOIN prime_meridian pm ON pm.auth_name = gd.prime_meridian_auth_name
                            AND pm.code = gd.prime_meridian_code
      JOIN ellipsoid el ON el.auth_name = gd.ellipsoid_auth_name AND el.code = gd.ellipsoid_code
      JOIN unit_of_measure eu ON eu.auth_name = el.uom_auth_name AND eu.code = el.uom_code
      JOIN axis ax ON ax.coordinate_system_auth_name = gc.coordinate_system_auth_name
                  AND ax.coordinate_system_code = gc.coordinate_system_code
                  AND ax.coordinate_system_order = 1
      JOIN unit_of_measure au ON au.auth_name = ax.uom_auth_name AND au.code = ax.uom_code
      JOIN usage us ON us.object_table_name = 'geodetic_crs'
                   AND us.object_auth_name = gc.auth_name AND us.object_code = gc.code
      JOIN extent ex ON ex.auth_name = us.extent_auth_name AND ex.code = us.extent_code
     WHERE gc.deprecated = 0
       AND gc.type = 'geographic 2D'
       AND gc.auth_name IN ('EPSG', 'ESRI', 'OGC')
       AND el.celestial_body_auth_name = 'PROJ' AND el.celestial_body_code = 'EARTH'
       AND ex.south_lat IS NOT NULL AND ex.north_lat IS NOT NULL
       AND ex.west_lon IS NOT NULL AND ex.east_lon IS NOT NULL
     GROUP BY gc.auth_name, gc.code
  `;

  for (const row of db.prepare(geographicSql).all() as Row[]) {
    // Degrees are identified by the CONVERSION FACTOR, not by the unit's name.
    // EPSG issues at least two codes that both mean "degree" — 9102 and 9122,
    // "degree (supplier to define representation)" — and matching on the name
    // silently dropped 738 geographic systems, including the ones ESRI writes.
    // Gradians, which are also an "angle", must still be excluded, so the test
    // is numeric equality with π/180 rather than a name at all.
    const degreeFactor = Math.PI / 180;
    if (
      row.axis_uom_type !== "angle" ||
      row.axis_uom_factor === null ||
      Math.abs(row.axis_uom_factor - degreeFactor) > 1e-12
    ) {
      skip(`geographic CRS not in degrees: ${row.axis_uom_name}`);
      continue;
    }
    const ellipsoid = ellipsoidAxes(row);
    if (!ellipsoid) {
      skip("ellipsoid not usable");
      continue;
    }
    // A geographic system has no projection, so its `lon0` is the prime
    // meridian itself: the offset that turns "12.45 east of Rome" into a
    // longitude the rest of OpenPlan can draw. Omitted when it is Greenwich, so
    // the overwhelming majority of rows stay as short as they were and
    // `reprojectGeometry` keeps its identity fast path.
    const pmDegrees = primeMeridianDegrees(row, uoms);
    if (pmDegrees === null) {
      skip(`prime meridian not convertible: ${row.pm_name}`);
      continue;
    }
    entries.push({
      authority: row.auth_name,
      code: String(row.code),
      name: row.name,
      unit: "degree",
      kind: "geographic",
      datum: row.datum_name,
      datumKey: `${row.datum_auth}:${row.datum_code}`,
      geodeticCrs: `${row.geodetic_auth}:${row.geodetic_code}`,
      requiresDatumAcknowledgement: false,
      datumShiftNote: null,
      datumShiftMetres: null,
      unitToMetres: 1,
      method: "geographic",
      params: {
        a: roundParam(ellipsoid.a),
        invF: ellipsoid.invF,
        ...(pmDegrees === 0 ? {} : { lon0: roundParam(pmDegrees) }),
      },
      areaOfUse: {
        west: row.west_lon,
        south: row.south_lat,
        east: row.east_lon,
        north: row.north_lat,
        description: row.extent_name,
      },
      aliases: [],
    });
  }

  // ── Datum shifts, measured once per datum ──────────────────────────────────

  const byDatum = new Map<string, Entry[]>();
  for (const entry of entries) {
    byDatum.set(entry.datumKey, [...(byDatum.get(entry.datumKey) ?? []), entry]);
  }

  process.stderr.write(`measuring datum shift for ${byDatum.size} datums…\n`);
  for (const [, group] of byDatum) {
    // Measure on the datum's own geographic CRS — a projected CRS would fold
    // the projection into the number, and the projection is not the error being
    // measured.
    const representative = group.find((entry) => entry.kind === "geographic") ?? group[0];
    const area = representative.areaOfUse;
    const shift = measureDatumShift(representative.geodeticCrs, samplePoints(area.west, area.south, area.east, area.north));
    const note =
      shift.metres === null
        ? `OpenPlan has no published transformation from ${representative.datum} to WGS 84, so how far this layer sits ` +
          `from true WGS 84 positions is unknown. Treat its placement as approximate and do not measure distances ` +
          `against other layers from it.`
        : shift.metres > DATUM_ACKNOWLEDGEMENT_METRES
          ? `This layer is on ${representative.datum}. OpenPlan ships no datum-shift grids, so its coordinates are drawn ` +
            `as given: within this system's area of use that places shapes up to about ${Math.round(shift.metres)} m ` +
            `from their true WGS 84 position. The shift is systematic, not random — the whole layer moves together.`
          : shift.metres >= 0.5
            ? `This layer is on ${representative.datum}. Coordinates are drawn as given with no datum transformation, ` +
              `which can shift positions by up to about ${shift.metres} m.`
            : null;

    for (const entry of group) {
      entry.datumShiftMetres = shift.metres;
      entry.requiresDatumAcknowledgement = shift.metres === null || shift.metres > DATUM_ACKNOWLEDGEMENT_METRES;
      entry.datumShiftNote = note;
    }
  }

  // ── Verification against PROJ, which decides what ships ────────────────────
  //
  // EVERY PROJECTED ENTRY IS CHECKED, AND ONE THAT DISAGREES IS DROPPED. This
  // is the property that makes the registry's promise true by construction:
  // being in it means OpenPlan has been shown to place that system where PROJ
  // places it, rather than merely having a formula whose name matches.
  //
  // It is not hypothetical. EPSG classifies the Swiss oblique Mercator as a
  // Hotine variant B with an azimuth of exactly 90 degrees, which is a
  // degenerate case of the Hotine formulation — PROJ implements it as a
  // different projection entirely (`somerc`). Without this pass those entries
  // shipped and returned NaN. Worse, the sweep that was supposed to catch them
  // compared `error > tolerance`, and every comparison against NaN is false, so
  // they passed a check that looked thorough. Dropping what cannot be confirmed
  // turns that from a silent wrong answer into an honest "OpenPlan does not
  // carry that system", which names the code and can be acted on.
  //
  // The dropped entries are also where a future contributor should look for the
  // next method worth implementing: the reasons below say what and how many.

  const verified: Entry[] = [];
  const controlPoints: { crs: string; x: number; y: number; lon: number; lat: number }[] = [];
  const projectedEntries = entries.filter((entry) => entry.kind === "projected");
  process.stderr.write(`verifying ${projectedEntries.length} projected entries against PROJ…\n`);

  for (const entry of entries) {
    if (entry.kind === "geographic") {
      verified.push(entry);
      continue;
    }
    const check = verifyAgainstProj(entry, northFirst.has(`${entry.authority}:${entry.code}`));
    if (!check.ok) {
      skip(`disagrees with PROJ (${entry.method}): ${check.why}`);
      continue;
    }
    verified.push(entry);
    if (check.control) controlPoints.push(check.control);
  }
  entries.length = 0;
  entries.push(...verified);

  entries.sort((left, right) =>
    left.authority === right.authority
      ? Number(left.code) - Number(right.code)
      : left.authority.localeCompare(right.authority)
  );

  // ── Emit ───────────────────────────────────────────────────────────────────
  //
  // WRITTEN AS DEDUPLICATED TABLES, NOT AS SIX THOUSAND OBJECTS. The obvious
  // emission — one object literal per entry — came out at 5.0 MB, because every
  // row repeated its field names, its ellipsoid, its extent, and a datum note
  // that is identical across every system sharing a datum. Datum, extent and
  // unit are one-to-many, so they are their own tables and a row references
  // them by index. Nothing about the data changes; `materializeCrsEntry` in
  // registry.ts is the only code that has to know the layout, and
  // `crs-registry-is-generated-and-complete.test.ts` checks named systems all
  // the way through it rather than trusting the encoding.

  const datumIndex = new Map<string, number>();
  const datumRows: unknown[][] = [];
  const areaIndex = new Map<string, number>();
  const areaRows: unknown[][] = [];
  const unitIndex = new Map<string, number>();
  const unitRows: unknown[][] = [];
  const authorityIndex = new Map<string, number>();
  const authorityRows: string[] = [];

  const intern = <T>(key: string, index: Map<string, number>, rows: T[], make: () => T): number => {
    const existing = index.get(key);
    if (existing !== undefined) return existing;
    const next = rows.length;
    rows.push(make());
    index.set(key, next);
    return next;
  };

  const PARAM_ORDER = ["lat0", "lon0", "lat1", "lat2", "k0", "x0", "y0", "azimuth", "gamma"] as const;
  const methodOrder: CrsMethod[] = [
    "geographic",
    "lambert_conformal_conic_1sp",
    "lambert_conformal_conic_2sp",
    "transverse_mercator",
    "hotine_oblique_mercator",
    "albers_equal_area",
    "pseudo_mercator",
  ];

  const rows: unknown[][] = [];
  for (const entry of entries) {
    const datumSlot = intern(entry.datumKey, datumIndex, datumRows, () => [
      entry.datum,
      entry.params.a,
      entry.params.invF === Infinity ? null : entry.params.invF,
      entry.datumShiftMetres,
      entry.requiresDatumAcknowledgement ? 1 : 0,
      entry.datumShiftNote,
    ]);
    const area = entry.areaOfUse;
    const areaSlot = intern(
      `${area.west}|${area.south}|${area.east}|${area.north}|${area.description}`,
      areaIndex,
      areaRows,
      () => [area.west, area.south, area.east, area.north, area.description]
    );
    const unitSlot = intern(`${entry.unit}|${entry.unitToMetres}`, unitIndex, unitRows, () => [
      entry.unit,
      entry.unitToMetres,
    ]);
    const authoritySlot = intern(entry.authority, authorityIndex, authorityRows, () => entry.authority);

    const params: (number | null)[] = PARAM_ORDER.map((key) =>
      typeof entry.params[key] === "number" ? (entry.params[key] as number) : null
    );
    params.push(entry.params.hotineVariant === "A" ? 1 : entry.params.hotineVariant === "B" ? 2 : null);
    while (params.length > 0 && params[params.length - 1] === null) params.pop();

    rows.push([
      authoritySlot,
      entry.code,
      entry.name,
      unitSlot,
      entry.kind === "geographic" ? 0 : 1,
      methodOrder.indexOf(entry.method),
      datumSlot,
      areaSlot,
      params,
      entry.aliases,
    ]);
  }

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * GENERATED FILE — DO NOT EDIT BY HAND.");
  lines.push(" *");
  lines.push(" * Produced by `scripts/generate-crs-registry.ts` from PROJ's proj.db.");
  lines.push(` * PROJ ${projVersion}, EPSG ${epsgVersion}. Regenerate rather than editing:`);
  lines.push(" * a hand edit here is a coordinate system that disagrees with the authority,");
  lines.push(" * which is indistinguishable from a correct one until a layer lands wrong.");
  lines.push(" *");
  lines.push(" * SERVER-SIDE ONLY. This module is roughly a megabyte and must never be");
  lines.push(" * imported into a client component: the browser needs the ONE entry the server");
  lines.push(" * resolved for the file being uploaded, not the world's coordinate systems.");
  lines.push(" * `reproject.ts` therefore takes an entry rather than a code, so nothing on the");
  lines.push(" * reprojection path drags this file into a bundle.");
  lines.push(" *");
  for (const line of EPSG_ATTRIBUTION) lines.push(` * ${line}`);
  lines.push(" */");
  lines.push("");
  lines.push(`export const CRS_REGISTRY_SOURCE = ${JSON.stringify(`PROJ ${projVersion} / EPSG ${epsgVersion}`)};`);
  lines.push("");
  lines.push("/** Authority names; rows reference one by index. */");
  lines.push(`export const CRS_AUTHORITIES: readonly string[] = ${JSON.stringify(authorityRows)};`);
  lines.push("");
  lines.push("/** `[name, toMetres]`. `toMetres` is 1 for degrees, which never use it. */");
  lines.push("export const CRS_UNITS: readonly (readonly [string, number])[] = [");
  for (const row of unitRows) lines.push(`  ${JSON.stringify(row)},`);
  lines.push("];");
  lines.push("");
  lines.push("/**");
  lines.push(" * `[name, semiMajorAxisMetres, inverseFlattening | null, datumShiftMetres | null,");
  lines.push(" *   requiresAcknowledgement, note | null]`");
  lines.push(" *");
  lines.push(" * `inverseFlattening` is null for a sphere. `datumShiftMetres` is null when PROJ");
  lines.push(" * offers no transformation to WGS 84 beyond a ballpark one — UNKNOWN, which is");
  lines.push(" * treated as worse than large and never as zero.");
  lines.push(" */");
  lines.push("export const CRS_DATUMS: readonly (readonly [string, number, number | null, number | null, 0 | 1, string | null])[] = [");
  for (const row of datumRows) lines.push(`  ${JSON.stringify(row)},`);
  lines.push("];");
  lines.push("");
  lines.push("/** `[west, south, east, north, description]` — the authority's area of use. */");
  lines.push("export const CRS_AREAS: readonly (readonly [number, number, number, number, string])[] = [");
  for (const row of areaRows) lines.push(`  ${JSON.stringify(row)},`);
  lines.push("];");
  lines.push("");
  lines.push("/**");
  lines.push(" * `[authorityIndex, code, name, unitIndex, kind, methodIndex, datumIndex,");
  lines.push(" *   areaIndex, params, aliases]`");
  lines.push(" *");
  lines.push(" * `kind` is 0 geographic / 1 projected. `methodIndex` indexes `CRS_METHODS` from");
  lines.push(" * `./types`, whose order this file depends on — the ordering is asserted in");
  lines.push(" * `every-crs-entry-has-an-implemented-method.test.ts`. `params` is");
  lines.push(" * `[lat0, lon0, lat1, lat2, k0, x0, y0, azimuth, gamma, hotineVariant]`, degrees");
  lines.push(" * and metres, trailing nulls trimmed; `hotineVariant` is 1 for A and 2 for B.");
  lines.push(" */");
  lines.push("export type CrsRegistryRow = readonly [");
  lines.push("  number, string, string, number, 0 | 1, number, number, number,");
  lines.push("  readonly (number | null)[], readonly string[],");
  lines.push("];");
  lines.push("");
  lines.push("export const CRS_ROWS: readonly CrsRegistryRow[] = [");
  for (const row of rows) lines.push(`  ${JSON.stringify(row)},`);
  lines.push("];");
  lines.push("");

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, lines.join("\n"), "utf8");

  // The control points the shipped test compares against, written by the same
  // run that wrote the registry so the two can never describe different data.
  // CI has no PROJ, so this fixture is how the agreement survives the machine
  // that proved it. Sampled rather than complete: every implemented method is
  // represented, which is what the test asserts.
  const wanted = new Set(controlPoints.filter((_point, index) => index % 12 === 0).map((point) => point.crs));
  // Every non-Greenwich system, unconditionally. A sample that happened to miss
  // them is how this class of error stayed invisible in the first place.
  for (const key of nonGreenwichKeys) wanted.add(key);
  for (const method of methodOrder) {
    const first = controlPoints.find((point) => {
      const entry = entries.find((candidate) => `${candidate.authority}:${candidate.code}` === point.crs);
      return entry?.method === method;
    });
    if (first) wanted.add(first.crs);
  }
  const fixture = controlPoints
    .filter((point) => wanted.has(point.crs))
    .sort((left, right) => left.crs.localeCompare(right.crs));
  mkdirSync(dirname(CONTROL_POINTS_OUTPUT), { recursive: true });
  writeFileSync(CONTROL_POINTS_OUTPUT, `${JSON.stringify(fixture)}\n`, "utf8");
  process.stderr.write(`wrote ${fixture.length} control points to ${CONTROL_POINTS_OUTPUT}\n`);

  process.stderr.write(`wrote ${entries.length} entries to ${OUTPUT}\n`);
  const reasons = [...skipped.entries()].sort((left, right) => right[1] - left[1]);
  process.stderr.write(`skipped:\n${reasons.map(([why, count]) => `  ${count.toString().padStart(6)}  ${why}`).join("\n")}\n`);
}

main();
