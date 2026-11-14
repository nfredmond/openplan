import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import {
  buildCountyPrefix,
  buildCountySuggestedRunName,
  buildCountySlug,
  normalizeCountySearchText,
  STATE_ABBREVIATIONS,
} from "@/lib/geographies/county-utils";
import { splitStateQualifier, stateUspsFromFips } from "@/lib/geographies/state-fips";
import {
  TIGERWEB_CENSUS2020_BASE,
  TIGERWEB_CENSUS2020_COUNTY_LAYER,
  TIGERWEB_CURRENT_BASE,
  TIGERWEB_CURRENT_COUNTY_LAYER,
} from "@/lib/geographies/tigerweb-services";

/*
  WHERE THE COUNTY CATALOG COMES FROM, AND WHY IT NEEDS NO KEY.

  The catalog is every county and county equivalent on TIGERweb's Counties
  layer (tigerWMS_Current, layer 82): 3,235 rows on 2026-11-01, covering the
  fifty states, DC, Puerto Rico's municipios and the four Island Areas. That is
  the same service, vintage and layer the boundary lookup in `place-resolver`
  already uses, so a county that search offers is a county whose boundary
  resolves. TIGERweb needs no API key.

  It used to come from the ACS 5-year API (api.census.gov), which answers a
  request without a key with a redirect to an HTML page. An install without
  CENSUS_API_KEY could not search counties at all, while every other place kind
  worked. That API gave nothing county search needs that TIGERweb lacks: the
  GEOID, the full name with its "County", "Parish", "Borough", "Census Area",
  "Municipio" or "city" suffix, and the state are all layer fields, and the
  bbox comes from the boundary itself. Its one extra was a 2023 population
  estimate, used only to order same-named counties, so it is replaced by the
  2020 Census count from TIGERweb's own 2020 service (POP100), the source the
  place resolver already uses for cities and CDPs. One source, not two.

  Known cost: the 2020 vintage predates Connecticut's nine planning regions, so
  those rank as unknown population. Their names are unique, so a tie they would
  need to break does not arise.
*/

/** Fields the catalog needs. Field names read from .../MapServer/82?f=json on 2026-11-01. */
const CATALOG_OUT_FIELDS = "GEOID,NAME,STATE";
const POPULATION_OUT_FIELDS = "GEOID,POP100";

/**
 * The layer answers up to 100,000 rows a request today, so one page holds the
 * whole country. Paging covers a later, lower server limit. A catalog still
 * incomplete after this many pages is reported unavailable, not served short:
 * a county missing from a short list would look like a county that does not
 * exist.
 */
const MAX_CATALOG_PAGES = 10;

const CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CountySearchItem {
  geographyId: string;
  geographyLabel: string;
  countyPrefix: string;
  countySlug: string;
  suggestedRunName: string;
  /**
   * Total population, or null when unknown. Exposed so a caller that merges
   * counties with other geography kinds — the place resolver — can break ties
   * on the same basis this module already uses internally. It is deliberately
   * NOT part of `countyGeographySearchResponseSchema`: it is a ranking input,
   * not something any client renders.
   */
  population: number | null;
}

interface CountyCatalogRow extends Omit<CountySearchItem, "population"> {
  searchText: string;
}

interface TigerCountyAttributes {
  GEOID?: string | number;
  NAME?: string;
  STATE?: string | number;
  POP100?: number | string | null;
}

interface TigerCountyPage {
  features?: Array<{ attributes?: TigerCountyAttributes }>;
  exceededTransferLimit?: boolean;
}

/**
 * Whether the catalog could be read at all.
 *
 * `unavailable` is NOT "no counties matched" — it means the question was never
 * answered, so the caller must say so rather than render an empty list. The two
 * are indistinguishable downstream unless they are kept apart here.
 */
export type CountyCatalogAvailability = "ok" | "unavailable";

export interface CountySearchOutcome {
  items: CountySearchItem[];
  availability: CountyCatalogAvailability;
  /** The most specific knowable cause, in planner terms. Null when available. */
  unavailableReason: string | null;
}

const COUNTY_CATALOG_UNAVAILABLE_REASON =
  "The US Census TIGERweb county layer did not respond, so county names could not be searched.";

/** USPS code -> state or territory name ("OH" -> "Ohio"), for search text. */
const STATE_NAME_BY_USPS: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREVIATIONS).map(([name, usps]) => [usps, name])
);

