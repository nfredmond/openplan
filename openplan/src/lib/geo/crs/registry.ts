/**
 * Looking a coordinate system up — by code, by name, or out of a `.prj`.
 *
 * SERVER-SIDE. This module reaches the ~1.4 MB generated table, so it must not
 * be imported from a client component. The browser reprojects with ONE entry
 * that the server resolved and sent it; `reproject.ts` deliberately takes an
 * entry rather than a code so that nothing on the reprojection path pulls the
 * registry into a bundle.
 *
 * ═══ MATCHING IS EXACT, IN A FIXED ORDER, AND NEVER FUZZY ═══
 *
 *   1. The authority code the file states — the only unambiguous identifier.
 *   2. The exact name, normalized for punctuation only.
 *
 * There is no third step. A near-miss on a zone name — "California zone 2"
 * against "California zone 3" — is a coordinate system whose origin is a degree
 * and a half away, and every shape read through it lands about a hundred
 * kilometres from where it belongs while looking entirely ordinary. The correct
 * answer to a name the registry does not carry is a refusal that says which
 * name it was, so a planner can go and look it up. It is never the nearest
 * thing.
 */

import {
  CRS_AREAS,
  CRS_AUTHORITIES,
  CRS_DATUMS,
  CRS_REGISTRY_SOURCE,
  CRS_ROWS,
  CRS_UNITS,
  type CrsRegistryRow,
} from "./crs-registry.generated";
import { CRS_METHODS, type CrsMethod, type CrsProjectionParams, type CrsRegistryEntry } from "./types";
import { readWktCrs } from "./wkt";

export { CRS_REGISTRY_SOURCE };

const PARAM_ORDER = ["lat0", "lon0", "lat1", "lat2", "k0", "x0", "y0", "azimuth", "gamma"] as const;

/**
 * One row of the generated table, as an entry.
 *
 * Materialized on demand and cached, rather than building 6,693 objects at
 * import time: a resolution touches a handful of systems, and the picker asks
 * for one region at a time.
 */
function materialize(row: CrsRegistryRow): CrsRegistryEntry {
  const [authorityIndex, code, name, unitIndex, kind, methodIndex, datumIndex, areaIndex, rawParams, aliases] = row;
  const [datumName, semiMajor, inverseFlattening, shiftMetres, requiresAck, note] = CRS_DATUMS[datumIndex];
  const [unitName, unitToMetres] = CRS_UNITS[unitIndex];
  const [west, south, east, north, description] = CRS_AREAS[areaIndex];

  const params: CrsProjectionParams = {
    a: semiMajor,
    invF: inverseFlattening === null ? Infinity : inverseFlattening,
  };
  PARAM_ORDER.forEach((key, slot) => {
    const value = rawParams[slot];
    if (typeof value === "number") params[key] = value;
  });
  const variant = rawParams[PARAM_ORDER.length];
  if (variant === 1) params.hotineVariant = "A";
  if (variant === 2) params.hotineVariant = "B";

  const method: CrsMethod = CRS_METHODS[methodIndex];

  return {
    authority: CRS_AUTHORITIES[authorityIndex],
    code,
    name,
    unit: unitName,
    kind: kind === 0 ? "geographic" : "projected",
    datum: datumName,
    requiresDatumAcknowledgement: requiresAck === 1,
    datumShiftNote: note,
    datumShiftMetres: shiftMetres,
    unitToMetres,
    method,
    params,
    areaOfUse: { west, south, east, north, description },
    aliases: [...aliases],
    // Derived here rather than stored: it is a function of the row, and a
    // stored copy is one more thing that can disagree with the row it describes.
    // Two entries share a key exactly when they are the same projection on the
    // same datum and differ only in the unit their coordinates are written in.
    siblingKey: siblingKeyFor(method, datumIndex, rawParams),
  };
}

/**
 * How closely two entries' parameters must agree to be the same zone.
 *
 * A TOLERANCE IS REQUIRED HERE, and finding out why was the point. California
 * zone 2 in metres declares a false easting of exactly 2,000,000 m; the same
 * zone in US survey feet declares 6,561,666.667 ft, which is EPSG's own rounded
 * value and converts to 2,000,000.0001 m. Compared exactly, the two are
 * different systems and OpenPlan can never say "you chose feet and this file is
 * in metres" — the sentence that catches the commonest legacy mistake there is.
 *
 * A centimetre on the false origin and about a centimetre of arc on the angles
 * is far below any difference that distinguishes two real zones, which are
 * separated by degrees of longitude and hundreds of kilometres of false easting.
 */
const SIBLING_LENGTH_TOLERANCE_METRES = 0.01;
const SIBLING_ANGLE_TOLERANCE_DEGREES = 1e-7;

