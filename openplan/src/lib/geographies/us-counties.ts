import { censusApiKey, withCensusApiKey } from "@/lib/data-sources/census-api-key";
import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import {
  abbreviateCountyLabel,
  buildCountyPrefix,
  buildCountySuggestedRunName,
  buildCountySlug,
  normalizeCountySearchText,
} from "@/lib/geographies/county-utils";

const CENSUS_COUNTIES_ENDPOINT = "https://api.census.gov/data/2023/acs/acs5?get=NAME&for=county:*";

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
}

interface CountyCatalogRow extends CountySearchItem {
  searchText: string;
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
function parseCountyCatalog(rows: string[][] | null): CountyCatalogRow[] | null {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const header = rows[0] ?? [];
  const nameIndex = header.indexOf("NAME");
  const stateIndex = header.indexOf("state");
  const countyIndex = header.indexOf("county");
  if (nameIndex === -1 || stateIndex === -1 || countyIndex === -1) return null;

  return rows.slice(1).flatMap((row) => {
    const rawName = String(row[nameIndex] ?? "").trim();
    const state = String(row[stateIndex] ?? "").trim();
    const county = String(row[countyIndex] ?? "").trim();
    const geographyId = `${state}${county}`;
    if (!rawName || geographyId.length !== 5) return [];

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

  const attempt = fetchJsonWithRetry<string[][]>(censusCountiesUrl(), undefined, {
    timeoutMs: 15000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheKey: "us-counties-catalog:v1",
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
    : "County search needs a US Census API key, which this deployment has not configured.";
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
  const normalizedQuery = normalizeCountySearchText(query);
  if (!normalizedQuery || (normalizedQuery.length < 2 && !/^\d{5}$/.test(normalizedQuery))) {
    return { items: [], availability: "ok", unavailableReason: null };
  }

  const boundedLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 8, 1), 20);
  const counties = await getCountyCatalog();

  if (counties === null) {
    return { items: [], availability: "unavailable", unavailableReason: countyCatalogUnavailableReason() };
  }

  const items = counties
    .map((row) => ({ row, score: scoreCountyMatch(row, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.row.geographyLabel.localeCompare(right.row.geographyLabel);
    })
    .slice(0, boundedLimit)
    .map((entry) => ({
      geographyId: entry.row.geographyId,
      geographyLabel: entry.row.geographyLabel,
      countyPrefix: entry.row.countyPrefix,
      countySlug: entry.row.countySlug,
      suggestedRunName: entry.row.suggestedRunName,
    }));

  return { items, availability: "ok", unavailableReason: null };
}
