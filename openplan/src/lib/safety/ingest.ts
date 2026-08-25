/**
 * Crash ingestion (Wave 8.1).
 *
 * Resolve a source for the study area → record an ingest row → page the adapter
 * → upsert observed crashes → finalize the status.
 *
 * The route owns authentication and supplies the service-role client; this
 * module owns the sequence and the honesty bookkeeping. Two rules matter most:
 *
 *   1. `out_of_coverage` is a RECORDED OUTCOME, not an error and not an empty
 *      map. The ingest row is written with that status so the UI can explain
 *      why there are no crashes, rather than showing an unexplained blank.
 *      AND IT MEANS WHAT IT SAYS: before it is recorded, the READ-ONLY lane
 *      (`read-only-lane.ts`) is consulted, because `resolveCrashSource` in
 *      `ingest` mode only sees adapters the `safety_crashes` CHECK domain
 *      admits. Skipping that step reported "no registered crash source covers
 *      this study area" to every planner outside California while a registered
 *      national adapter covered them — see that file's header for the full
 *      account. A read-only outcome stores nothing and writes no ingest row.
 *   2. `crashCount` (reported) and `geocodedCount` (mappable) are stored
 *      separately, because ungeocoded crashes are real crashes that simply
 *      cannot be plotted. Collapsing them would silently understate the study
 *      area's crash burden by roughly a fifth on CCRS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import {
  CRASH_DIMENSION_COLUMNS,
  CRASH_INVOLVEMENT_COLUMNS,
  type CrashDimension,
  type CrashDimensionCapability,
  type CrashPartyRole,
} from "./vocabulary";
import type { SafetyCrashCollection, SafetyCrashFeature } from "./client-types";
import { readCrashesForStudyArea, type CrashSourceIdentity } from "./read-only-lane";
import { CCRS_SOURCE_ID } from "./sources/ccrs";
import { fetchSeriousInjuryCollisionIds } from "./sources/ccrs-injury";
import { resolveCrashSource } from "./sources/registry";
import type { CrashPartyRecord, CrashRecord, CrashSourceAdapter } from "./sources/types";

/** Rows written per upsert batch — keeps each PostgREST call modest. */
const UPSERT_BATCH_SIZE = 500;

export type CrashPartyCompleteness = "retrieved" | "not_retrieved" | "not_supported";
export type CrashInvolvementBasis = "party_rows" | "crash_flags";

/**
 * The per-dimension disclosure written onto every ingest row.
 *
 * THE MECHANISM THAT KEEPS A MISSING FACET FROM READING AS A FINDING. Every
 * neutral dimension column is nullable, because a source that does not record
 * lighting writes NULL — and a filter panel that renders NULL as an empty result
 * has just told a planner that no crash in their corridor happened after dark.
 * With this on the ingest, the panel renders that facet disabled and says the
 * source does not record it. Adding a jurisdiction means adding a descriptor
 * that declares its own capability; it does not mean touching the panel.
 */
export type CrashDimensionCoverage = Record<string, { support: string; unmapped?: number }>;

export function buildDimensionCoverage(
  capability: CrashDimensionCapability,
  unmapped: Partial<Record<CrashDimension, number>> = {}
): CrashDimensionCoverage {
  const coverage: CrashDimensionCoverage = {};
  for (const [dimension, support] of Object.entries(capability)) {
    const fellThrough = unmapped[dimension as CrashDimension];
    coverage[dimension] =
      typeof fellThrough === "number" && fellThrough > 0 ? { support, unmapped: fellThrough } : { support };
  }
  return coverage;
}

/**
 * Whether a source has a person table at all.
 *
 * Read off the adapter's own optional `fetchParties`, never off its id: the
 * ingest must not know which source is Californian. `not_retrieved` says the
 * capability exists and this run does not have its rows — which is a different
 * sentence from "this source has no people in it", and only one of them can
 * honestly accompany a zero.
 */
function partyPostureFor(adapter: CrashSourceAdapter): CrashPartyCompleteness {
  return typeof adapter.fetchParties === "function" ? "not_retrieved" : "not_supported";
}