function siblingKeyFor(method: CrsMethod, datumIndex: number, rawParams: readonly (number | null)[]): string {
  // Matches PARAM_ORDER: angles, then the scale factor, then the false origin,
  // then the two Hotine angles, then the variant flag.
  const quantum = [
    SIBLING_ANGLE_TOLERANCE_DEGREES,
    SIBLING_ANGLE_TOLERANCE_DEGREES,
    SIBLING_ANGLE_TOLERANCE_DEGREES,
    SIBLING_ANGLE_TOLERANCE_DEGREES,
    1e-9,
    SIBLING_LENGTH_TOLERANCE_METRES,
    SIBLING_LENGTH_TOLERANCE_METRES,
    SIBLING_ANGLE_TOLERANCE_DEGREES,
    SIBLING_ANGLE_TOLERANCE_DEGREES,
    1,
  ];
  const parts = quantum.map((step, slot) => {
    const value = rawParams[slot];
    return typeof value === "number" ? String(Math.round(value / step)) : "";
  });
  return `${method}|${datumIndex}|${parts.join(",")}`;
}

const cache = new Map<number, CrsRegistryEntry>();

function entryAt(index: number): CrsRegistryEntry {
  const cached = cache.get(index);
  if (cached) return cached;
  const built = materialize(CRS_ROWS[index]);
  cache.set(index, built);
  return built;
}

/** How many coordinate systems this build carries. */
export function crsRegistrySize(): number {
  return CRS_ROWS.length;
}

/** Every entry, materialized. Used by the guards and by the region picker. */
export function allCrsEntries(): CrsRegistryEntry[] {
  return CRS_ROWS.map((_row, index) => entryAt(index));
}

// ── Index by authority code ──────────────────────────────────────────────────

let codeIndex: Map<string, number> | null = null;

function buildCodeIndex(): Map<string, number> {
  if (codeIndex) return codeIndex;
  const index = new Map<string, number>();
  CRS_ROWS.forEach((row, position) => {
    index.set(`${CRS_AUTHORITIES[row[0]]}:${row[1]}`.toUpperCase(), position);
  });
  codeIndex = index;
  return index;
}

/**
 * Find a system by authority code: `"EPSG:2226"`, `"epsg:2226"`, or `"2226"`.
 *
 * A bare code is read as EPSG, which is the only authority that issues bare
 * numeric codes people quote — but ONLY when it resolves; a bare code that is
 * not an EPSG code is a miss rather than a search through the other
 * authorities, because two authorities can issue the same number for different
 * systems and picking between them by luck is exactly the fuzzy match this
 * module refuses to do.
 */
export function findCrsByCode(authorityCode: string): CrsRegistryEntry | null {
  const trimmed = authorityCode.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  const index = buildCodeIndex();
  const qualified = trimmed.includes(":") ? trimmed : `EPSG:${trimmed}`;
  const position = index.get(qualified);
  return position === undefined ? null : entryAt(position);
}

// ── Index by name ────────────────────────────────────────────────────────────

/**
 * Collapse a coordinate system name to its letters and digits.
 *
 * ESRI writes `NAD_1983_StatePlane_California_II_FIPS_0402_Feet` where EPSG
 * writes `NAD83 / California zone 2 (ftUS)`; those are genuinely different
 * names for the same thing and both are carried in the registry, so this exists
 * only to absorb punctuation and case, never to bridge two different names.
 */
function normalizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

type NameMatch = { positions: number[] };

let nameIndex: Map<string, NameMatch> | null = null;

function buildNameIndex(): Map<string, NameMatch> {
  if (nameIndex) return nameIndex;
  const index = new Map<string, NameMatch>();
  const add = (name: string, position: number): void => {
    const key = normalizeName(name);
    if (key.length === 0) return;
    const existing = index.get(key);
    if (existing) {
      if (!existing.positions.includes(position)) existing.positions.push(position);
    } else {
      index.set(key, { positions: [position] });
    }
  };
  CRS_ROWS.forEach((row, position) => {
    add(row[2], position);
    for (const alias of row[9]) add(alias, position);
  });
  nameIndex = index;
  return index;
}

/**
 * Find a system by its exact name or a recorded alias.
 *
 * AMBIGUITY IS A MISS, NOT A COIN TOSS. EPSG and ESRI publish some systems
 * under identical names; where every candidate is the same projection on the
 * same datum in the same unit, they are interchangeable and the one from the
 * first-listed authority is returned. Where they are NOT — the same name
 * covering two different zones or two different units — this returns null and
 * the caller refuses by name, because there is no honest way to pick.
 *
 * `preferUnitToMetres` breaks the one tie that is legitimate to break: a `.prj`
 * that states a linear unit has told us which of the metre and survey-foot
 * forms of a zone it is, and that is evidence from the file rather than a
 * guess about it.
 */
export function findCrsByName(name: string, preferUnitToMetres?: number | null): CrsRegistryEntry | null {
  const match = buildNameIndex().get(normalizeName(name));
  if (!match) return null;

  const candidates = match.positions.map((position) => entryAt(position));
  if (candidates.length === 1) return candidates[0];

  if (preferUnitToMetres !== undefined && preferUnitToMetres !== null) {
    const byUnit = candidates.filter(
      (entry) => Math.abs(entry.unitToMetres - preferUnitToMetres) < 1e-9
    );
    if (byUnit.length >= 1) {
      const sameSystem = byUnit.every((entry) => entry.siblingKey === byUnit[0].siblingKey);
      if (sameSystem) return byUnit[0];
    }
  }

  const identical = candidates.every(
    (entry) => entry.siblingKey === candidates[0].siblingKey && entry.unitToMetres === candidates[0].unitToMetres
  );
  return identical ? candidates[0] : null;
}

