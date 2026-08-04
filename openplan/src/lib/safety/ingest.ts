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
import type { SafetyCrashCollection, SafetyCrashFeature } from "./client-types";
import { readCrashesForStudyArea, type CrashSourceIdentity } from "./read-only-lane";
import { CCRS_SOURCE_ID } from "./sources/ccrs";
import { fetchSeriousInjuryCollisionIds } from "./sources/ccrs-injury";
import { resolveCrashSource } from "./sources/registry";
import type { CrashRecord } from "./sources/types";

/** Rows written per upsert batch — keeps each PostgREST call modest. */
const UPSERT_BATCH_SIZE = 500;

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
  /** How completely severity could be expressed after any KSI enrichment. */
  severityCompleteness: string;
  /** Injury crashes upgraded to KABCO A by the injured-person join. */
  seriousInjuryUpgrades: number;
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
    severity: record.severity,
    killed_count: record.killedCount,
    injured_count: record.injuredCount,
    pedestrian_involved: record.pedestrianInvolved,
    bicyclist_involved: record.bicyclistInvolved,
    latitude: record.latitude,
    longitude: record.longitude,
  }));
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
        severityCompleteness: live.adapter.severityCompleteness,
        seriousInjuryUpgrades: 0,
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

    const rows = toCrashRows(records, {
      workspaceId: params.workspaceId,
      ingestId,
      sourceId: adapter.id,
    });

    for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
      const { error: upsertError } = await params.service
        .from("safety_crashes")
        .upsert(batch, { onConflict: "workspace_id,source_id,external_id" });
      if (upsertError) throw new Error(`Failed to persist crashes: ${upsertError.message}`);
    }

    await params.service
      .from("safety_crash_ingests")
      .update({
        status: "ready",
        crash_count: fetched.matchedTotal,
        geocoded_count: fetched.geocodedTotal,
        truncated: fetched.truncated,
        severity_completeness: severityCompleteness,
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
      severityCompleteness,
      seriousInjuryUpgrades,
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
      crashes: null,
      checkedSources: [],
      error: message,
    };
  }
}
