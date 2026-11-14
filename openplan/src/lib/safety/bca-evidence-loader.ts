/**
 * Read the project's saved safety plans for the benefit-cost workbench.
 *
 * A saved safety plan is a report whose metadata holds a `safetyActionPlan`
 * (an acquisition id and the segments a planner treated with countermeasures).
 * For each plan this reads the acquisition, the project's stored road lines and
 * the severe crashes the high-injury network counts, places the crashes on
 * segments by the network's own rule, and counts the treated segments by
 * severity and year. Reads only. Every failure is an unavailable plan with its
 * reason, never zero crashes.
 */

import { readEveryPage } from "@/lib/supabase/paged-read";
import { readReportSafetyActionPlan } from "@/lib/reports/safety-action-plan";
import {
  SAFETY_ACQUISITION_CUSTODY_UNAVAILABLE,
  SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION,
  hasCompleteCrashCustody,
  readSafetyCrashEvidenceIngest,
} from "./crash-evidence";
import {
  describeHighInjuryNetworkUnavailable,
  highInjuryNetworkBasis,
  highInjuryNetworkSeverities,
  placeHighInjuryNetworkCrashes,
} from "./high-injury-network";
import { HIGH_INJURY_NETWORK_MAX_CRASHES } from "./high-injury-network-loader";
import { readCachedUsRoadContext, type SafetyRoadContextFeature } from "./road-context";
import { seriousInjuryAvailabilityForRecord } from "./serious-injury-availability";
import { isCrashSeverity } from "./vocabulary";
import {
  summarizeBcaTreatedSegments,
  type BcaSafetyEvidenceRead,
  type BcaSafetyPlanOffer,
  type BcaSegmentCrash,
} from "./bca-evidence";

export const BCA_SAFETY_REPORT_PROJECTION = "id, title, metadata_json";
export const BCA_SAFETY_ROAD_PROJECTION = "id, road_name, geometry_geojson, source_id, source_vintage";
export const BCA_SEGMENT_CRASH_PROJECTION = "id, longitude, latitude, severity, collision_year, killed_count";
/** Newest saved plans offered. Every report is read first, so a report with no plan cannot push a plan out. */
export const BCA_SAFETY_PLAN_LIMIT = 20;
/** Same cap as the report packet's road read, so the same lines are cut into the same segments. */
const ROAD_LIMIT = 2000;

