import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import {
  abbreviateCountyLabel,
  buildCountyPrefix,
  buildCountySuggestedRunName,
  buildCountySlug,
  normalizeCountySearchText,
} from "@/lib/geographies/county-utils";

const CENSUS_COUNTIES_URL = "https://api.census.gov/data/2023/acs/acs5?get=NAME&for=county:*";

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

let countyCatalogPromise: Promise<CountyCatalogRow[]> | null = null;

function parseCountyCatalog(rows: string[][] | null): CountyCatalogRow[] {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const header = rows[0] ?? [];
  const nameIndex = header.indexOf("NAME");
  const stateIndex = header.indexOf("state");
  const countyIndex = header.indexOf("county");
  if (nameIndex === -1 || stateIndex === -1 || countyIndex === -1) return [];

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

async function getCountyCatalog(): Promise<CountyCatalogRow[]> {
  if (!countyCatalogPromise) {
    countyCatalogPromise = fetchJsonWithRetry<string[][]>(CENSUS_COUNTIES_URL, undefined, {
      timeoutMs: 15000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      cacheKey: "us-counties-catalog:v1",
    }).then(parseCountyCatalog);
  }

  return countyCatalogPromise;
}

export async function listUsCounties(): Promise<CountySearchItem[]> {
  const counties = await getCountyCatalog();
  return counties.map((row) => ({
    geographyId: row.geographyId,
    geographyLabel: row.geographyLabel,
    countyPrefix: row.countyPrefix,
    countySlug: row.countySlug,
    suggestedRunName: row.suggestedRunName,
  }));
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

export async function searchUsCounties(query: string, limit = 8): Promise<CountySearchItem[]> {
  const normalizedQuery = normalizeCountySearchText(query);
  if (!normalizedQuery || (normalizedQuery.length < 2 && !/^\d{5}$/.test(normalizedQuery))) {
    return [];
  }

  const boundedLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 8, 1), 20);
  const counties = await getCountyCatalog();

  return counties
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
}
