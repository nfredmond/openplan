/**
 * CCRS person-level rows — who was in the collision, and how badly hurt.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL POLISH. The crash table's
 * involvement flags UNDERCOUNT the people this module exists to protect.
 * Probed against 2025 on 2026-08-11:
 *
 *     crash-level 'BICYCLE' flag        10,221 collisions
 *     collisions with a Bicyclist party 11,944 collisions   (+16.9%)
 *     crash-level 'PEDESTRIAN' flag     12,789 collisions
 *     collisions with a Pedestrian party 13,177 collisions  (+3.0%)
 *     collisions with a motorcycle       12,513 collisions  (no crash-level flag at all)
 *
 * So every vulnerable-road-user figure the product has shown to date is low, and
 * motorcyclists have been invisible. Person rows also answer the question a
 * safety action plan is actually built on — outcomes by role and age band —
 * which a crash-level count cannot express at any level of effort.
 *
 * TWO TABLES, JOINED ON A COMPOUND KEY. `Parties_YYYY` is one row per party and
 * carries the role; `InjuredWitnessPassengers_YYYY` is one row per injured or
 * witnessing person and carries the outcome. Both key on `CollisionId` plus
 * `PartyNumber`, which is what lets an injury be attributed to the right person
 * rather than smeared across the collision.
 *
 * NEITHER TABLE HAS COORDINATES, so neither can be filtered by bounding box. The
 * only way in is by case id, batched — which is also the cheap way, because the
 * crashes have already been narrowed to a study area.
 *
 * WHAT IS NEVER REQUESTED. The SELECT lists below are the whole contract: race,
 * ethnicity, sex, exact age, licence class, vehicle make/model/colour/year,
 * sobriety and drug findings, at-fault and hit-and-run allegations, seat
 * position, airbag and ejection detail, victim-services notification, report and
 * evidence numbers. Those fields exist in this source. They are refused in the
 * query, not merely left off a screen, because a field that is fetched is a
 * field that reaches a log, a cache and an error message.
 * `src/test/refused-crash-person-fields.test.ts` carries the argument and fails
 * the build if one is added.
 *
 * FAILURE POSTURE. A wrong column name or an outage makes CKAN answer with
 * something `fetchJsonWithRetry` reports as null, and this module throws
 * `CrashSourceUnavailableError`. The ingest catches that, keeps the crashes, and
 * records that person rows were NOT retrieved — never that there were none.
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import {
  mapCrashDimension,
  toCrashAgeBand,
  type CrashAgeBand,
  type CrashPartyRole,
  type CrashPersonInjury,
} from "@/lib/safety/vocabulary";
import { CCRS_VOCABULARY, isCcrsMotorcycleVehicle } from "./ccrs-vocabulary";
import {
  CrashSourceUnavailableError,
  type CrashPartyFetchParams,
  type CrashPartyRecord,
} from "./types";

const CKAN_BASE = "https://data.ca.gov/api/3/action";
const CCRS_PACKAGE_ID = "ccrs";
const CCRS_SOURCE_ID = "ccrs-ca";

/**
 * Collision ids per request.
 *
 * The ids are interpolated into a URL-encoded SQL string and an over-long URL
 * fails as an opaque error, so this matches the batch size the injury-join has
 * been running at since Wave 8.1 rather than inventing a second number.
 */
const ID_BATCH_SIZE = 200;

/**
 * Columns requested from `Parties_YYYY`. Five, out of the table's 49.
 *
 * `Vehicle1TypeDesc` is read for exactly one purpose — separating a motorcyclist
 * from a driver — and is never stored raw. `StatedAge` is banded inside this
 * module; the integer never reaches a row, a response or a log.
 */
export const CCRS_PARTY_COLUMNS = {
  collisionId: "CollisionId",
  partyNumber: "PartyNumber",
  partyType: "PartyType",
  statedAge: "StatedAge",
  vehicleType: "Vehicle1TypeDesc",
} as const;

/**
 * Columns requested from `InjuredWitnessPassengers_YYYY`. Five, out of 22.
 *
 * `IsWitnessOnly` is requested so a witness can be EXCLUDED rather than stored
 * as a person with an unknown injury: a witness is not a casualty, and a row
 * saying otherwise would inflate every person count in the module.
 */
export const CCRS_INJURED_COLUMNS = {
  collisionId: "CollisionId",
  partyNumber: "PartyNumber",
  personType: "InjuredPersonType",
  statedAge: "StatedAge",
  extentOfInjury: "ExtentOfInjuryCode",
  isWitnessOnly: "IsWitnessOnly",
} as const;

