/**
 * CCRS serious-injury enrichment — the KSI upgrade (Wave 8.1).
 *
 * WHY THIS EXISTS. `Crashes_*` carries only NumberKilled and NumberInjured, so
 * the base adapter can separate fatal / injury / PDO but not suspected serious
 * injury (KABCO A). That matters because SS4A and HSIP are built on KSI —
 * "killed or seriously injured" — and a safety module that cannot express KSI
 * cannot support the deliverable it exists for.
 *
 * The severity lives one table over, on `InjuredWitnessPassengers_YYYY`, one row
 * per injured person, joined to a crash by `CollisionId`. Verified value
 * distribution for 2025:
 *
 *     PossibleInjury           118,074   KABCO C
 *     SuspectMinor              81,092   KABCO B
 *     SuspectSerious            15,969   KABCO A  <-- serious
 *     ComplaintOfPainInactive   12,349   KABCO C (retired code)
 *     OtherVisibleInactive       4,399   KABCO B (retired code)
 *     Fatal                      3,294   KABCO K
 *     SevereInactive               990   KABCO A  <-- serious (retired code)
 *     (null)                   244,479   witnesses / uninjured passengers
 *
 * Both the current and retired spellings of KABCO A are treated as serious;
 * dropping the retired one would silently undercount older years.
 *
 * QUERY SHAPE. The injured table has no coordinates, so it cannot be filtered by
 * bounding box — a statewide pull would be ~17k serious-injury collisions per
 * year. Instead we ask only about the crashes we already stored, batched, which
 * for a county is a handful of requests per year.
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";

const CKAN_BASE = "https://data.ca.gov/api/3/action";
const CCRS_PACKAGE_ID = "ccrs";

/** KABCO A, current and retired spellings. */
export const CCRS_SERIOUS_INJURY_CODES = ["SuspectSerious", "SevereInactive"] as const;

/**
 * Collision ids per request. Kept modest because the ids are interpolated into
 * a URL-encoded SQL string, and an over-long URL fails as an opaque error.
 */
const ID_BATCH_SIZE = 200;

type CkanResource = { id?: unknown; name?: unknown };
type CkanPackageShow = { result?: { resources?: CkanResource[] } };
type CkanSqlResponse = { result?: { records?: Array<Record<string, unknown>> } };

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Resource ids for the per-year injured-person tables. */
export async function fetchInjuryResourceIds(signal?: AbortSignal): Promise<Map<number, string>> {
  const payload = await fetchJsonWithRetry<CkanPackageShow>(
    `${CKAN_BASE}/package_show?id=${CCRS_PACKAGE_ID}`,
    signal ? { signal } : undefined,
    {
      timeoutMs: 15_000,
      retries: 2,
      cacheTtlMs: 60 * 60 * 1000,
      cacheKey: `ccrs:package:${CCRS_PACKAGE_ID}`,
    }
  );

  const byYear = new Map<number, string>();
  for (const resource of payload?.result?.resources ?? []) {
    const name = typeof resource?.name === "string" ? resource.name : "";
    const id = typeof resource?.id === "string" ? resource.id : "";
    const match = /^InjuredWitnessPassengers_(\d{4})$/.exec(name);
    if (match && id) byYear.set(Number.parseInt(match[1], 10), id);
  }
  return byYear;
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Which of `collisionIds` involved at least one suspected serious injury.
 *
 * Returns only positives — a crash absent from the result is one where no
 * injured person was coded KABCO A, which is a real finding rather than a gap.
 */
export async function fetchSeriousInjuryCollisionIds(params: {
  year: number;
  collisionIds: string[];
  signal?: AbortSignal;
}): Promise<Set<string>> {
  const serious = new Set<string>();
  if (params.collisionIds.length === 0) return serious;

  const resourceIds = await fetchInjuryResourceIds(params.signal);
  const resourceId = resourceIds.get(params.year);
  // No injured-person table for this year: report nothing rather than guessing.
  if (!resourceId) return serious;

  const codes = CCRS_SERIOUS_INJURY_CODES.map((code) => `'${code}'`).join(",");

  for (const batch of chunk(params.collisionIds, ID_BATCH_SIZE)) {
    const ids = batch.map((id) => `'${sqlLiteral(id)}'`).join(",");
    const sql =
      `SELECT DISTINCT "CollisionId" FROM "${sqlLiteral(resourceId)}" ` +
      `WHERE "ExtentOfInjuryCode" IN (${codes}) AND "CollisionId" IN (${ids})`;

    const payload = await fetchJsonWithRetry<CkanSqlResponse>(
      `${CKAN_BASE}/datastore_search_sql?sql=${encodeURIComponent(sql)}`,
      params.signal ? { signal: params.signal } : undefined,
      { timeoutMs: 30_000, retries: 1 }
    );

    for (const row of payload?.result?.records ?? []) {
      const id = row["CollisionId"];
      if (id != null) serious.add(String(id).trim());
    }
  }

  return serious;
}
