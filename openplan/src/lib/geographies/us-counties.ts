import { censusApiKey, withCensusApiKey } from "@/lib/data-sources/census-api-key";
import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import {
  abbreviateCountyLabel,
  buildCountyPrefix,
  buildCountySuggestedRunName,
  buildCountySlug,
  normalizeCountySearchText,
} from "@/lib/geographies/county-utils";
import { splitStateQualifier } from "@/lib/geographies/state-fips";

/**
 * `B01003_001E` is total population. It rides along on the catalog request that
 * already happens — same endpoint, same key, same 24h cache entry, no second
 * round trip — and exists solely to break ranking ties between counties that
 * share a name. Without it, ~25 counties named "Franklin" all scored
 * identically and were cut alphabetically at 8, so Ohio's (pop. 1.3M) was
 * discarded before any caller could see it.
 */
const CENSUS_COUNTIES_ENDPOINT =
  "https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E&for=county:*";

/**
 * The catalog URL, built at call time so the key is read from the environment
 * rather than frozen at import.
 *
 * It MUST carry the API key. Without one the Census API answers 302 -> an HTML
 * "missing key" page; the JSON parse then fails, the catalog resolves empty,
 * and county search returns nothing — which is what happened on every
 * deployment, including ones that had a key configured, because this URL was
 * hand-built without it.
 */
function censusCountiesUrl(): string {
  return withCensusApiKey(CENSUS_COUNTIES_ENDPOINT);
}

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

interface CountyCatalogRow extends CountySearchItem {
  searchText: string;
}

/**
 * A Census API tabular response. Cells are strings, EXCEPT that a suppressed or
 * unavailable estimate comes back as a JSON null — which is why this is not
 * `string[][]`, and why `Number(cell)` is never called without a null check
 * first (`Number(null)` is 0, not NaN).
 */
type CensusTable = Array<Array<string | null>>;

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
  /**
   * The most specific knowable cause, in planner terms. Null when available.
   * Never contains the key itself — only whether one is configured.
   */
  unavailableReason: string | null;
}

let countyCatalogPromise: Promise<CountyCatalogRow[] | null> | null = null;

/**
 * `null` means the response was absent or structurally not a Census catalog —
 * the two shapes a missing API key produces, since api.census.gov answers an
 * unauthenticated request with a 302 to an HTML page rather than an error.
 * An empty array is reserved for a well-formed answer that carried no rows.
 */
function parseCountyCatalog(rows: CensusTable | null): CountyCatalogRow[] | null {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const header = rows[0] ?? [];
  const nameIndex = header.indexOf("NAME");
  const stateIndex = header.indexOf("state");
  const countyIndex = header.indexOf("county");
  if (nameIndex === -1 || stateIndex === -1 || countyIndex === -1) return null;

  // Population is looked up by column NAME and is deliberately OPTIONAL: a
  // deployment pointed at a vintage that does not carry B01003_001E still gets
  // a working catalog, just without the population tiebreak. Ranking degrades;
  // county search does not break.
  const populationIndex = header.indexOf("B01003_001E");

  return rows.slice(1).flatMap((row) => {
    const rawName = String(row[nameIndex] ?? "").trim();
    const state = String(row[stateIndex] ?? "").trim();
    const county = String(row[countyIndex] ?? "").trim();
    const geographyId = `${state}${county}`;
    if (!rawName || geographyId.length !== 5) return [];

    // Two ways this reads as a real number when it is not: the Census API
    // reports suppressed estimates as negative sentinels (e.g. -666666666), and
    // `Number(null)` is 0 rather than NaN, so a null estimate would otherwise
    // become a county with a population of zero.
    const rawPopulation = populationIndex === -1 ? null : row[populationIndex];
    const parsedPopulation =
      rawPopulation === null || rawPopulation === undefined || rawPopulation === ""
        ? Number.NaN
        : Number(rawPopulation);
    const population =
      Number.isFinite(parsedPopulation) && parsedPopulation >= 0 ? parsedPopulation : null;

    const geographyLabel = abbreviateCountyLabel(rawName);
    const countyPrefix = buildCountyPrefix(geographyLabel, geographyId);
    const countySlug = buildCountySlug(geographyLabel, geographyId);
    const suggestedRunName = buildCountySuggestedRunName(geographyLabel, geographyId);

    return [
      {
        geographyId,
        geographyLabel,
        countyPrefix,
        countySlug,
        suggestedRunName,
        population,
        searchText: normalizeCountySearchText(`${geographyLabel} ${rawName} ${geographyId} ${countyPrefix}`),
      },
    ];
  });
}