export type IngestCrashesParams = {
  service: SupabaseClient;
  workspaceId: string;
  projectId?: string | null;
  bbox: StudyAreaBbox;
  years: number[];
  countyCode?: number;
  maxRecords?: number;
  requestedBy?: string | null;
  /**
   * Join the CCRS injured-person table to separate KABCO A (suspected serious
   * injury). Defaults to on: without it there is no KSI, which is the measure
   * SS4A and HSIP actually run on.
   */
  enrichSeriousInjury?: boolean;
  /**
   * Retrieve person-level rows (role, age band, injury outcome) alongside the
   * crashes. Defaults to ON.
   *
   * On by default because the crash-level involvement flags are measurably low —
   * see `applyPartyInvolvement` for the figures — so a run without person rows
   * publishes vulnerable-road-user counts that are known to be under. It
   * degrades exactly like the serious-injury join: a failure keeps the crashes
   * and records `party_completeness: 'not_retrieved'`, never "there were none".
   */
  includeParties?: boolean;
  /**
   * Whether this caller is permitted to WRITE. Defaults to `true`, so every
   * existing caller is unchanged.
   *
   * This lane has two outcomes and only one of them is a write. When no
   * storable source covers the study area it falls through to the read-only
   * path, which returns live points and touches no table — and gating that on
   * write access meant a viewer outside a storable source's footprint (i.e.
   * every state but California today) could see no crash data at all, from a
   * request that would have written nothing.
   *
   * The route could have PREDICTED which outcome it would get and gated on
   * that, and the first version of this fix did. It is wrong: `resolveCrashSource`
   * says whether a STORABLE source covers the area, but the no-coverage branch
   * below still records an acquisition row, and `readCrashesForStudyArea` has a
   * defensive path that reaches it even when a read-only source resolved. A
   * permission decision may not rest on a comment claiming a branch is
   * unreachable. So the constraint is enforced HERE, where the write happens:
   * with `mayStore: false` the lane refuses rather than writing, and there is
   * no path from a read-only caller to an INSERT.
   */
  mayStore?: boolean;
  signal?: AbortSignal;
};

export type IngestCrashesResult = {
  /**
   * The acquisition row's id, or null when nothing was acquired.
   *
   * A `read_only` outcome writes NO row: `safety_crash_ingests` is the record of
   * what this workspace has taken into its own keeping, and a live read takes
   * nothing. Recording one would put counts in the coverage banner that no
   * `safety_crashes` row backs, so the banner and the map would contradict each
   * other on the next page load.
   */
  ingestId: string | null;
  /**
   * `read_only` — a registered source covers this area but may not be stored
   * (`safety_crashes.source_id` is a closed CHECK domain). The crashes are real,
   * observed and returned in `crashes`; they simply live only in this response.
   */
  status: "ready" | "failed" | "no_coverage" | "read_only";
  sourceId: string | null;
  sourceLabel: string | null;
  /** Required attribution for the source that answered, when one did. */
  attribution: string | null;
  coverageState: string;
  crashCount: number;
  geocodedCount: number;
  storedCount: number;
  /** False when the crashes were read live and NOT written to this workspace. */
  stored: boolean;
  truncated: boolean;
  yearsCovered: number[];
  publishedThrough?: string;
  publishedThroughProvenance?: Record<string, unknown>;
  /** How completely severity could be expressed after any KSI enrichment. */
  severityCompleteness: string;
  /** Injury crashes upgraded to KABCO A by the injured-person join. */
  seriousInjuryUpgrades: number;
  /**
   * What happened to the person-level pull.
   *
   * `not_supported` — this source has no person table at all.
   * `not_retrieved` — it has one and the pull failed or was switched off. NOT
   *                   the same as "there were no people", which is why the
   *                   count below is null rather than 0 in that state.
   * `retrieved`     — person rows were stored.
   */
  partyCompleteness: CrashPartyCompleteness;
  /** People stored, or null when they were not retrieved. Never 0-for-unknown. */
  partyCount: number | null;
  /**
   * Which basis the pedestrian / bicyclist / motorcyclist flags rest on.
   *
   * Recorded because the two bases disagree by up to 17%: crash-level flags
   * undercount, person rows do not. A figure whose basis is unrecorded cannot be
   * compared with the same figure from another run.
   */
  involvementBasis: CrashInvolvementBasis | null;
  /** Per-dimension capability plus how many values fell outside the mapping. */
  dimensionCoverage: CrashDimensionCoverage;
  /**
   * Live crash points, present ONLY for `read_only`. A stored acquisition
   * returns null here because its points are read back from `safety_crashes`,
   * which is the one place a persisted crash may come from.
   */
  crashes: SafetyCrashCollection | null;
  /**
   * Every adapter consulted, when the answer was decided by coverage. Empty for
   * a resolved storable source, where the question never arose. This is what
   * lets a caller name what it checked instead of asserting that nothing exists.
   */
  checkedSources: CrashSourceIdentity[];
  error: string | null;
};

