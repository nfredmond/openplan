/**
 * Place resolver — turns a typed place name (city, CDP, county, town or
 * township, tribal area, or metro/micro area) into an official Census TIGERweb
 * boundary polygon usable as a model
 * study area (`corridor_geojson`). This is the "type a place, run it anywhere"
 * front door: no place is hardcoded, every US geography resolves the same way.
 *
 * Search hits the TIGERweb `tigerWMS_Current` layers by the start of the clean
 * BASENAME or the full Census NAME, so the label a search shows finds its place
 * again; boundary resolution fetches a single feature by GEOID as generalized
 * WGS84 GeoJSON.
 * Counties come from `searchUsCounties`, a catalog of the same service's
 * Counties layer, so county search and county boundaries share one source.
 * Nothing here needs a Census API key.
 *
 * All functions are server-side (they use the shared cached fetcher). The pure
 * URL/parse/score helpers are exported for unit testing without network.
 */
import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import { bboxFromGeojson } from "@/lib/data-sources/census";
import { corridorGeojsonSchema, type CorridorGeojson } from "@/lib/models/run-launch";
import { searchUsCounties } from "@/lib/geographies/us-counties";
import {
  splitStateQualifier,
  splitTrailingStateWords,
  stateFipsFromUsps,
  stateUspsFromFips,
} from "@/lib/geographies/state-fips";
import { normalizePlaceGeoid, type PlaceKind } from "@/lib/api/place-geographies";
import {
  TIGERWEB_CENSUS2020_BASE,
  TIGERWEB_CURRENT_BASE,
  TIGERWEB_CURRENT_COUNTY_LAYER,
} from "@/lib/geographies/tigerweb-services";

export type { PlaceKind } from "@/lib/api/place-geographies";

const TIGERWEB_BASE = TIGERWEB_CURRENT_BASE;

/**
 * The 2020 Census vintage, consulted ONLY for population.
 *
 * WHY A SECOND SERVICE. Ranking same-named places needs population, and
 * `tigerWMS_Current` does not carry it: its county/place/CDP layers have no
 * POP100 field at all, and its CBSA layers have the field but leave every value
 * null. `tigerWMS_Census2020` has real values on all four.
 *
 * WHY NOT JUST SEARCH THE 2020 SERVICE. Because it would silently shrink the
 * country. Measured against the live services: CDPs 12,902 -> 12,454, and 54
 * CBSAs present today are absent from the 2020 vintage. Moving search there
 * would make ~500 real US geographies unfindable with no message explaining
 * why — the exact place-specific failure the product forbids.
 *
 * So search stays on Current (authoritative coverage) and population is joined
 * in from Census2020 by GEOID. A geography the 2020 vintage never knew about
 * keeps its full search behavior and simply ranks as unknown-population.
 */
const TIGERWEB_POPULATION_BASE = TIGERWEB_CENSUS2020_BASE;

// TIGERweb layer ids (tigerWMS_Current), verified against the live service.
// County subdivisions (22) were read from
// https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer?f=json
// and .../MapServer/22?f=json on 2026-11-01 ("Census Current (2026) WMS",
// January 1, 2026 vintage): fields GEOID (10), STATE, COUNTY, BASENAME, NAME,
// LSADC, FUNCSTAT.
const LAYER = {
  county: TIGERWEB_CURRENT_COUNTY_LAYER,
  incorporatedPlace: 28,
  censusDesignatedPlace: 30,
  metro: 93,
  micro: 91,
  countySubdivision: 22,
} as const;

/**
 * American Indian, Alaska Native and Native Hawaiian (AIANNH) area layers on
 * tigerWMS_Current. TIGERweb splits the one Census AIANNH geography across
 * these nine layers, each with the same fields: GEOID (4-digit AIANNH code plus
 * an R/T component letter), BASENAME, NAME, and AIANNHFP1-3, which hold up to
 * three "SS-FFFFF" state FIPS and AIANNH FIPS pairs for an area that crosses
 * state lines.
 *
 * Read from .../tigerWMS_Current/MapServer?f=json and each .../MapServer/{id}?f=json
 * on 2026-11-01. Left out on purpose: 32 (Alaska Native Regional Corporations,
 * which are corporations with a 5-digit code of their own, not tribal lands)
 * and 34 (tribal subdivisions, which sit inside an area listed here).
 */
const AIANNH_LAYERS: readonly number[] = [
  36, // Federal American Indian Reservations
  38, // Off-Reservation Trust Lands
  40, // State American Indian Reservations
  42, // Hawaiian Home Lands
  44, // Alaska Native Village Statistical Areas
  46, // Oklahoma Tribal Statistical Areas
  48, // State Designated Tribal Statistical Areas
  50, // Tribal Designated Statistical Areas
  52, // American Indian Joint-Use Areas
];

const AIANNH_OUT_FIELDS = "GEOID,NAME,BASENAME,AIANNHFP1,AIANNHFP2,AIANNHFP3";
const COUSUB_OUT_FIELDS = "GEOID,NAME,BASENAME,STATE,COUNTY";

/**
 * Which county subdivisions the search offers as a town or township.
 *
 * Left out: statistical subdivisions (FUNCSTAT S: census county divisions and
 * unorganized territories, which have no government), fictitious ones
 * (FUNCSTAT F: placeholders Census creates to complete its hierarchy), and
 * cities (LSADC 25), every one of which is also an incorporated place and is
 * already offered as a city. The boundary lookup applies no filter, so a
 * stored reference to any county subdivision still resolves.
 */
const COUSUB_SEARCH_WHERE = "FUNCSTAT NOT IN ('S','F') AND LSADC<>'25'";

/**
 * Matching layer ids on `tigerWMS_Census2020` — they differ from Current and
 * must not be assumed equal. Counties are absent on purpose: `us-counties`
 * loads the whole Counties layer once, with its own 2020 population join,
 * instead of a per-search query.
 */