/**
 * One page of a whole-layer attribute query. Ordered by GEOID so that pages
 * are stable and an offset means the same row on every request.
 */
function buildCountyLayerUrl(base: string, layerId: number, outFields: string, offset: number): string {
  const params = new URLSearchParams({
    where: "1=1",
    outFields,
    returnGeometry: "false",
    orderByFields: "GEOID",
    resultOffset: String(Math.max(0, Math.trunc(offset))),
    f: "json",
  });
  return `${base}/${layerId}/query?${params.toString()}`;
}

/**
 * Every row of a counties layer, or null when the layer did not answer in
 * full. `fetchJsonWithRetry` returns null for a timeout, a non-OK status or a
 * body that would not parse; ArcGIS reports a rejected query as a 200 with an
 * `error` object and no `features`. Both are "not answered".
 */
async function fetchWholeCountyLayer(
  base: string,
  layerId: number,
  outFields: string,
  cacheKeyPrefix: string,
  retries: number
): Promise<TigerCountyAttributes[] | null> {
  const rows: TigerCountyAttributes[] = [];
  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const offset = rows.length;
    const json = await fetchJsonWithRetry<TigerCountyPage>(
      buildCountyLayerUrl(base, layerId, outFields, offset),
      undefined,
      {
        timeoutMs: 15000,
        retries,
        cacheTtlMs: CATALOG_CACHE_TTL_MS,
        cacheKey: `${cacheKeyPrefix}:${offset}`,
      }
    ).catch(() => null);

    if (json === null || !Array.isArray(json.features)) return null;
    rows.push(...json.features.map((feature) => feature.attributes ?? {}));
    if (json.exceededTransferLimit !== true) return rows;
    // "More rows exist" with none on this page would page forever.
    if (json.features.length === 0) return null;
  }
  return null;
}

/**
 * Catalog rows from the Current Counties layer. Null when nothing usable came
 * back: an answered query for every county that names none is a broken answer,
 * not an empty country.
 */
function parseCountyCatalog(attributes: TigerCountyAttributes[]): CountyCatalogRow[] | null {
  const rows = attributes.flatMap((attrs) => {
    const geographyId = attrs.GEOID != null ? String(attrs.GEOID).trim() : "";
    const name = String(attrs.NAME ?? "").trim();
    if (!/^\d{5}$/.test(geographyId) || !name) return [];

    // The state comes from the GEOID, the identity every other surface keys on.
    // An unknown state code leaves the label as the bare name, never a guess.
    const usps = stateUspsFromFips(geographyId.slice(0, 2));
    const stateName = usps ? STATE_NAME_BY_USPS[usps] ?? null : null;
    const geographyLabel = usps ? `${name}, ${usps}` : name;
    const countyPrefix = buildCountyPrefix(geographyLabel, geographyId);

    return [
      {
        geographyId,
        geographyLabel,
        countyPrefix,
        countySlug: buildCountySlug(geographyLabel, geographyId),
        suggestedRunName: buildCountySuggestedRunName(geographyLabel, geographyId),
        searchText: normalizeCountySearchText(
          `${geographyLabel} ${stateName ? `${name}, ${stateName}` : name} ${geographyId} ${countyPrefix}`
        ),
      },
    ];
  });
  return rows.length > 0 ? rows : null;
}

/**
 * GEOID -> 2020 population. A missing, null or negative value is left out:
 * unknown population ranks as unknown, never as zero (`Number(null)` is 0).
 */
function parseCountyPopulations(attributes: TigerCountyAttributes[]): Map<string, number> {
  const populations = new Map<string, number>();
  for (const attrs of attributes) {
    const geoid = attrs.GEOID != null ? String(attrs.GEOID).trim() : "";
    const raw = attrs.POP100;
    if (!/^\d{5}$/.test(geoid) || raw === null || raw === undefined || raw === "") continue;
    const population = Number(raw);
    if (Number.isFinite(population) && population >= 0) populations.set(geoid, population);
  }
  return populations;
}

let countyCatalogPromise: Promise<CountyCatalogRow[] | null> | null = null;
let countyPopulationPromise: Promise<Map<string, number>> | null = null;

/**
 * Load the catalog once per process, but NEVER memoize a failure: one outage
 * must not pin "no US county exists" for the life of the instance. A success
 * is held, and the HTTP layer keeps its own 24-hour entry per page.
 */