function toIngestRow(params: {
  workspaceId: string;
  projectId?: string | null;
  bbox: StudyAreaBbox;
  years: number[];
  countyCode?: number;
  requestedBy?: string | null;
}) {
  return {
    workspace_id: params.workspaceId,
    project_id: params.projectId ?? null,
    min_lon: params.bbox.minLon,
    min_lat: params.bbox.minLat,
    max_lon: params.bbox.maxLon,
    max_lat: params.bbox.maxLat,
    county_code: typeof params.countyCode === "number" ? Math.trunc(params.countyCode) : null,
    years_requested: params.years,
    requested_by: params.requestedBy ?? null,
  };
}

/**
 * THE ONE PLACE a neutral field becomes a column name.
 *
 * The column strings come from `vocabulary.ts` rather than being spelled here,
 * so the storage name, the filter predicate and the query projection are
 * generated from a single declaration per dimension. A second hand-written copy
 * of this mapping is how a facet ends up filterable in the API and dead in the
 * UI.
 */
export function toCrashRows(
  records: CrashRecord[],
  context: { workspaceId: string; ingestId: string; sourceId: string }
) {
  return records.map((record) => ({
    workspace_id: context.workspaceId,
    ingest_id: context.ingestId,
    source_id: context.sourceId,
    external_id: record.externalId,
    collision_date: record.collisionDate,
    collision_year: record.collisionYear,
    [CRASH_DIMENSION_COLUMNS.severity]: record.severity,
    // Null, not zero. The column dropped its NOT NULL in
    // 20260812000001 precisely so an unsupplied count could stay unsupplied.
    killed_count: record.killedCount,
    injured_count: record.injuredCount,
    pedestrian_involved: record.pedestrianInvolved,
    bicyclist_involved: record.bicyclistInvolved,
    [CRASH_INVOLVEMENT_COLUMNS.motorcyclist]: record.motorcyclistInvolved,
    [CRASH_DIMENSION_COLUMNS.collision_type]: record.collisionType,
    [CRASH_DIMENSION_COLUMNS.lighting]: record.lighting,
    [CRASH_DIMENSION_COLUMNS.weather]: record.weather,
    source_attributes: record.sourceAttributes,
    latitude: record.latitude,
    longitude: record.longitude,
  }));
}

/**
 * Person rows for one acquisition.
 *
 * `crashIdByExternalId` is required rather than optional: a party row that
 * cannot be attached to a stored crash is dropped, because a person with no
 * collision is not a record of anything and a dangling foreign key would fail
 * the whole batch.
 */
export function toCrashPartyRows(
  parties: CrashPartyRecord[],
  context: {
    workspaceId: string;
    ingestId: string;
    sourceId: string;
    crashIdByExternalId: ReadonlyMap<string, string>;
  }
) {
  const rows: Array<Record<string, unknown>> = [];
  for (const party of parties) {
    const crashId = context.crashIdByExternalId.get(party.crashExternalId);
    if (!crashId) continue;
    rows.push({
      workspace_id: context.workspaceId,
      ingest_id: context.ingestId,
      source_id: context.sourceId,
      crash_id: crashId,
      external_party_id: party.externalPartyId,
      [CRASH_DIMENSION_COLUMNS.party_role]: party.role,
      age_band: party.ageBand,
      [CRASH_DIMENSION_COLUMNS.person_injury]: party.injury,
      source_attributes: party.sourceAttributes,
    });
  }
  return rows;
}