type CkanResource = { id?: unknown; name?: unknown };
type CkanPackageShow = { result?: { resources?: CkanResource[] } };
type CkanSqlResponse = { result?: { records?: Array<Record<string, unknown>> } };

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function chunkIds<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Resource ids for one family of per-year tables.
 *
 * Resolved from the live manifest for the same reason the crash tables are:
 * CKAN reissues resource ids, and a stale constant fails closed in a way that
 * looks like "this collision involved nobody".
 */
export async function fetchCcrsResourceIdsFor(
  prefix: string,
  signal?: AbortSignal
): Promise<Map<number, string>> {
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

  if (payload === null) {
    throw new CrashSourceUnavailableError(CCRS_SOURCE_ID, "data.ca.gov package manifest unreachable");
  }

  const byYear = new Map<number, string>();
  const pattern = new RegExp(`^${prefix}_(\\d{4})$`);
  for (const resource of payload.result?.resources ?? []) {
    const name = typeof resource?.name === "string" ? resource.name : "";
    const id = typeof resource?.id === "string" ? resource.id : "";
    const match = pattern.exec(name);
    if (match && id) byYear.set(Number.parseInt(match[1], 10), id);
  }
  return byYear;
}

async function runSql(sql: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const payload = await fetchJsonWithRetry<CkanSqlResponse>(
    `${CKAN_BASE}/datastore_search_sql?sql=${encodeURIComponent(sql)}`,
    signal ? { signal } : undefined,
    { timeoutMs: 30_000, retries: 1 }
  );

  // `{ records: [] }` is "no people matched"; `null` is "the query never
  // succeeded". Only the first is a finding, and conflating them here would put
  // an outage on screen as a collision nobody was in.
  if (payload === null) {
    throw new CrashSourceUnavailableError(CCRS_SOURCE_ID, "data.ca.gov party query failed");
  }
  return payload.result?.records ?? [];
}