const POPULATION_LAYER_BY_KIND: Partial<Record<PlaceKind, number>> = {
  city: 26,
  cdp: 28,
  metro: 76,
  micro: 78,
  // County Subdivisions on tigerWMS_Census2020, read from
  // .../tigerWMS_Census2020/MapServer/20?f=json on 2026-11-01 (has POP100).
  // AIANNH areas have no entry: their population would take nine more
  // lookups, and unknown population only changes ranking among equal matches.
  cousub: 20,
};

/**
 * How many rows each layer returns before ranking. Deliberately larger than any
 * caller's result limit: the server truncates by BASENAME, so a limit-sized
 * fetch would discard the highest-population match before we ever got to rank
 * it — precisely the bug this change exists to fix, one level down.
 */
const CANDIDATE_POOL_PER_LAYER = 40;

/**
 * The layer(s) that hold each kind's boundaries. Every kind but `aiannh` has
 * exactly one; an AIANNH GEOID is looked up across all nine of its layers.
 */
const LAYERS_BY_KIND: Record<PlaceKind, readonly number[]> = {
  county: [LAYER.county],
  city: [LAYER.incorporatedPlace],
  cdp: [LAYER.censusDesignatedPlace],
  metro: [LAYER.metro],
  micro: [LAYER.micro],
  aiannh: AIANNH_LAYERS,
  cousub: [LAYER.countySubdivision],
};

/**
 * Every kind `searchPlaces` consults. Derived from the layer map so the
 * "nothing answered" test cannot drift from the lookups actually performed.
 */
const ALL_PLACE_KINDS = Object.keys(LAYERS_BY_KIND) as PlaceKind[];

const KIND_DESCRIPTION: Record<PlaceKind, string> = {
  county: "County",
  city: "City / town",
  cdp: "Census-designated place",
  metro: "Metro area",
  micro: "Micropolitan area",
  aiannh: "Tribal area",
  cousub: "Town or township",
};

export interface PlaceSearchResult {
  kind: PlaceKind;
  geoid: string;
  label: string;
  description: string;
  stateFips: string | null;
}

/**
 * The result of a place search, including which lookups never answered.
 *
 * WHY THIS IS NOT JUST AN ARRAY. Every lookup here can fail silently:
 * `fetchJsonWithRetry` returns `null` for a timeout, a non-OK status, or a body
 * that would not parse. Collapsing that into `[]` made an outage (or, when the
 * county catalog still came from the keyed Census API, an unset
 * `CENSUS_API_KEY`) indistinguishable from "your county does not exist", which
 * is what the study-area picker then told the planner.
 * This is the front door of the whole product; it has to know the difference.
 */
export interface PlaceSearchOutcome {
  items: PlaceSearchResult[];
  /** Place kinds whose lookup did not answer. Empty when every lookup answered. */
  unavailableKinds: PlaceKind[];
  /** True when NOT ONE lookup answered: the search failed, it did not come back empty. */
  searchUnavailable: boolean;
  /** The most specific knowable cause, when there is one. */
  unavailableReason: string | null;
}

// Internal: carries the lowercased key we rank matches against, plus the
// population used only to break ties between equally good name matches.
// `coveredStateFips` is every state an AIANNH area lies in, kept so a
// state-qualified search can match any of them, not only the first.
// `nameKey` is the lowercased Census NAME ("pyramid lake paiute reservation"),
// ranked in a tier of its own below the base name.
type RankedPlace = PlaceSearchResult & {
  sortKey: string;
  nameKey: string;
  population: number | null;
  coveredStateFips?: string[];
};

export interface ResolvedBoundary {
  kind: PlaceKind;
  geoid: string;
  label: string | null;
  geojson: CorridorGeojson;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

interface TigerAttributes {
  GEOID?: string | number;
  NAME?: string;
  BASENAME?: string;
  STATE?: string | number;
  COUNTY?: string | number;
  POP100?: number | string | null;
  AIANNHFP1?: string | null;
  AIANNHFP2?: string | null;
  AIANNHFP3?: string | null;
}

interface TigerQueryJson {
  features?: Array<{ attributes?: TigerAttributes }>;
}

interface TigerGeojson {
  type?: string;
  features?: Array<{ type?: string; geometry?: unknown; properties?: Record<string, unknown> }>;
}

/**
 * Sanitize a user query for embedding in an ArcGIS `where` LIKE clause. Keeps
 * letters (accented ones too: "Española", "Río Cañas"), digits, space and the
 * punctuation Census names use: period, hyphen, apostrophe, comma ("Reno, NV
 * Metro Area"), slash ("Creek/Seminole") and parentheses ("Ponca (NE)").
 * Everything else, including the LIKE wildcards `%` and `_`, the backslash and
 * the double quote, becomes a space. Whitespace collapses, length is capped,
 * then single quotes are escaped by doubling them (SQL standard), so a name
 * like "O'Fallon" is safe and the text can never leave its string literal.
 * Every kept character is inert inside a quoted literal; each was checked
 * against the live service on 2026-11-14.
 */
export function sanitizeLikeQuery(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}0-9 .,'()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/'/g, "''");
}

/**
 * The name predicate every search and population query uses: the start of
 * BASENAME or the start of NAME.
 *
 * What NAME holds, per layer, read from sample rows of each
 * tigerWMS_Current layer on 2026-11-14 (the layer descriptions at
 * .../MapServer/{id}?f=json only name the layer and its vintage, January 1,
 * 2026, and alias the field as "NAME"):
 * - 28 Incorporated Places: BASENAME plus the legal kind, "Davis city",
 *   "Smith Village town".
 * - 30 Census Designated Places: BASENAME plus "CDP", "Sierra City CDP".
 * - 22 County Subdivisions: BASENAME plus the legal kind, "Washington
 *   township", "Lexington town", "Río Cañas barrio".
 * - 36 to 52, the AIANNH layers: BASENAME plus the area type, "Pyramid Lake
 *   Paiute Reservation", "Navajo Nation Off-Reservation Trust Land",
 *   "Creek/Seminole joint-use OTSA", "Pilot Station ANVSA".
 * - 91 and 93, micro and metro areas: BASENAME (which already ends in the
 *   states) plus the area type, "Reno, NV Metro Area".
 * - 82 Counties: "Sierra County". Not queried here; `us-counties` loads the
 *   whole layer and matches its own labels, which are built from NAME.
 * The 2020 population layers (20, 26, 28, 76, 78 on tigerWMS_Census2020) carry
 * the same NAME and BASENAME fields.
 *
 * So BASENAME finds "Pyramid Lake Paiute" and NAME finds "Pyramid Lake Paiute
 * Reservation", which is the name a planner knows and the label search shows.
 */
