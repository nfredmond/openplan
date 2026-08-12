/**
 * ONE reading of a stored crash row into the facts a screen may render.
 *
 * WHY THIS IS EXTRACTED. Two routes turn `safety_crashes` rows into map
 * features: `/api/safety/crashes` (the Safety workbench's filtered query) and
 * `/api/map-features/crashes` (the shared backdrop layer). They carry different
 * envelopes — one keys by external id and source, the other by crash id and the
 * acquisition's project — but the FACTS about the collision are the same facts,
 * and a shared capability living inside one of its two callers gets reimplemented
 * wrongly by the other. It already had: the backdrop route ran both casualty
 * counts through an integer coercion that returned 0 for an unreadable value, so
 * a collision the source never supplied a count for was rendered "0 killed · 0
 * injured" — the exact claim the `unknown` severity band exists to stop the
 * product making.
 *
 * THE RULE THIS FILE ENFORCES: a value the source did not supply comes back
 * `null` and stays `null` all the way to the screen. Never 0, never "", never a
 * plausible default. Renderers say "not reported"; nothing invents an outcome
 * for a real injury or death.
 *
 * PURE — no I/O. Untyped rows in (PostgREST gives no types here, by decision),
 * validated facts out.
 */

import {
  CRASH_COLLISION_TYPES,
  CRASH_LIGHTING_CONDITIONS,
  CRASH_WEATHER_CONDITIONS,
  isCrashSeverity,
  type CrashSeverity,
} from "./vocabulary";

/**
 * The collision facts every crash surface shares.
 *
 * Every nullable field here is nullable because the SOURCE can decline to
 * supply it, not because the code is being defensive.
 */
export type CrashRowFacts = {
  severity: CrashSeverity;
  collisionDate: string | null;
  collisionYear: number | null;
  /** People killed / injured, or null when the source supplied no count. */
  killedCount: number | null;
  injuredCount: number | null;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
  motorcyclistInvolved: boolean;
  /** Neutral dimension, or null when the SOURCE does not record it at all. */
  collisionType: string | null;
  lighting: string | null;
  weather: string | null;
};

/**
 * A casualty count, or null.
 *
 * Note what is NOT here: no `?? 0`, no `Math.max(0, …)`. A negative count is a
 * data error in the feed (observed in the wild), and clamping it to zero would
 * turn "this row is wrong" into "nobody was hurt".
 */
export function readCasualtyCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(parsed)) return null;
  const whole = Math.trunc(parsed);
  return whole < 0 ? null : whole;
}

function readYear(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * A neutral dimension value, or null.
 *
 * A string outside the vocabulary is dropped to null rather than passed through.
 * The column CHECK makes that unreachable today, but a value the product cannot
 * label is a value it must not render — the alternative is a raw source spelling
 * appearing on a screen, which is how one jurisdiction's private vocabulary
 * becomes part of the product's.
 */
function readDimension(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function readFlag(value: unknown): boolean {
  return value === true;
}

/**
 * Read one row. Returns null when the severity is unusable — a collision whose
 * band cannot be read cannot be painted or labelled, and the callers count it as
 * undrawable rather than guessing.
 */
export function readCrashRowFacts(row: Readonly<Record<string, unknown>>): CrashRowFacts | null {
  if (!isCrashSeverity(row.severity)) return null;

  return {
    severity: row.severity,
    collisionDate: typeof row.collision_date === "string" ? row.collision_date : null,
    collisionYear: readYear(row.collision_year),
    killedCount: readCasualtyCount(row.killed_count),
    injuredCount: readCasualtyCount(row.injured_count),
    pedestrianInvolved: readFlag(row.pedestrian_involved),
    bicyclistInvolved: readFlag(row.bicyclist_involved),
    motorcyclistInvolved: readFlag(row.motorcyclist_involved),
    collisionType: readDimension(row.collision_type, CRASH_COLLISION_TYPES),
    lighting: readDimension(row.lighting, CRASH_LIGHTING_CONDITIONS),
    weather: readDimension(row.weather, CRASH_WEATHER_CONDITIONS),
  };
}

/**
 * The Safety workbench's feature properties for one stored row.
 *
 * Returns null for a row that cannot be rendered honestly, so the caller counts
 * it rather than drawing it.
 */
export function toStoredCrashProperties(
  row: Readonly<Record<string, unknown>>
): (CrashRowFacts & { kind: "safety_crash"; id: string; externalId: string; sourceId: string }) | null {
  const facts = readCrashRowFacts(row);
  if (!facts) return null;
  return {
    kind: "safety_crash",
    id: String(row.id ?? ""),
    externalId: String(row.external_id ?? ""),
    sourceId: String(row.source_id ?? ""),
    ...facts,
  };
}