/**
 * Load the catalog once per process, but NEVER memoize a failure.
 *
 * The previous version cached whatever the first call produced — so one outage,
 * or a key that had not been set yet when the process started, pinned "no US
 * county exists" for the lifetime of the instance. A failure now clears the
 * memo so the next search retries; a success is held (and the HTTP layer holds
 * its own 24h entry, so the retry is cheap once it lands).
 */
async function getCountyCatalog(): Promise<CountyCatalogRow[] | null> {
  if (countyCatalogPromise) return countyCatalogPromise;

  const attempt = fetchJsonWithRetry<CensusTable>(censusCountiesUrl(), undefined, {
    timeoutMs: 15000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    // v2 adds the population column. The key must change with the `get=` list,
    // or a warm v1 entry would keep serving population-less rows for 24h.
    cacheKey: "us-counties-catalog:v2",
  }).then(parseCountyCatalog);

  countyCatalogPromise = attempt;

  const resolved = await attempt.catch(() => null);
  if (resolved === null || resolved.length === 0) {
    countyCatalogPromise = null;
  }
  return resolved;
}

/**
 * Why the catalog could not be read. The missing-key case is knowable and
 * actionable, so it is named specifically instead of collapsing into a generic
 * outage — mirroring the consequence-not-variable-name convention in
 * `src/lib/config/deployment-health.ts`.
 */
function countyCatalogUnavailableReason(): string {
  return censusApiKey()
    ? "The US Census county catalog did not respond, so county names could not be searched."
    : "County search needs a US Census API key — set one for this deployment, or add your workspace's own key under Integration keys on the dashboard.";
}

/** Drop the process-level memo so a test can exercise a fresh catalog load. */
export function __resetCountyCatalogForTests() {
  countyCatalogPromise = null;
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
  // instead of being matched as literal text. Both call sites — the place
  // resolver and /api/geographies/counties — get this without passing anything.
  const { name: bareQuery, stateFips } = splitStateQualifier(query);
  const normalizedQuery = normalizeCountySearchText(bareQuery);
  if (!normalizedQuery || (normalizedQuery.length < 2 && !/^\d{5}$/.test(normalizedQuery))) {
    return { items: [], availability: "ok", unavailableReason: null };
  }

  const boundedLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 8, 1), 20);
  const counties = await getCountyCatalog();

  if (counties === null) {
    return { items: [], availability: "unavailable", unavailableReason: countyCatalogUnavailableReason() };
  }

  const inScope = stateFips
    ? counties.filter((row) => row.geographyId.slice(0, 2) === stateFips)
    : counties;

  const items = inScope
    .map((row) => ({ row, score: scoreCountyMatch(row, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      // Population breaks ties WITHIN an equal match score only — it never
      // promotes a worse-matching county over a better-matching one. Unknown
      // population sorts after known, then alphabetically, so the order stays
      // deterministic whatever the catalog vintage carried.
      const leftPopulation = left.row.population;
      const rightPopulation = right.row.population;
      if (leftPopulation !== rightPopulation) {
        if (leftPopulation === null) return 1;
        if (rightPopulation === null) return -1;
        return rightPopulation - leftPopulation;
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
      population: entry.row.population,
    }));

  return { items, availability: "ok", unavailableReason: null };
}