function nameLikeClause(sanitizedLike: string, matchName: boolean): string {
  const basename = `UPPER(BASENAME) LIKE UPPER('${sanitizedLike}%')`;
  return matchName ? `(${basename} OR UPPER(NAME) LIKE UPPER('${sanitizedLike}%'))` : basename;
}

/**
 * Did this row match on NAME alone? Mirrors the server's
 * `UPPER(BASENAME) LIKE UPPER('q%')` for a sanitized query, which holds no
 * wildcard, so a plain prefix test is the same rule.
 */
function isNameOnlyMatch(attrs: { BASENAME?: unknown } | undefined, sanitizedLike: string): boolean {
  const prefix = sanitizedLike.replace(/''/g, "'").toUpperCase();
  return !String(attrs?.BASENAME ?? "").toUpperCase().startsWith(prefix);
}

export interface PlaceSearchUrlOptions {
  layerId: number;
  sanitizedLike: string;
  limit: number;
  hasStateField: boolean;
  /**
   * Restrict to these state FIPS: one ("Davis, CA") or several ("Columbus,
   * GA-AL"). Only meaningful on layers that carry a STATE field. CBSA layers
   * do not, and pass null: a metro area legitimately spans states, and its own
   * BASENAME already names them ("Columbus, GA-AL").
   */
  stateFips?: string | readonly string[] | null;
  /**
   * Restrict to one 3-digit county FIPS, with exactly one state. Only the
   * county subdivision layer passes it: its COUNTY field is what tells
   * "Washington township, Shelby County, OH" from the other forty-odd in Ohio.
   */
  countyFips?: string | null;
  /** Fields to return, when a layer needs more than the default name fields. */
  outFields?: string;
  /** A fixed, code-owned predicate for the layer. Never built from user input. */
  layerWhere?: string;
  /** Match NAME as well as BASENAME. Default true; false only for the refetch. */
  matchName?: boolean;
}