/**
 * Recompute the three involvement flags from person rows.
 *
 * WHY THIS IS NOT COSMETIC. The crash-level flags UNDERCOUNT, measurably: probed
 * against one state's 2025 file, the crash-level bicycle flag names 10,221
 * collisions where 11,944 carry a bicyclist party row (+16.9%), pedestrians
 * 12,789 vs 13,177 (+3.0%), and motorcyclists have no crash-level flag at all
 * while 12,513 collisions involve a motorcycle. Every vulnerable-road-user
 * figure this product has shown was low.
 *
 * Only crashes that actually received person rows are recomputed. A crash the
 * person query returned nothing for keeps its crash-level flags: "no party rows
 * came back for this collision" is not evidence that no pedestrian was in it,
 * and zeroing the flag would replace an undercount with a fabrication. WHICH
 * basis was used is recorded on the ingest either way.
 */
export function applyPartyInvolvement(
  records: CrashRecord[],
  parties: CrashPartyRecord[]
): { records: CrashRecord[]; recomputed: number } {
  const rolesByCrash = new Map<string, Set<CrashPartyRole>>();
  for (const party of parties) {
    const bucket = rolesByCrash.get(party.crashExternalId) ?? new Set<CrashPartyRole>();
    bucket.add(party.role);
    rolesByCrash.set(party.crashExternalId, bucket);
  }

  let recomputed = 0;
  const out = records.map((record) => {
    const roles = rolesByCrash.get(record.externalId);
    if (!roles) return record;
    recomputed += 1;
    return {
      ...record,
      // OR, not replace: a crash-level flag that fired is a positive report from
      // the source and stands even where the person rows do not echo it.
      pedestrianInvolved: record.pedestrianInvolved || roles.has("pedestrian"),
      bicyclistInvolved: record.bicyclistInvolved || roles.has("bicyclist"),
      motorcyclistInvolved: record.motorcyclistInvolved || roles.has("motorcyclist"),
    };
  });

  return { records: out, recomputed };
}

/**
 * Live crash records, in the same GeoJSON shape `/api/safety/crashes` returns
 * for STORED crashes, so one map component renders both without learning which
 * lane it is looking at.
 *
 * `id` is synthesized from the source and the case id rather than left blank:
 * these points have no database row, and React keys plus the map's feature
 * identity still need something stable and unique. It is deliberately NOT a
 * uuid-shaped value — nothing downstream may mistake it for a `safety_crashes`
 * primary key.
 */
export function toLiveCrashCollection(
  records: CrashRecord[],
  fallbackSourceId: string
): SafetyCrashCollection {
  const features: SafetyCrashFeature[] = records.map((record) => {
    const sourceId = record.sourceId ?? fallbackSourceId;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [record.longitude, record.latitude] },
      properties: {
        kind: "safety_crash",
        id: `live:${sourceId}:${record.externalId}`,
        externalId: record.externalId,
        sourceId,
        collisionDate: record.collisionDate,
        collisionYear: record.collisionYear,
        severity: record.severity,
        killedCount: record.killedCount,
        injuredCount: record.injuredCount,
        pedestrianInvolved: record.pedestrianInvolved,
        bicyclistInvolved: record.bicyclistInvolved,
        // THE LIVE LANE'S HALF OF THE FILTER SEAM. These four ride the feature
        // because the live lane's filter predicate reads the FEATURE, not a
        // database row — a facet the properties do not carry is a facet that
        // silently excludes every live crash the moment a planner touches it.
        // `crashFilterProperties()` in `crash-filters.ts` is the list, and
        // `one-crash-filter-definition.test.ts` fails if this projection falls
        // behind it.
        motorcyclistInvolved: record.motorcyclistInvolved,
        collisionType: record.collisionType,
        lighting: record.lighting,
        weather: record.weather,
      },
    };
  });

  return { type: "FeatureCollection", features };
}