function idOf(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

/**
 * The role a party played, from the party type and — for a motorcyclist — the
 * vehicle they were on.
 *
 * A DECLARED two-column derivation. CCRS has no `Motorcyclist` party type; it
 * records them as drivers and puts the distinction in the vehicle column. That
 * is a mapping fact about this source, so it lives here rather than becoming a
 * gap in the neutral vocabulary.
 */
export function deriveCcrsPartyRole(
  partyType: unknown,
  vehicleTypeDesc: unknown
): { role: CrashPartyRole; unmappedRaw: string | null } {
  const mapping = mapCrashDimension(CCRS_VOCABULARY, "party_role", partyType);
  // `party_role` is declared `supplied`, so the mapping is never null here; the
  // guard keeps the function total rather than relying on that.
  if (mapping === null) return { role: "unknown", unmappedRaw: null };

  const role = mapping.value as CrashPartyRole;
  if (role === "driver" && isCcrsMotorcycleVehicle(vehicleTypeDesc)) {
    return { role: "motorcyclist", unmappedRaw: mapping.unmapped ? mapping.raw : null };
  }
  return { role, unmappedRaw: mapping.unmapped ? mapping.raw : null };
}

/** The outcome for one person, or `unknown` when the source coded none. */
export function deriveCcrsPersonInjury(extentOfInjuryCode: unknown): {
  injury: CrashPersonInjury;
  unmappedRaw: string | null;
} {
  const mapping = mapCrashDimension(CCRS_VOCABULARY, "person_injury", extentOfInjuryCode);
  if (mapping === null) return { injury: "unknown", unmappedRaw: null };
  return {
    injury: mapping.value as CrashPersonInjury,
    unmappedRaw: mapping.unmapped ? mapping.raw : null,
  };
}

/** CCRS writes booleans as the strings 'True' / 'False'. */
function isTrueFlag(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

type PartySeed = {
  crashExternalId: string;
  externalPartyId: string;
  role: CrashPartyRole;
  ageBand: CrashAgeBand;
  injury: CrashPersonInjury;
  sourceAttributes: Record<string, string>;
};

/**
 * Person rows for a set of already-fetched crashes.
 *
 * Two passes per year. The first builds a person from every party; the second
 * attaches the injury outcome, and adds the injured people the party table does
 * not itself list (a passenger is not a party — the party is the vehicle's
 * driver — so a fatally injured passenger exists only in the second table).
 *
 * Crashes with no `collisionYear` are skipped rather than guessed into a year:
 * asking the wrong year's table would return nothing and read as "nobody was in
 * this collision".
 */
export async function fetchCcrsParties(params: CrashPartyFetchParams): Promise<CrashPartyRecord[]> {
  const idsByYear = new Map<number, string[]>();
  for (const crash of params.crashes) {
    if (crash.collisionYear === null || !crash.externalId) continue;
    const bucket = idsByYear.get(crash.collisionYear) ?? [];
    bucket.push(crash.externalId);
    idsByYear.set(crash.collisionYear, bucket);
  }
  if (idsByYear.size === 0) return [];

  const [partyResources, injuredResources] = await Promise.all([
    fetchCcrsResourceIdsFor("Parties", params.signal),
    fetchCcrsResourceIdsFor("InjuredWitnessPassengers", params.signal),
  ]);

  const seeds = new Map<string, PartySeed>();

  for (const [year, collisionIds] of idsByYear) {
    const partyResource = partyResources.get(year);
    if (partyResource) {
      const columns = Object.values(CCRS_PARTY_COLUMNS)
        .map((c) => `"${c}"`)
        .join(",");
      for (const batch of chunkIds(collisionIds, ID_BATCH_SIZE)) {
        const ids = batch.map((id) => `'${sqlLiteral(id)}'`).join(",");
        const rows = await runSql(
          `SELECT ${columns} FROM "${sqlLiteral(partyResource)}" ` +
            `WHERE "${CCRS_PARTY_COLUMNS.collisionId}" IN (${ids})`,
          params.signal
        );

        for (const row of rows) {
          const crashExternalId = idOf(row[CCRS_PARTY_COLUMNS.collisionId]);
          const partyNumber = idOf(row[CCRS_PARTY_COLUMNS.partyNumber]);
          if (!crashExternalId || !partyNumber) continue;

          const { role, unmappedRaw } = deriveCcrsPartyRole(
            row[CCRS_PARTY_COLUMNS.partyType],
            row[CCRS_PARTY_COLUMNS.vehicleType]
          );
          const sourceAttributes: Record<string, string> = {};
          if (unmappedRaw !== null) sourceAttributes[CCRS_PARTY_COLUMNS.partyType] = unmappedRaw;

          seeds.set(`${crashExternalId}-${partyNumber}`, {
            crashExternalId,
            externalPartyId: `${crashExternalId}-${partyNumber}`,
            role,
            ageBand: toCrashAgeBand(row[CCRS_PARTY_COLUMNS.statedAge]),
            injury: "unknown",
            sourceAttributes,
          });
        }
      }
    }

    const injuredResource = injuredResources.get(year);
    if (!injuredResource) continue;

    const injuredColumns = Object.values(CCRS_INJURED_COLUMNS)
      .map((c) => `"${c}"`)
      .join(",");
    for (const batch of chunkIds(collisionIds, ID_BATCH_SIZE)) {
      const ids = batch.map((id) => `'${sqlLiteral(id)}'`).join(",");
      const rows = await runSql(
        `SELECT ${injuredColumns} FROM "${sqlLiteral(injuredResource)}" ` +
          `WHERE "${CCRS_INJURED_COLUMNS.collisionId}" IN (${ids})`,
        params.signal
      );

      for (const row of rows) {
        // A witness is not a casualty. Storing one would put a person with an
        // unknown outcome into every person count in the module.
        if (isTrueFlag(row[CCRS_INJURED_COLUMNS.isWitnessOnly])) continue;

        const crashExternalId = idOf(row[CCRS_INJURED_COLUMNS.collisionId]);
        const partyNumber = idOf(row[CCRS_INJURED_COLUMNS.partyNumber]);
        if (!crashExternalId || !partyNumber) continue;

        const key = `${crashExternalId}-${partyNumber}`;
        const { injury, unmappedRaw } = deriveCcrsPersonInjury(row[CCRS_INJURED_COLUMNS.extentOfInjury]);
        const existing = seeds.get(key);

        if (existing) {
          existing.injury = injury;
          if (unmappedRaw !== null) {
            existing.sourceAttributes[CCRS_INJURED_COLUMNS.extentOfInjury] = unmappedRaw;
          }
          continue;
        }

        // An injured person the party table does not list — a passenger, whose
        // party is the vehicle's driver. Their role comes from the injured
        // table's own person-type column, which is a different field with the
        // same vocabulary.
        const { role, unmappedRaw: roleRaw } = deriveCcrsPartyRole(
          row[CCRS_INJURED_COLUMNS.personType],
          undefined
        );
        const sourceAttributes: Record<string, string> = {};
        if (roleRaw !== null) sourceAttributes[CCRS_INJURED_COLUMNS.personType] = roleRaw;
        if (unmappedRaw !== null) sourceAttributes[CCRS_INJURED_COLUMNS.extentOfInjury] = unmappedRaw;

        seeds.set(key, {
          crashExternalId,
          externalPartyId: key,
          role,
          ageBand: toCrashAgeBand(row[CCRS_INJURED_COLUMNS.statedAge]),
          injury,
          sourceAttributes,
        });
      }
    }
  }

  return Array.from(seeds.values());
}
