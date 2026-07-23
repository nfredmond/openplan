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
 *   2. `crashCount` (reported) and `geocodedCount` (mappable) are stored
 *      separately, because ungeocoded crashes are real crashes that simply
 *      cannot be plotted. Collapsing them would silently understate the study
 *      area's crash burden by roughly a fifth on CCRS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyAreaBbox } from "@/lib/models/study-area";
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
  signal?: AbortSignal;
};

export type IngestCrashesResult = {
  ingestId: string;
  status: "ready" | "failed" | "no_coverage";
  sourceId: string | null;
  sourceLabel: string | null;
  coverageState: string;
  crashCount: number;
  geocodedCount: number;
  storedCount: number;
  truncated: boolean;
  yearsCovered: number[];
  /** How completely severity could be expressed after any KSI enrichment. */
  severityCompleteness: string;
  /** Injury crashes upgraded to KABCO A by the injured-person join. */
  seriousInjuryUpgrades: number;
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

  // No adapter covers this study area. Record that plainly and stop — the UI
  // renders "no crash source covers this area", never an estimate.
  if (resolution.kind === "out_of_coverage") {
    const { data, error } = await params.service
      .from("safety_crash_ingests")
      .insert({
        ...toIngestRow(params),
        source_id: "none",
        source_label: "No covering source",
        attribution: "No registered crash source covers this study area.",
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
      coverageState: "out_of_coverage",
      crashCount: 0,
      geocodedCount: 0,
      storedCount: 0,
      truncated: false,
      yearsCovered: [],
      severityCompleteness: "fatal_only",
      seriousInjuryUpgrades: 0,
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
      coverageState: adapter.coverageState,
      crashCount: fetched.matchedTotal,
      geocodedCount: fetched.geocodedTotal,
      storedCount: records.length,
      truncated: fetched.truncated,
      yearsCovered: fetched.yearsCovered,
      severityCompleteness,
      seriousInjuryUpgrades,
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
      coverageState: "source_unavailable",
      crashCount: 0,
      geocodedCount: 0,
      storedCount: 0,
      truncated: false,
      yearsCovered: [],
      severityCompleteness: adapter.severityCompleteness,
      seriousInjuryUpgrades: 0,
      error: message,
    };
  }
}