type Result = { data: unknown; error: unknown; count?: number | null };
/** The query chain this loader uses. Narrow so tests can type their fakes. */
type BcaSafetyQuery = PromiseLike<Result> & {
  eq(column: string, value: unknown): BcaSafetyQuery;
  in(column: string, values: readonly unknown[]): BcaSafetyQuery;
  gte(column: string, value: unknown): BcaSafetyQuery;
  lte(column: string, value: unknown): BcaSafetyQuery;
  order(column: string, options: { ascending: boolean }): BcaSafetyQuery;
  range(from: number, to: number): BcaSafetyQuery;
  limit(count: number): BcaSafetyQuery;
};
export type BcaSafetySupabaseLike = {
  from(table: string): { select(columns: string, options?: { count: "exact"; head?: boolean }): BcaSafetyQuery };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readCrash(row: unknown): BcaSegmentCrash | null {
  const r = record(row);
  if (!r || typeof r.id !== "string" || !isCrashSeverity(r.severity)) return null;
  const longitude = Number(r.longitude);
  const latitude = Number(r.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const year = typeof r.collision_year === "number" && Number.isInteger(r.collision_year) ? r.collision_year : null;
  const killed = typeof r.killed_count === "number" && Number.isInteger(r.killed_count) && r.killed_count >= 0 ? r.killed_count : null;
  return { id: r.id, longitude, latitude, severity: r.severity, collisionYear: year, killedCount: killed };
}

/** Every crash of the given severities and years inside the acquisition's bounds, or null when the read is incomplete. */
async function readSegmentCrashes(
  supabase: BcaSafetySupabaseLike,
  scope: { workspaceId: string; ingestId: string; bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }; severities: readonly string[]; years: readonly number[] },
): Promise<{ status: "read"; crashes: BcaSegmentCrash[] } | { status: "failed" } | { status: "too_many" }> {
  const scoped = (columns: string, options?: { count: "exact"; head?: boolean }) =>
    supabase.from("safety_crashes").select(columns, options)
      .eq("workspace_id", scope.workspaceId)
      .eq("ingest_id", scope.ingestId)
      .gte("longitude", scope.bbox.minLon)
      .lte("longitude", scope.bbox.maxLon)
      .gte("latitude", scope.bbox.minLat)
      .lte("latitude", scope.bbox.maxLat)
      .in("severity", [...scope.severities])
      .in("collision_year", [...scope.years]);
  const counted = await scoped("id", { count: "exact", head: true });
  if (counted.error || typeof counted.count !== "number" || !Number.isInteger(counted.count)) return { status: "failed" };
  if (counted.count > HIGH_INJURY_NETWORK_MAX_CRASHES) return { status: "too_many" };
  const read = await readEveryPage<unknown, unknown>(
    (from, to) => scoped(BCA_SEGMENT_CRASH_PROJECTION).order("id", { ascending: true }).range(from, to) as PromiseLike<{ data: unknown[] | null; error: unknown }>,
    { pageSize: 1000 },
  );
  // A short read is a failure, never fewer crashes.
  if (!read.complete || read.rows.length !== counted.count) return { status: "failed" };
  const crashes = read.rows.map(readCrash);
  if (crashes.some((crash) => crash === null)) return { status: "failed" };
  return { status: "read", crashes: crashes as BcaSegmentCrash[] };
}

/**
 * Offer every saved safety plan on this project. `failed` means the plan list
 * itself could not be read, which is not a finding that no plan exists.
 */
export async function loadBcaSafetyPlanOffers(
  supabase: BcaSafetySupabaseLike,
  input: { workspaceId: string; projectId: string },
): Promise<BcaSafetyEvidenceRead> {
  try {
    const reports = await readEveryPage<unknown, unknown>(
      (from, to) => supabase.from("reports").select(BCA_SAFETY_REPORT_PROJECTION)
        .eq("workspace_id", input.workspaceId)
        .eq("project_id", input.projectId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as PromiseLike<{ data: unknown[] | null; error: unknown }>,
      { pageSize: 1000 },
    );
    if (!reports.complete) return { status: "failed" };
    const everySaved = reports.rows.flatMap((row) => {
      const r = record(row);
      const plan = readReportSafetyActionPlan(r?.metadata_json);
      if (!r || typeof r.id !== "string" || !plan || plan.attachments.length === 0) return [];
      return [{ reportId: r.id, reportTitle: typeof r.title === "string" && r.title.trim() ? r.title : "Untitled report", plan }];
    });
    if (everySaved.length === 0) return { status: "read", plans: [], plansNotShown: 0 };
    const saved = everySaved.slice(0, BCA_SAFETY_PLAN_LIMIT);
    const plansNotShown = everySaved.length - saved.length;

    const ingestIds = Array.from(new Set(saved.map((item) => item.plan.ingestId)));
    const [ingests, roadsRead] = await Promise.all([
      supabase.from("safety_crash_ingests").select(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION)
        .eq("workspace_id", input.workspaceId)
        .eq("project_id", input.projectId)
        .in("id", ingestIds),
      supabase.from("safety_road_context_features").select(BCA_SAFETY_ROAD_PROJECTION)
        .eq("workspace_id", input.workspaceId)
        .eq("project_id", input.projectId)
        .limit(ROAD_LIMIT),
    ]);
    const roads: SafetyRoadContextFeature[] | null = roadsRead.error || !Array.isArray(roadsRead.data)
      ? null
      : readCachedUsRoadContext(roadsRead.data.map((row) => {
          const r = record(row) ?? {};
          return { id: r.id, name: r.road_name, geometry_geojson: r.geometry_geojson, source: r.source_id, vintage: r.source_vintage };
        }));
    const ingestRows = ingests.error || !Array.isArray(ingests.data) ? null : ingests.data;

    const plans: BcaSafetyPlanOffer[] = [];
    for (const { reportId, reportTitle, plan } of saved) {
      const base = { reportId, reportTitle, ingestId: plan.ingestId };
      const unavailable = (reason: string) => plans.push({ status: "unavailable", ...base, reason });
      const row = ingestRows?.map((item) => record(item)).find((item) => item?.id === plan.ingestId) ?? null;
      const ingest = row ? readSafetyCrashEvidenceIngest(row) : null;
      if (!ingestRows) { unavailable("The crash acquisition could not be read. That is a failed read, not zero crashes."); continue; }
      if (!ingest) { unavailable("This plan's crash acquisition is no longer on the project."); continue; }
      if (ingest.status !== "ready") { unavailable("This plan's crash acquisition has not finished."); continue; }
      const basis = highInjuryNetworkBasis(ingest.severityCompleteness);
      if (!basis) { unavailable(describeHighInjuryNetworkUnavailable("severity_coverage_unknown")); continue; }
      if (!ingest.scopeBounds) { unavailable("This acquisition has no usable bounds, so its crashes cannot be placed."); continue; }
      if (roads === null) { unavailable(describeHighInjuryNetworkUnavailable("road_read_failed")); continue; }
      const years = Array.from(new Set(ingest.yearsRequested)).filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2100).sort((a, b) => a - b);
      if (years.length === 0) { unavailable(describeHighInjuryNetworkUnavailable("year_scope_unavailable")); continue; }

      const stored = await supabase.from("safety_crashes").select("id", { count: "exact", head: true })
        .eq("workspace_id", input.workspaceId).eq("ingest_id", ingest.id);
      if (!hasCompleteCrashCustody(ingest, stored.error ? null : stored.count ?? null)) { unavailable(SAFETY_ACQUISITION_CUSTODY_UNAVAILABLE); continue; }

      const read = await readSegmentCrashes(supabase, {
        workspaceId: input.workspaceId, ingestId: ingest.id, bbox: ingest.scopeBounds,
        severities: highInjuryNetworkSeverities(basis), years,
      });
      if (read.status === "failed") { unavailable(describeHighInjuryNetworkUnavailable("crash_read_failed")); continue; }
      if (read.status === "too_many") { unavailable(describeHighInjuryNetworkUnavailable("too_many_crashes")); continue; }

      const placements = placeHighInjuryNetworkCrashes({ crashes: read.crashes, basis, roads });
      if (!placements) { unavailable(describeHighInjuryNetworkUnavailable("road_read_failed")); continue; }
      const availability = seriousInjuryAvailabilityForRecord({ sourceId: ingest.sourceId, severityCompleteness: ingest.severityCompleteness });
      const caveats: string[] = [];
      if (ingest.truncated) caveats.push("Retrieval stopped at the record cap, so these counts are a floor.");
      if (roads.length === 0) caveats.push("No road lines are stored for this project, so crashes are grouped by half-mile square, as on the Safety page.");
      plans.push({
        status: "ready",
        ...base,
        sourceId: ingest.sourceId ?? null,
        sourceLabel: ingest.sourceLabel ?? "Crash source not recorded",
        coverage: availability.statement,
        years,
        // The ranking falls back to fatal crashes both when the source holds
        // no injury crashes and when it does not separate the serious ones.
        // Those are different statements about the source.
        seriousInjury: basis === "ksi" ? "counted" : ingest.severityCompleteness === "fatal_only" ? "not_in_source" : "not_separated",
        caveats,
        segments: summarizeBcaTreatedSegments({
          attachments: plan.attachments, crashes: read.crashes, placements, seriousInjuryCounted: basis === "ksi", years,
        }),
      });
    }
    return { status: "read", plans, plansNotShown };
  } catch {
    return { status: "failed" };
  }
}