/**
 * Upgrade injury crashes to KABCO A using the CCRS injured-person table.
 *
 * Only `injury` rows are candidates: a fatal crash already outranks serious
 * injury, and a PDO crash by definition injured nobody. Returns the records
 * with severity upgraded in place, so the caller writes one consistent batch.
 *
 * A failure here is deliberately NOT fatal to the ingest — the crashes are still
 * real and worth storing. The caller keeps `severityCompleteness` at
 * `fatal_injury_only` in that case, so the UI says serious injuries could not be
 * separated instead of implying there were none.
 */
export async function applySeriousInjuryUpgrade(
  records: CrashRecord[],
  signal?: AbortSignal
): Promise<{ records: CrashRecord[]; upgraded: number }> {
  const byYear = new Map<number, string[]>();
  for (const record of records) {
    if (record.severity !== "injury" || record.collisionYear === null) continue;
    const bucket = byYear.get(record.collisionYear) ?? [];
    bucket.push(record.externalId);
    byYear.set(record.collisionYear, bucket);
  }

  const serious = new Set<string>();
  for (const [year, collisionIds] of byYear) {
    const found = await fetchSeriousInjuryCollisionIds({ year, collisionIds, signal });
    for (const id of found) serious.add(id);
  }

  let upgraded = 0;
  const out = records.map((record) => {
    if (record.severity === "injury" && serious.has(record.externalId)) {
      upgraded += 1;
      return { ...record, severity: "severe_injury" as const };
    }
    return record;
  });

  return { records: out, upgraded };
}

/**
 * De-duplicate within a single fetch before writing.
 *
 * Postgres rejects an ON CONFLICT batch that contains the same key twice
 * ("cannot affect row a second time"), and a source paging across years can
 * legitimately hand back the same case id, so the batch must be unique before
 * it reaches the upsert.
 */
export function dedupeRecords(records: CrashRecord[]): CrashRecord[] {
  const seen = new Set<string>();
  const out: CrashRecord[] = [];
  for (const record of records) {
    if (seen.has(record.externalId)) continue;
    seen.add(record.externalId);
    out.push(record);
  }
  return out;
}