// ── Siblings ─────────────────────────────────────────────────────────────────

let siblingIndex: Map<string, number[]> | null = null;

/**
 * The same projection on the same datum, in every unit the registry carries it.
 *
 * This is what makes "you told OpenPlan this file is in survey feet, and read
 * that way it lands in Nevada — but read as the same zone in metres it lands in
 * your county" a statement OpenPlan can prove rather than a hunch about a
 * common mistake.
 */
export function crsSiblings(entry: CrsRegistryEntry): CrsRegistryEntry[] {
  if (!siblingIndex) {
    const index = new Map<string, number[]>();
    CRS_ROWS.forEach((_row, position) => {
      const key = entryAt(position).siblingKey;
      index.set(key, [...(index.get(key) ?? []), position]);
    });
    siblingIndex = index;
  }
  return (siblingIndex.get(entry.siblingKey) ?? [])
    .map((position) => entryAt(position))
    .filter((candidate) => candidate.code !== entry.code || candidate.authority !== entry.authority);
}

// ── From a .prj ──────────────────────────────────────────────────────────────

export type PrjIdentification =
  | { ok: true; entry: CrsRegistryEntry }
  | {
      ok: false;
      /** What the file called itself, for a refusal that a planner can act on. */
      declaredName: string | null;
      /** The authority code the file stated, when it stated one. */
      declaredCode: string | null;
      reason: "unreadable" | "not_in_registry";
    };

/**
 * Identify the coordinate system a shapefile's `.prj` describes.
 *
 * The code the file states is tried first and its ANSWER IS CHECKED AGAINST THE
 * FILE'S OWN STRUCTURE: a `.prj` whose outermost element is a PROJCS cannot be
 * a geographic system, and a code that resolves to one has been read from the
 * wrong element. That combination is a real ESRI output shape, and accepting it
 * would mean reading survey feet as degrees.
 */
export function identifyCrsFromPrj(prjText: string): PrjIdentification {
  const declared = readWktCrs(prjText);
  if (!declared) return { ok: false, declaredName: null, declaredCode: null, reason: "unreadable" };

  const declaredCode = declared.authority ? `${declared.authority.authority}:${declared.authority.code}` : null;

  if (declaredCode) {
    const byCode = findCrsByCode(declaredCode);
    if (byCode && byCode.kind === declared.kind) return { ok: true, entry: byCode };
  }

  const byName = findCrsByName(declared.name, declared.unitToMetres);
  if (byName && byName.kind === declared.kind) return { ok: true, entry: byName };

  return { ok: false, declaredName: declared.name, declaredCode, reason: "not_in_registry" };
}

// ── The picker ───────────────────────────────────────────────────────────────

export type CrsRegionQuery = {
  /** Longitude/latitude the planner's work is in — usually their home geography. */
  west: number;
  south: number;
  east: number;
  north: number;
  /** Cap on results; the picker is a list a person reads. */
  limit?: number;
};

/**
 * Coordinate systems whose area of use covers the region a planner works in.
 *
 * THIS IS A PICKER, NOT A GUESS. It is what a planner sees when their shapefile
 * has no `.prj` and OpenPlan has to ask; narrowing six thousand systems to the
 * few dozen that could possibly apply to their county is the difference between
 * a question they can answer and one they cannot. Whichever they pick is
 * recorded as THEIR statement, and it is still checked against the area of use
 * before anything is stored.
 *
 * Ordered by how tightly the system's area of use fits the region, so the local
 * State Plane zone sorts above the statewide Albers and the continental UTM.
 */
export function listCrsForRegion(query: CrsRegionQuery): CrsRegistryEntry[] {
  const covering: { entry: CrsRegistryEntry; area: number }[] = [];
  for (let position = 0; position < CRS_ROWS.length; position += 1) {
    const [, , , , , , , areaIndex] = CRS_ROWS[position];
    const [west, south, east, north] = CRS_AREAS[areaIndex];
    // An area of use that crosses the antimeridian is stored with west > east;
    // it wraps rather than being empty, and the Aleutians depend on it.
    const spansLongitude =
      west <= east ? query.west >= west && query.east <= east : query.west >= west || query.east <= east;
    if (!spansLongitude || query.south < south || query.north > north) continue;
    const span = (west <= east ? east - west : 360 - west + east) * (north - south);
    covering.push({ entry: entryAt(position), area: span });
  }
  covering.sort((left, right) =>
    left.area === right.area ? left.entry.name.localeCompare(right.entry.name) : left.area - right.area
  );
  return covering.slice(0, query.limit ?? 200).map((candidate) => candidate.entry);
}