async function getCountyCatalog(): Promise<CountyCatalogRow[] | null> {
  if (countyCatalogPromise) return countyCatalogPromise;

  const attempt = fetchWholeCountyLayer(
    TIGERWEB_CURRENT_BASE,
    TIGERWEB_CURRENT_COUNTY_LAYER,
    CATALOG_OUT_FIELDS,
    "tigerweb:county-catalog:v1",
    1
  ).then((rows) => (rows === null ? null : parseCountyCatalog(rows)));

  countyCatalogPromise = attempt;
  const resolved = await attempt.catch(() => null);
  if (resolved === null) countyCatalogPromise = null;
  return resolved;
}

/**
 * Populations for ranking ties. Never throws and never makes the catalog
 * unavailable: losing it changes the order of equal matches, nothing else.
 * One try, no retry, so an optional field cannot double a slow first search.
 * An empty result is not memoized, so the next search asks again.
 */
async function getCountyPopulations(): Promise<Map<string, number>> {
  if (countyPopulationPromise) return countyPopulationPromise;

  const attempt = fetchWholeCountyLayer(
    TIGERWEB_CENSUS2020_BASE,
    TIGERWEB_CENSUS2020_COUNTY_LAYER,
    POPULATION_OUT_FIELDS,
    "tigerweb:county-population:v1",
    0
  )
    .then((rows) => (rows === null ? new Map<string, number>() : parseCountyPopulations(rows)))
    .catch(() => new Map<string, number>());

  countyPopulationPromise = attempt;
  const resolved = await attempt;
  if (resolved.size === 0) countyPopulationPromise = null;
  return resolved;
}

/** Drop the process-level memos so a test can exercise a fresh catalog load. */
export function __resetCountyCatalogForTests() {
  countyCatalogPromise = null;
  countyPopulationPromise = null;
}

function scoreCountyMatch(row: CountyCatalogRow, query: string): number {
  if (!query) return 0;
  if (row.geographyId === query) return 1000;
  if (row.geographyId.startsWith(query)) return 800;

  const label = normalizeCountySearchText(row.geographyLabel);
  if (label === query) return 700;
  if (label.startsWith(query)) return 650;

  const words = label.split(/\s+/);
  if (words.some((word) => word.startsWith(query))) return 500;
  if (row.searchText.includes(query)) return 300;

  return 0;
}

/**
 * Search the US county catalog.
 *
 * Returns an outcome rather than a bare list so a caller can tell "your query
 * matched no county" from "the catalog could not be read" — the distinction the
 * study-area picker has to render, and the one whose absence made county search
 * look empty instead of broken.
 */
export async function searchUsCounties(query: string, limit = 8): Promise<CountySearchOutcome> {
  // A trailing state qualifier ("Franklin County, OH") narrows the search
  // instead of being matched as literal text.
  const { name: bareQuery, stateFips } = splitStateQualifier(query);
  const normalizedQuery = normalizeCountySearchText(bareQuery);
  if (!normalizedQuery || (normalizedQuery.length < 2 && !/^\d{5}$/.test(normalizedQuery))) {
    return { items: [], availability: "ok", unavailableReason: null };
  }

  const boundedLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 8, 1), 20);
  const [counties, populations] = await Promise.all([getCountyCatalog(), getCountyPopulations()]);

  if (counties === null) {
    return { items: [], availability: "unavailable", unavailableReason: COUNTY_CATALOG_UNAVAILABLE_REASON };
  }

  const inScope = stateFips
    ? counties.filter((row) => row.geographyId.slice(0, 2) === stateFips)
    : counties;

  const items = inScope
    .map((row) => ({
      row,
      score: scoreCountyMatch(row, normalizedQuery),
      population: populations.get(row.geographyId) ?? null,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      // Population breaks ties WITHIN an equal match score only — it never
      // promotes a worse-matching county over a better-matching one. Unknown
      // population sorts after known, then alphabetically, so the order stays
      // deterministic whether or not the population layer answered.
      if (left.population !== right.population) {
        if (left.population === null) return 1;
        if (right.population === null) return -1;
        return right.population - left.population;
      }
      return left.row.geographyLabel.localeCompare(right.row.geographyLabel);
    })
    .slice(0, boundedLimit)
    .map((entry) => ({
      geographyId: entry.row.geographyId,
      geographyLabel: entry.row.geographyLabel,
      countyPrefix: entry.row.countyPrefix,
      countySlug: entry.row.countySlug,
      suggestedRunName: entry.row.suggestedRunName,
      population: entry.population,
    }));

  return { items, availability: "ok", unavailableReason: null };
}