export async function ingestCrashesForStudyArea(
  params: IngestCrashesParams
): Promise<IngestCrashesResult> {
  const resolution = resolveCrashSource(params.bbox);
  const mayStore = params.mayStore ?? true;

  // A caller that may not write is refused BEFORE any storable path runs, and
  // the refusal names the reason rather than presenting itself as a coverage
  // gap. The read-only path below is still open to them, because it writes
  // nothing.
  if (resolution.kind === "resolved" && !mayStore) {
    return {
      ingestId: null,
      status: "failed",
      sourceId: resolution.adapter.id,
      sourceLabel: resolution.adapter.label,
      attribution: resolution.adapter.attribution,
      coverageState: resolution.adapter.coverageState,
      crashCount: 0,
      geocodedCount: 0,
      storedCount: 0,
      stored: false,
      truncated: false,
      yearsCovered: [],
      severityCompleteness: resolution.adapter.severityCompleteness,
      seriousInjuryUpgrades: 0,
      partyCompleteness: partyPostureFor(resolution.adapter),
      partyCount: null,
      involvementBasis: null,
      dimensionCoverage: buildDimensionCoverage(resolution.adapter.dimensions),
      crashes: null,
      checkedSources: [{ id: resolution.adapter.id, label: resolution.adapter.label }],
      error:
        "This study area is covered by a source whose crashes are stored in the workspace, and storing them needs write access. Ask an editor to run the acquisition.",
    };
  }

  // NO STORABLE SOURCE COVERS THIS AREA — which is NOT the same thing as no
  // source covering it, and treating the two as one is what made the Safety
  // module useless outside California. `resolveCrashSource(bbox, "ingest")`
  // filters the registry down to adapters `safety_crashes.source_id` will
  // admit; anything else is invisible to it, however well it covers the place.
  // So consult the READ path before claiming a coverage gap.
  if (resolution.kind === "out_of_coverage") {
    const live = await readCrashesForStudyArea({
      bbox: params.bbox,
      years: params.years,
      maxRecords: params.maxRecords,
      signal: params.signal,
    });

    if (live.kind === "read_only") {
      const records = dedupeRecords(live.fetched.records);
      return {
        ingestId: null,
        status: "read_only",
        sourceId: live.adapter.id,
        sourceLabel: live.adapter.label,
        attribution: live.adapter.attribution,
        coverageState: live.adapter.coverageState,
        crashCount: live.fetched.matchedTotal,
        geocodedCount: live.fetched.geocodedTotal,
        // Nothing was written, and the field that says so is the count itself —
        // not a flag a caller might forget to read.
        storedCount: 0,
        stored: false,
        truncated: live.fetched.truncated,
        yearsCovered: live.fetched.yearsCovered,
        publishedThrough: live.fetched.publishedCutoff?.publishedThrough,
        publishedThroughProvenance: live.fetched.publishedCutoff?.provenance,
        severityCompleteness: live.adapter.severityCompleteness,
        seriousInjuryUpgrades: 0,
        // A live read stores nothing, so it stores no people either — and it
        // still discloses what the source COULD have said, because the same
        // filter panel renders both lanes.
        partyCompleteness: partyPostureFor(live.adapter),
        partyCount: null,
        involvementBasis: "crash_flags",
        dimensionCoverage: buildDimensionCoverage(
          live.adapter.dimensions,
          live.fetched.unmappedByDimension
        ),
        crashes: toLiveCrashCollection(records, live.adapter.id),
        checkedSources: live.checked,
        error: null,
      };
    }

    if (live.kind === "source_unavailable") {
      // A source that could not be reached is NOT a source that found nothing.
      // No acquisition row is written because nothing was acquired, and the
      // outage travels back as itself.
      return {
        ingestId: null,
        status: "failed",
        sourceId: live.adapter.id,
        sourceLabel: live.adapter.label,
        attribution: live.adapter.attribution,
        coverageState: "source_unavailable",
        crashCount: 0,
        geocodedCount: 0,
        storedCount: 0,
        stored: false,
        truncated: false,
        yearsCovered: [],
        severityCompleteness: live.adapter.severityCompleteness,
        seriousInjuryUpgrades: 0,
        partyCompleteness: partyPostureFor(live.adapter),
        partyCount: null,
        involvementBasis: null,
        dimensionCoverage: buildDimensionCoverage(live.adapter.dimensions),
        crashes: null,
        checkedSources: live.checked,
        error: live.message,
      };
    }

    // Genuinely nothing covers this study area — every registered adapter,
    // storable or not, was asked. Record that plainly and stop; the UI renders
    // the gap and names what was checked, never an estimate.
    //
    // This branch WRITES, which is easy to miss because everything above it in
    // the out-of-coverage path does not. A read-only caller reaches it whenever
    // no adapter covers their area, so the answer they get is the same coverage
    // gap without the acquisition row — the finding is identical, and nothing
    // in `safety_crash_ingests` is authored by someone who may not write.
    if (!mayStore) {
      return {
        ingestId: null,
        status: "no_coverage",
        sourceId: null,
        sourceLabel: null,
        attribution: null,
        coverageState: "out_of_coverage",
        crashCount: 0,
        geocodedCount: 0,
        storedCount: 0,
        stored: false,
        truncated: false,
        yearsCovered: [],
        severityCompleteness: "fatal_only",
        seriousInjuryUpgrades: 0,
        partyCompleteness: "not_supported",
        partyCount: null,
        involvementBasis: null,
        dimensionCoverage: {},
        crashes: null,
        checkedSources: live.checked,
        error: null,
      };
    }

    const { data, error } = await params.service
      .from("safety_crash_ingests")
      .insert({
        ...toIngestRow(params),
        source_id: "none",
        source_label: "No covering source",
        attribution: `No crash source covers this study area. Checked: ${
          live.checked.map((entry) => entry.label).join(", ") || "no adapters registered"
        }.`,
        coverage_state: "out_of_coverage",
        severity_completeness: "fatal_only",
        status: "no_coverage",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to record crash ingest: ${error.message}`);

    return {
      ingestId: data.id as string,
      status: "no_coverage",
      sourceId: null,
      sourceLabel: null,
      attribution: null,
      coverageState: "out_of_coverage",
      crashCount: 0,
      geocodedCount: 0,
      storedCount: 0,
      stored: false,
      truncated: false,
      yearsCovered: [],
      severityCompleteness: "fatal_only",
      seriousInjuryUpgrades: 0,
      partyCompleteness: "not_supported",
      partyCount: null,
      involvementBasis: null,
      dimensionCoverage: {},
      crashes: null,
      checkedSources: live.checked,
      error: null,
    };
  }

  const adapter = resolution.adapter;

  const { data: created, error: createError } = await params.service
    .from("safety_crash_ingests")
    .insert({
      ...toIngestRow(params),
      source_id: adapter.id,
      source_label: adapter.label,
      attribution: adapter.attribution,
      coverage_state: adapter.coverageState,
      severity_completeness: adapter.severityCompleteness,
      status: "fetching",
    })
    .select("id")
    .single();

  if (createError) throw new Error(`Failed to record crash ingest: ${createError.message}`);
  const ingestId = created.id as string;

  try {
    const fetched = await adapter.fetch({
      bbox: params.bbox,
      years: params.years,
      countyCode: params.countyCode,
      maxRecords: params.maxRecords,
      signal: params.signal,
    });

    let records = dedupeRecords(fetched.records);

    // KSI upgrade. Only CCRS has the injured-person table, and only when the
    // caller wants it. If it fails, keep the crashes and keep the honest
    // "serious injuries not separable" completeness rather than losing the run.
    let severityCompleteness = adapter.severityCompleteness;
    let seriousInjuryUpgrades = 0;
    if (adapter.id === CCRS_SOURCE_ID && params.enrichSeriousInjury !== false) {
      try {
        const upgrade = await applySeriousInjuryUpgrade(records, params.signal);
        records = upgrade.records;
        seriousInjuryUpgrades = upgrade.upgraded;
        severityCompleteness = "kabco_full";
      } catch {
        severityCompleteness = adapter.severityCompleteness;
      }
    }

    // PERSON ROWS. Same degradation contract as the KSI join above: a failure
    // keeps the crashes and records that people were not retrieved. It is the
    // adapter's own optional capability that decides whether to try — the ingest
    // never asks which source this is.
    let partyCompleteness = partyPostureFor(adapter);
    let parties: CrashPartyRecord[] = [];
    let involvementBasis: CrashInvolvementBasis = "crash_flags";
    if (adapter.fetchParties && params.includeParties !== false) {
      try {
        parties = await adapter.fetchParties({
          crashes: records.map((record) => ({
            externalId: record.externalId,
            collisionYear: record.collisionYear,
          })),
          signal: params.signal,
        });
        partyCompleteness = "retrieved";
        const involvement = applyPartyInvolvement(records, parties);
        records = involvement.records;
        if (involvement.recomputed > 0) involvementBasis = "party_rows";
      } catch {
        // Left at `not_retrieved`. The crashes are real and worth keeping, and
        // an empty person table is a claim this run cannot make.
        parties = [];
      }
    }

    const rows = toCrashRows(records, {
      workspaceId: params.workspaceId,
      ingestId,
      sourceId: adapter.id,
    });

    // The crash ids come back from the WRITE rather than from a follow-up
    // SELECT, for two reasons: a batch is bounded at 500 rows and so cannot hit
    // PostgREST's default 1,000-row response cap, and a re-ingest of an
    // already-stored study area returns the existing ids instead of appearing
    // to have written nothing.
    const crashIdByExternalId = new Map<string, string>();
    for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
      const { data: written, error: upsertError } = await params.service
        .from("safety_crashes")
        .upsert(batch, { onConflict: "workspace_id,source_id,external_id" })
        .select("id,external_id");
      if (upsertError) throw new Error(`Failed to persist crashes: ${upsertError.message}`);
      for (const row of (written ?? []) as Array<{ id?: unknown; external_id?: unknown }>) {
        if (typeof row.id === "string" && row.external_id != null) {
          crashIdByExternalId.set(String(row.external_id), row.id);
        }
      }
    }

    let partyCount: number | null = null;
    if (partyCompleteness === "retrieved") {
      const partyRows = toCrashPartyRows(parties, {
        workspaceId: params.workspaceId,
        ingestId,
        sourceId: adapter.id,
        crashIdByExternalId,
      });
      for (let offset = 0; offset < partyRows.length; offset += UPSERT_BATCH_SIZE) {
        const batch = partyRows.slice(offset, offset + UPSERT_BATCH_SIZE);
        const { error: partyError } = await params.service
          .from("safety_crash_parties")
          .upsert(batch, { onConflict: "workspace_id,source_id,external_party_id" });
        // A person-row failure does NOT fail the acquisition — the crashes are
        // already stored and are worth keeping — but it must not leave the run
        // claiming people were retrieved when some were not.
        if (partyError) {
          partyCompleteness = "not_retrieved";
          partyCount = null;
          break;
        }
        partyCount = (partyCount ?? 0) + batch.length;
      }
      if (partyCompleteness === "retrieved" && partyRows.length === 0) partyCount = 0;
    }
    if (partyCompleteness !== "retrieved") involvementBasis = "crash_flags";

    const dimensionCoverage = buildDimensionCoverage(adapter.dimensions, fetched.unmappedByDimension);

    await params.service
      .from("safety_crash_ingests")
      .update({
        status: "ready",
        crash_count: fetched.matchedTotal,
        geocoded_count: fetched.geocodedTotal,
        truncated: fetched.truncated,
        severity_completeness: severityCompleteness,
        dimension_coverage: dimensionCoverage,
        party_completeness: partyCompleteness,
        // Null, not zero, whenever people were not retrieved: a count that could
        // not be read is not a count of none.
        party_count: partyCount,
        involvement_basis: involvementBasis,
        published_through: fetched.publishedCutoff?.publishedThrough ?? null,
        published_through_provenance: fetched.publishedCutoff?.provenance ?? null,
      })
      .eq("id", ingestId);

    return {
      ingestId,
      status: "ready",
      sourceId: adapter.id,
      sourceLabel: adapter.label,
      attribution: adapter.attribution,
      coverageState: adapter.coverageState,
      crashCount: fetched.matchedTotal,
      geocodedCount: fetched.geocodedTotal,
      storedCount: records.length,
      stored: true,
      truncated: fetched.truncated,
      yearsCovered: fetched.yearsCovered,
      publishedThrough: fetched.publishedCutoff?.publishedThrough,
      publishedThroughProvenance: fetched.publishedCutoff?.provenance,
      severityCompleteness,
      seriousInjuryUpgrades,
      partyCompleteness,
      partyCount,
      involvementBasis,
      dimensionCoverage,
      // Stored crashes are read back from `safety_crashes` — the one place a
      // persisted crash point may come from — so none travel in this response.
      crashes: null,
      checkedSources: [],
      error: null,
    };
  } catch (error) {
    // A source outage is an honest state, not a reason to synthesize numbers.
    const message = error instanceof Error ? error.message : "Unknown crash ingest failure";
    await params.service
      .from("safety_crash_ingests")
      .update({ status: "failed", coverage_state: "source_unavailable", fetch_error: message })
      .eq("id", ingestId);

    return {
      ingestId,
      status: "failed",
      sourceId: adapter.id,
      sourceLabel: adapter.label,
      attribution: adapter.attribution,
      coverageState: "source_unavailable",
      crashCount: 0,
      geocodedCount: 0,
      storedCount: 0,
      stored: false,
      truncated: false,
      yearsCovered: [],
      severityCompleteness: adapter.severityCompleteness,
      seriousInjuryUpgrades: 0,
      partyCompleteness: partyPostureFor(adapter),
      partyCount: null,
      involvementBasis: null,
      dimensionCoverage: buildDimensionCoverage(adapter.dimensions),
      crashes: null,
      checkedSources: [],
      error: message,
    };
  }
}