export function buildPlaceSearchUrl({
  layerId,
  sanitizedLike,
  limit,
  hasStateField,
  stateFips = null,
  countyFips = null,
  outFields,
  layerWhere,
  matchName = true,
}: PlaceSearchUrlOptions): string {
  const clauses = [nameLikeClause(sanitizedLike, matchName)];
  // Digits only — `stateFips` reaches here from user input via the state-name
  // lookup, so it can only ever be a table value, but the LIKE clause next to it
  // is escaped and this one should not be the weak link.
  const states = (typeof stateFips === "string" ? [stateFips] : (stateFips ?? [])).filter((fips) =>
    /^\d{2}$/.test(fips)
  );
  if (hasStateField && states.length === 1) {
    clauses.push(`STATE='${states[0]}'`);
    if (countyFips && /^\d{3}$/.test(countyFips)) clauses.push(`COUNTY='${countyFips}'`);
  } else if (hasStateField && states.length > 1) {
    clauses.push(`STATE IN (${states.map((fips) => `'${fips}'`).join(",")})`);
  }
  if (layerWhere) clauses.push(`(${layerWhere})`);

  const params = new URLSearchParams({
    where: clauses.join(" AND "),
    outFields: outFields ?? (hasStateField ? "GEOID,NAME,BASENAME,STATE" : "GEOID,NAME,BASENAME"),
    returnGeometry: "false",
    orderByFields: "BASENAME",
    resultRecordCount: String(limit),
    f: "json",
  });
  return `${TIGERWEB_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * Population-only companion query against the 2020 vintage. Same LIKE predicate
 * as the search so the two result sets line up, but it returns just GEOID and
 * POP100 — it is a join table, not a second source of truth about what exists.
 */
export function buildPlacePopulationUrl(layerId: number, sanitizedLike: string, limit: number): string {
  const params = new URLSearchParams({
    where: nameLikeClause(sanitizedLike, true),
    outFields: "GEOID,POP100",
    returnGeometry: "false",
    orderByFields: "POP100 DESC",
    resultRecordCount: String(limit),
    f: "json",
  });
  return `${TIGERWEB_POPULATION_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * Build a GEOID -> population map from a companion query. A missing, malformed,
 * or negative value is simply absent from the map: unknown population must rank
 * as unknown, never as zero.
 */
export function parsePlacePopulationResponse(json: TigerQueryJson | null): Map<string, number> {
  const populations = new Map<string, number>();
  const features = json?.features;
  if (!Array.isArray(features)) return populations;

  for (const feature of features) {
    const attrs = feature.attributes ?? {};
    const geoid = attrs.GEOID != null ? String(attrs.GEOID) : "";
    if (!geoid) continue;

    // `Number(null)` is 0, not NaN — and the Current CBSA layers really do
    // answer `POP100: null`. Without this guard an unknown population would be
    // recorded as a real zero and sort dead last among knowns instead of being
    // treated as unknown.
    const raw = attrs.POP100;
    if (raw === null || raw === undefined || raw === "") continue;

    const population = Number(raw);
    if (!Number.isFinite(population) || population < 0) continue;
    populations.set(geoid, population);
  }
  return populations;
}

export function buildPlaceBoundaryUrl(
  layerId: number,
  geoid: string,
  outFields = "GEOID,NAME,BASENAME"
): string {
  const params = new URLSearchParams({
    where: `GEOID='${geoid}'`,
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    // ~0.1m precision. Four decimal places made otherwise-valid TIGERweb
    // boundaries self-intersect after rounding, so a place could be saved and
    // displayed but then be rejected by the exact PostGIS modeling guard.
    geometryPrecision: "6",
    f: "geojson",
  });
  return `${TIGERWEB_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * Every state an AIANNH area lies in, in Census order, from its AIANNHFP1-3
 * fields ("04-48845" is Arizona). Empty when the fields are absent or
 * malformed: an unknown state list stays unknown, it is never filled in.
 */
export function aiannhStateFips(attrs: Record<string, unknown> | null | undefined): string[] {
  const states: string[] = [];
  for (const field of ["AIANNHFP1", "AIANNHFP2", "AIANNHFP3"]) {
    const value = attrs?.[field];
    if (typeof value !== "string") continue;
    const matched = /^(\d{2})-\d{5}$/.exec(value.trim());
    if (!matched || !stateUspsFromFips(matched[1])) continue;
    if (!states.includes(matched[1])) states.push(matched[1]);
  }
  return states;
}

/**
 * "Navajo Nation Reservation, AZ-NM-UT". The states follow the name the way a
 * multi-state CBSA's do ("Columbus, GA-AL"); with no readable state the name
 * stands alone rather than borrowing one.
 */
function aiannhLabel(name: string, stateFipsList: string[]): string {
  const usps = stateFipsList.map((fips) => stateUspsFromFips(fips)).filter((code): code is string => !!code);
  return usps.length > 0 ? `${name}, ${usps.join("-")}` : name;
}

/**
 * "Washington township, Montgomery County, OH". Many states repeat a township
 * name dozens of times, so the county is what tells two apart. Without a county
 * name the label still names the state, never a guessed county.
 */
function cousubLabel(name: string, geoid: string, countyNames?: Map<string, string>): string {
  const usps = stateUspsFromFips(geoid.slice(0, 2));
  const county = countyNames?.get(geoid.slice(0, 5)) ?? null;
  return [name, county, usps].filter((part): part is string => !!part).join(", ");
}

/**
 * Parse a TIGERweb attribute query response into ranked place results. `kind`
 * must match the layer queried (city/cdp = places, metro/micro = CBSAs,
 * aiannh = one of the AIANNH layers, cousub = county subdivisions).
 */
export function parsePlaceSearchResponse(
  json: TigerQueryJson | null,
  kind: PlaceKind,
  populations?: Map<string, number>,
  countyNames?: Map<string, string>
): RankedPlace[] {
  const features = json?.features;
  if (!Array.isArray(features)) return [];

  const results: RankedPlace[] = [];
  for (const feature of features) {
    const attrs = feature.attributes ?? {};
    const geoid = attrs.GEOID != null ? String(attrs.GEOID) : "";
    if (!geoid) continue;

    const basename = String(attrs.BASENAME ?? attrs.NAME ?? "").trim();
    if (!basename) continue;

    const population = populations?.get(geoid) ?? null;
    const nameKey = String(attrs.NAME ?? basename).trim().toLowerCase();

    if (kind === "aiannh" || kind === "cousub") {
      // A reference the resolver would refuse is not a result.
      if (!normalizePlaceGeoid(kind, geoid)) continue;
      const name = String(attrs.NAME ?? basename).trim();
      if (kind === "aiannh") {
        const states = aiannhStateFips(attrs as Record<string, unknown>);
        results.push({
          kind,
          geoid,
          label: aiannhLabel(name, states),
          description: KIND_DESCRIPTION[kind],
          // One state only when Census lists exactly one. The Navajo Nation
          // lists three, and naming the first would be a guess.
          stateFips: states.length === 1 ? states[0] : null,
          sortKey: basename.toLowerCase(),
          nameKey,
          population,
          coveredStateFips: states,
        });
      } else {
        results.push({
          kind,
          geoid,
          label: cousubLabel(name, geoid, countyNames),
          description: KIND_DESCRIPTION[kind],
          stateFips: geoid.slice(0, 2),
          sortKey: basename.toLowerCase(),
          nameKey,
          population,
        });
      }
      continue;
    }

    if (kind === "metro" || kind === "micro") {
      // CBSA layers carry a fully-formed NAME ("Reno, NV Metro Area") and no
      // STATE. Their BASENAME already ends in the state(s) — "Columbus, OH" —
      // which is why they are ranked against the caller's full query too.
      const label = String(attrs.NAME ?? basename).trim();
      results.push({
        kind,
        geoid,
        label,
        description: KIND_DESCRIPTION[kind],
        stateFips: null,
        sortKey: basename.toLowerCase(),
        nameKey,
        population,
      });
      continue;
    }

    const stateFips = attrs.STATE != null ? String(attrs.STATE) : null;
    const usps = stateUspsFromFips(stateFips);
    const label = usps ? `${basename}, ${usps}` : basename;
    results.push({
      kind,
      geoid,
      label,
      description: KIND_DESCRIPTION[kind],
      stateFips,
      sortKey: basename.toLowerCase(),
      nameKey,
      population,
    });
  }
  return results;
}

export function scorePlaceMatch(sortKey: string, queryLower: string): number {
  if (!queryLower) return 0;
  if (sortKey === queryLower) return 1000;
  if (sortKey.startsWith(queryLower)) return 800;
  if (sortKey.includes(queryLower)) return 400;
  return 100; // matched the LIKE server-side but not on the clean base name
}

/**
 * The NAME tier: below an exact or prefix match on the clean base name (1000,
 * 800), above a base name that only contains the query (400) and above a row
 * that matched nothing the planner can see (100). Zero when NAME does not
 * start with the query, so the base-name score decides.
 */
function scoreNameMatch(nameKey: string, queryLower: string): number {
  if (!queryLower) return 0;
  if (nameKey === queryLower) return 700;
  if (nameKey.startsWith(queryLower)) return 600;
  return 0;
}

interface ParsedPlaceQuery {
  /** The text matched against the start of BASENAME and of NAME. */
  name: string;
  /** Every state the query named, in its order. Empty when it named none. */
  stateFips: string[];
  /**
   * A possible county qualifier, as in the town and township label "Washington
   * township, Shelby County, OH". Only offered with exactly one state, and only
   * a candidate: `searchPlaces` uses it when the county catalog holds a county
   * with exactly that name in that state, and otherwise searches `name` whole.
   */
  county: { placeName: string; countyName: string } | null;
}

/**
 * Read the qualifiers off a place query, so that every label search shows can
 * be typed back in:
 * - one state, by abbreviation or name: "Pyramid Lake Paiute Reservation, NV";
 * - a hyphenated list of state abbreviations, as tribal area labels write a
 *   multi-state area: "Navajo Nation Reservation, AZ-NM-UT";
 * - a county between the name and the state: "Lexington town, Middlesex
 *   County, MA".
 * A trailing fragment that names no state stays part of the name ("Lake,
 * Charles"), as `splitStateQualifier` requires.
 */
function parsePlaceQuery(trimmed: string): ParsedPlaceQuery {
  const single = splitStateQualifier(trimmed);
  let name = single.name;
  let stateFips = single.stateFips ? [single.stateFips] : [];

  if (stateFips.length === 0) {
    const commaIndex = trimmed.lastIndexOf(",");
    const head = commaIndex === -1 ? "" : trimmed.slice(0, commaIndex).trim();
    const tail = commaIndex === -1 ? "" : trimmed.slice(commaIndex + 1).trim();
    if (head && /^[A-Za-z]{2}(?:-[A-Za-z]{2})+$/.test(tail)) {
      const listed = tail.split("-").map((usps) => stateFipsFromUsps(usps));
      if (listed.every((fips): fips is string => !!fips)) {
        name = head;
        stateFips = [...new Set(listed)];
      }
    }
  }

  let county: ParsedPlaceQuery["county"] = null;
  if (stateFips.length === 1) {
    const commaIndex = name.lastIndexOf(",");
    if (commaIndex !== -1) {
      const placeName = name.slice(0, commaIndex).trim();
      const countyName = name.slice(commaIndex + 1).trim();
      if (placeName && countyName) county = { placeName, countyName };
    }
  }

  return { name, stateFips, county };
}

/**
 * The county a county qualifier names, or null. Exact label match only
 * ("Shelby County, OH"), from the same catalog county search uses: a fragment
 * that is not a county's full name is not a county qualifier.
 */
async function resolveCountyQualifier(countyName: string, stateFips: string): Promise<string | null> {
  const usps = stateUspsFromFips(stateFips);
  if (!usps) return null;
  const wanted = `${countyName}, ${usps}`.replace(/\s+/g, " ").toLowerCase();
  const outcome = await searchUsCounties(`${countyName}, ${usps}`, 20).catch(() => null);
  const match = outcome?.items.find((item) => item.geographyLabel.replace(/\s+/g, " ").toLowerCase() === wanted);
  return match && match.geographyId.slice(0, 2) === stateFips ? match.geographyId : null;
}

/**
 * Extract the first Polygon/MultiPolygon from a TIGERweb GeoJSON response and
 * validate it as a corridor geometry. Returns null if absent or malformed.
 */
export function extractCorridorFromGeojson(json: TigerGeojson | null): CorridorGeojson | null {
  const feature = json?.features?.[0];
  if (!feature?.geometry) return null;
  const parsed = corridorGeojsonSchema.safeParse(feature.geometry);
  return parsed.success ? parsed.data : null;
}

function labelFromBoundaryGeojson(
  json: TigerGeojson | null,
  kind: PlaceKind,
  countyNames?: Map<string, string>
): string | null {
  const props = json?.features?.[0]?.properties;
  if (!props) return null;
  if (kind === "aiannh" || kind === "cousub") {
    const name = typeof props.NAME === "string" ? props.NAME.trim() : "";
    const geoid = typeof props.GEOID === "string" ? props.GEOID : "";
    if (!name) return null;
    return kind === "aiannh" ? aiannhLabel(name, aiannhStateFips(props)) : cousubLabel(name, geoid, countyNames);
  }
  if (kind === "metro" || kind === "micro") {
    return typeof props.NAME === "string" ? props.NAME : null;
  }
  if (kind === "county") {
    // The full NAME, as county search labels it: "Richmond city, VA" and
    // "Richmond County, VA" are different places, and BASENAME calls both
    // "Richmond".
    const name = [props.NAME, props.BASENAME]
      .find((value): value is string => typeof value === "string" && !!value.trim())
      ?.trim();
    if (!name) return null;
    const usps = stateUspsFromFips(String(props.GEOID ?? ""));
    return usps ? `${name}, ${usps}` : name;
  }
  const basename = typeof props.BASENAME === "string" ? props.BASENAME : null;
  return basename ?? (typeof props.NAME === "string" ? props.NAME : null);
}

async function fetchTigerSearch(options: PlaceSearchUrlOptions): Promise<TigerQueryJson | null> {
  const { layerId, sanitizedLike, limit, stateFips = null, countyFips = null, matchName = true } = options;
  const states = typeof stateFips === "string" ? stateFips : (stateFips ?? []).join("-") || "all";
  return fetchJsonWithRetry<TigerQueryJson>(buildPlaceSearchUrl(options), undefined, {
    timeoutMs: 8000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    // Every filter is part of the query, so it must be part of the key.
    // Otherwise a state-qualified search would serve the unfiltered answer.
    cacheKey: `tigerweb:search:${layerId}:${sanitizedLike.toLowerCase()}:${limit}:${states}:${countyFips ?? "any"}:${matchName ? "name" : "basename"}`,
  });
}

/**
 * One layer's candidates, matched on BASENAME or NAME, without losing any row
 * the BASENAME-only search would have returned.
 *
 * WHY THE SECOND REQUEST. The server sorts by BASENAME and stops at `limit`. A
 * NAME-only row has a BASENAME that does not start with the query, usually a
 * shorter one ("Pyramid Lake Paiute" for "Pyramid Lake Paiute Reservation"),
 * and a shorter BASENAME sorts first, so NAME-only rows can take places in a
 * full page that a BASENAME match held before. A page that is not full lost
 * nothing, and a full page with no NAME-only row is exactly the BASENAME-only
 * page. Only a full page that holds a NAME-only row asks again for BASENAME
 * alone, and keeps that answer plus the NAME-only rows it already has. If that
 * second request fails, the first answer stands: the layer did answer.
 */
async function fetchLayerCandidates(options: PlaceSearchUrlOptions): Promise<TigerQueryJson | null> {
  const json = await fetchTigerSearch(options);
  const features = json?.features;
  if (!Array.isArray(features) || features.length < options.limit) return json;

  const nameOnly = features.filter((feature) => isNameOnlyMatch(feature.attributes, options.sanitizedLike));
  if (nameOnly.length === 0) return json;

  const basenameOnly = await fetchTigerSearch({ ...options, matchName: false }).catch(() => null);
  if (!tigerLayerAnswered(basenameOnly)) return json;

  const seen = new Set((basenameOnly?.features ?? []).map((feature) => String(feature.attributes?.GEOID ?? "")));
  return {
    features: [
      ...(basenameOnly?.features ?? []),
      ...nameOnly.filter((feature) => !seen.has(String(feature.attributes?.GEOID ?? ""))),
    ],
  };
}

/**
 * County names for county subdivision labels, from the Counties layer of the
 * same Current service. The keys are 5-digit county GEOIDs cut from cousub
 * GEOIDs the service itself returned; anything else is dropped, so no typed
 * text reaches this where clause.
 */
function buildCountyNamesUrl(countyGeoids: string[]): string {
  const list = countyGeoids.filter((geoid) => /^\d{5}$/.test(geoid));
  const params = new URLSearchParams({
    where: `GEOID IN (${list.map((geoid) => `'${geoid}'`).join(",")})`,
    outFields: "GEOID,NAME",
    returnGeometry: "false",
    resultRecordCount: String(Math.max(list.length, 1)),
    f: "json",
  });
  return `${TIGERWEB_BASE}/${LAYER.county}/query?${params.toString()}`;
}

/** County GEOID -> county name ("Johnson County", "Orleans Parish"). */
function parseCountyNamesResponse(json: TigerQueryJson | null): Map<string, string> {
  const names = new Map<string, string>();
  for (const feature of json?.features ?? []) {
    const geoid = feature.attributes?.GEOID != null ? String(feature.attributes.GEOID) : "";
    const name = String(feature.attributes?.NAME ?? "").trim();
    if (/^\d{5}$/.test(geoid) && name) names.set(geoid, name);
  }
  return names;
}

/**
 * Never throws and never reports unavailability: a county name only tells
 * same-named townships apart. Losing it shortens the label; it never removes a
 * result or changes which place a result is.
 */
async function fetchCountyNames(countyGeoids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(countyGeoids.filter((geoid) => /^\d{5}$/.test(geoid)))].sort();
  if (unique.length === 0) return new Map();
  const json = await fetchJsonWithRetry<TigerQueryJson>(buildCountyNamesUrl(unique), undefined, {
    timeoutMs: 8000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheKey: `tigerweb:county-names:${unique.join(",")}`,
  }).catch(() => null);
  return parseCountyNamesResponse(json);
}

/** County GEOIDs (first five digits) of the county subdivisions in a response. */
function cousubCountyGeoids(json: TigerQueryJson | null): string[] {
  return (json?.features ?? [])
    .map((feature) => String(feature.attributes?.GEOID ?? ""))
    .filter((geoid) => /^\d{10}$/.test(geoid))
    .map((geoid) => geoid.slice(0, 5));
}

/**
 * Fetch populations for a kind, or an empty map when that kind has no 2020
 * companion layer. Never throws and never reports unavailability: population is
 * a ranking refinement, so losing it must degrade the ORDER of results, never
 * the results themselves or the coverage report.
 */
async function fetchTigerPopulations(
  kind: PlaceKind,
  sanitizedLike: string,
  limit: number
): Promise<Map<string, number>> {
  const layerId = POPULATION_LAYER_BY_KIND[kind];
  if (layerId === undefined) return new Map();

  const json = await fetchJsonWithRetry<TigerQueryJson>(
    buildPlacePopulationUrl(layerId, sanitizedLike, limit),
    undefined,
    {
      timeoutMs: 8000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      cacheKey: `tigerweb:population:${layerId}:${sanitizedLike.toLowerCase()}:${limit}`,
    }
  ).catch(() => null);

  return parsePlacePopulationResponse(json);
}

/**
 * Did a TIGERweb layer actually answer?
 *
 * `null` is `fetchJsonWithRetry`'s single signal for timeout / non-OK status /
 * unparseable body. A 200 that carries no `features` array is also not an answer
 * — ArcGIS reports a rejected query that way, with an `error` object instead.
 * Anything else, including `{ features: [] }`, is a real "nothing matched".
 */
function tigerLayerAnswered(json: TigerQueryJson | null): boolean {
  return json !== null && Array.isArray(json.features);
}

const TIGERWEB_UNAVAILABLE_REASON =
  "The US Census TIGERweb boundary service did not respond, so place names could not be searched.";

/**
 * Search US places by name across counties, incorporated places, CDPs, county
 * subdivisions, AIANNH areas and metro/micro areas. Returns a ranked,
 * de-duplicated list plus the coverage of the search itself — see
 * `PlaceSearchOutcome` for why the second part matters.
 */
export async function searchPlaces(query: string, limit = 8): Promise<PlaceSearchOutcome> {
  const answered: PlaceSearchOutcome = {
    items: [],
    unavailableKinds: [],
    searchUnavailable: false,
    unavailableReason: null,
  };

  const trimmed = query.trim();
  if (trimmed.length < 2) return answered;

  // "Franklin County, OH" means the name AND the state. The LIKE predicate runs
  // against the bare name, since TIGERweb BASENAMEs for counties and places
  // carry no state, while the state becomes a real filter. A hyphenated state list and
  // a township's county are read the same way, so every label search shows
  // finds its place again (see `parsePlaceQuery`).
  const parsed = parsePlaceQuery(trimmed);
  const bareQuery = parsed.name;
  const qualifiedStates = parsed.stateFips;
  const qualifiedStateFips = qualifiedStates.length === 1 ? qualifiedStates[0] : null;

  // "Washington township, Shelby County, OH": search "Washington township" in
  // that county, when the catalog holds a county named exactly that.
  const countyGeoid =
    parsed.county && qualifiedStateFips
      ? await resolveCountyQualifier(parsed.county.countyName, qualifiedStateFips)
      : null;
  const searchName = countyGeoid && parsed.county ? parsed.county.placeName : bareQuery;

  const like = sanitizeLikeQuery(searchName);
  if (!like) return answered;

  const perLayer = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 8, 1), 20);
  const pool = Math.max(CANDIDATE_POOL_PER_LAYER, perLayer);
  const queryForms = [...new Set([trimmed, bareQuery, searchName].map((form) => form.toLowerCase()))];

  // `.catch` guards remain because these are network calls; they are belt to the
  // braces of the `null` contract, not the primary failure signal.
  const [
    countyOutcome,
    cityJson,
    cdpJson,
    metroJson,
    microJson,
    cousubJson,
    aiannhJsons,
    cityPopulations,
    cdpPopulations,
    metroPopulations,
    microPopulations,
    cousubPopulations,
  ] = await Promise.all([
    searchUsCounties(trimmed, pool).catch(() => null),
    fetchLayerCandidates({
      layerId: LAYER.incorporatedPlace,
      sanitizedLike: like,
      limit: pool,
      hasStateField: true,
      stateFips: qualifiedStates,
    }).catch(() => null),
    fetchLayerCandidates({
      layerId: LAYER.censusDesignatedPlace,
      sanitizedLike: like,
      limit: pool,
      hasStateField: true,
      stateFips: qualifiedStates,
    }).catch(() => null),
    fetchLayerCandidates({
      layerId: LAYER.metro,
      sanitizedLike: like,
      limit: pool,
      hasStateField: false,
    }).catch(() => null),
    fetchLayerCandidates({
      layerId: LAYER.micro,
      sanitizedLike: like,
      limit: pool,
      hasStateField: false,
    }).catch(() => null),
    fetchLayerCandidates({
      layerId: LAYER.countySubdivision,
      sanitizedLike: like,
      limit: pool,
      hasStateField: true,
      stateFips: qualifiedStates,
      countyFips: countyGeoid ? countyGeoid.slice(2) : null,
      outFields: COUSUB_OUT_FIELDS,
      layerWhere: COUSUB_SEARCH_WHERE,
    }).catch(() => null),
    // AIANNH layers carry no STATE field, so a state-qualified query is
    // narrowed after parsing, against each area's own state list.
    Promise.all(
      AIANNH_LAYERS.map((layerId) =>
        fetchLayerCandidates({
          layerId,
          sanitizedLike: like,
          limit: pool,
          hasStateField: false,
          outFields: AIANNH_OUT_FIELDS,
        }).catch(() => null)
      )
    ),
    fetchTigerPopulations("city", like, pool),
    fetchTigerPopulations("cdp", like, pool),
    fetchTigerPopulations("metro", like, pool),
    fetchTigerPopulations("micro", like, pool),
    fetchTigerPopulations("cousub", like, pool),
  ]);

  // Second step, only when a town or township matched: its label needs the
  // county name, which is what tells same-named townships apart.
  const cousubCountyNames = await fetchCountyNames(cousubCountyGeoids(cousubJson));

  const unavailableKinds: PlaceKind[] = [];
  let countyReason: string | null = null;

  if (countyOutcome === null || countyOutcome.availability === "unavailable") {
    unavailableKinds.push("county");
    countyReason = countyOutcome?.unavailableReason ?? TIGERWEB_UNAVAILABLE_REASON;
  }
  if (!tigerLayerAnswered(cityJson)) unavailableKinds.push("city");
  if (!tigerLayerAnswered(cdpJson)) unavailableKinds.push("cdp");
  if (!tigerLayerAnswered(metroJson)) unavailableKinds.push("metro");
  if (!tigerLayerAnswered(microJson)) unavailableKinds.push("micro");
  if (!tigerLayerAnswered(cousubJson)) unavailableKinds.push("cousub");
  // One unanswered AIANNH layer makes the tribal-area results incomplete, so
  // the kind is reported unavailable even though the other layers' matches are
  // still returned.
  if (!aiannhJsons.every(tigerLayerAnswered)) unavailableKinds.push("aiannh");

  const counties = countyOutcome?.items ?? [];

  const countyResults: RankedPlace[] = counties.map((county) => ({
    kind: "county" as const,
    geoid: county.geographyId,
    label: county.geographyLabel,
    description: KIND_DESCRIPTION.county,
    stateFips: county.geographyId.slice(0, 2),
    // Rank counties on their bare name (strip a trailing ", XX").
    sortKey: county.geographyLabel.replace(/,\s*[A-Z]{2}$/, "").toLowerCase(),
    // A county's sort key already is its full NAME ("sierra county").
    nameKey: county.geographyLabel.replace(/,\s*[A-Z]{2}$/, "").toLowerCase(),
    // Normalized to null rather than trusted: an absent value must compare as
    // "unknown", because `undefined - number` is NaN and a comparator that
    // returns NaN silently corrupts the whole sort order.
    population: county.population ?? null,
  }));

  const all: RankedPlace[] = [
    ...countyResults,
    ...parsePlaceSearchResponse(cityJson, "city", cityPopulations),
    ...parsePlaceSearchResponse(cdpJson, "cdp", cdpPopulations),
    ...parsePlaceSearchResponse(metroJson, "metro", metroPopulations),
    ...parsePlaceSearchResponse(microJson, "micro", microPopulations),
    ...parsePlaceSearchResponse(cousubJson, "cousub", cousubPopulations, cousubCountyNames),
    ...aiannhJsons
      .flatMap((json) => parsePlaceSearchResponse(json, "aiannh"))
      // Every state the query named must be one the area lies in.
      .filter((place) => qualifiedStates.every((fips) => !!place.coveredStateFips?.includes(fips))),
  ];

  const seen = new Set<string>();
  const items = all
    .map((place) => ({
      place,
      // Two label conventions coexist here: county and place sort keys are bare
      // names ("columbus"), while a CBSA's is "columbus, oh". Scoring against
      // every form of the query and keeping the best lets "Columbus, OH" match
      // the metro area exactly without penalizing the city, and needs no
      // per-kind branching that would drift as kinds are added. The NAME tier
      // ranks a match on the full Census name below a base-name match.
      score: Math.max(
        ...queryForms.map((form) => Math.max(scorePlaceMatch(place.sortKey, form), scoreNameMatch(place.nameKey, form)))
      ),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      // Population breaks ties between equally good name matches, and nothing
      // more: it can never lift a weaker match above a stronger one. Unknown
      // population sorts last, then alphabetically, so ordering stays stable
      // whether or not the 2020 companion layer answered.
      const leftPopulation = left.place.population;
      const rightPopulation = right.place.population;
      if (leftPopulation !== rightPopulation) {
        if (leftPopulation === null) return 1;
        if (rightPopulation === null) return -1;
        return rightPopulation - leftPopulation;
      }
      return left.place.label.localeCompare(right.place.label);
    })
    .filter(({ place }) => {
      const key = `${place.kind}:${place.geoid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, perLayer)
    .map(({ place }) => ({
      kind: place.kind,
      geoid: place.geoid,
      label: place.label,
      description: place.description,
      stateFips: place.stateFips,
    }));

  const searchUnavailable = unavailableKinds.length === ALL_PLACE_KINDS.length;

  /*
    "Reno NV" — the comma-less form — found nothing until this existed.

    `splitStateQualifier` reads ", XX" and nothing else, so a query written the
    way people usually type it reached TIGERweb as `LIKE 'RENO NV%'` and matched
    no place in the country. The picker then told a planner searching for their
    own city that there were no results, which is the one thing the study-area
    front door must never say about a place that exists.

    It is retried rather than parsed up front because a space is not a
    separator — see `splitTrailingStateWords`. Retrying only on a genuinely
    empty result means this can add the missing answer but can never displace a
    correct one. The rewritten query carries a comma, so the retry cannot
    recurse a second time.
  */
  if (items.length === 0 && !searchUnavailable) {
    const spaced = splitTrailingStateWords(trimmed);
    const usps = stateUspsFromFips(spaced.stateFips);
    if (spaced.stateFips && usps && spaced.name) {
      const retried = await searchPlaces(`${spaced.name}, ${usps}`, limit);
      if (retried.items.length > 0) {
        return { ...retried, unavailableKinds, searchUnavailable };
      }
    }
  }

  return {
    items,
    unavailableKinds,
    searchUnavailable,
    // Prefer the county cause: it names which layer did not answer.
    unavailableReason:
      unavailableKinds.length === 0 ? null : (countyReason ?? TIGERWEB_UNAVAILABLE_REASON),
  };
}

/** Fetch one layer's boundary for a GEOID that has already been validated. */
function fetchTigerBoundary(layerId: number, geoid: string, outFields?: string): Promise<TigerGeojson | null> {
  return fetchJsonWithRetry<TigerGeojson>(buildPlaceBoundaryUrl(layerId, geoid, outFields), undefined, {
    timeoutMs: 15000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheKey: `tigerweb:boundary:${layerId}:${geoid}`,
  });
}

/**
 * The one AIANNH layer response that holds this GEOID, or null.
 *
 * The stored reference is the Census GEOID alone, which does not say which of
 * the nine layers holds it, so every layer is asked. Exactly one may answer
 * with a feature. Two would mean the GEOID is not unique after all, and
 * picking either would be a guess, so that is refused too.
 */
async function fetchAiannhBoundary(geoid: string): Promise<TigerGeojson | null> {
  const responses = await Promise.all(
    AIANNH_LAYERS.map((layerId) => fetchTigerBoundary(layerId, geoid, AIANNH_OUT_FIELDS).catch(() => null))
  );
  const found = responses.filter((json) => (json?.features?.length ?? 0) > 0);
  return found.length === 1 ? found[0] : null;
}

/**
 * Resolve a place to its official TIGERweb boundary polygon (WGS84), validated
 * as a corridor geometry, with a bounding box. Returns null if the GEOID is
 * malformed for its kind or no boundary is found.
 */
export async function resolvePlaceBoundary(kind: PlaceKind, geoid: string): Promise<ResolvedBoundary | null> {
  const cleanGeoid = normalizePlaceGeoid(kind, geoid);
  if (!cleanGeoid) return null;

  const json =
    kind === "aiannh"
      ? await fetchAiannhBoundary(cleanGeoid)
      : await fetchTigerBoundary(
          LAYERS_BY_KIND[kind][0],
          cleanGeoid,
          kind === "cousub" ? COUSUB_OUT_FIELDS : undefined
        );

  const geojson = extractCorridorFromGeojson(json);
  if (!geojson) return null;

  // A boundary with no usable coordinates is not a resolved place. Returning it
  // with a substituted bbox would hand the caller someone else's geography.
  const bbox = bboxFromGeojson(geojson);
  if (!bbox) return null;

  const countyNames = kind === "cousub" ? await fetchCountyNames([cleanGeoid.slice(0, 5)]) : undefined;

  return {
    kind,
    geoid: cleanGeoid,
    label: labelFromBoundaryGeojson(json, kind, countyNames),
    geojson,
    bbox,
  };
}
