import type { SupabaseClient } from "@supabase/supabase-js";

export const REPORT_SAFETY_SELECTION_VERSION = "openplan.report_safety_selection.v1";

export type ReportSafetyIngestSelection = { ingestId: string };

export type ReportSafetyIngestOption = {
  id: string;
  sourceLabel: string;
  createdAt: string;
  crashCount: number;
  geocodedCount: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Read the one planner-selected crash acquisition frozen into a report. */
export function readReportSafetyIngestSelections(
  metadata: unknown,
): ReportSafetyIngestSelection[] {
  const rows = record(metadata)?.safetyIngestSelections;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.flatMap((value) => {
    const ingestId = record(value)?.ingestId;
    if (typeof ingestId !== "string" || !ingestId || seen.has(ingestId)) return [];
    seen.add(ingestId);
    return [{ ingestId }];
  }).slice(0, 1);
}

/** Preserve unrelated report metadata while replacing the selected pull. */
export function writeReportSafetyIngestSelections(
  metadata: unknown,
  selections: readonly ReportSafetyIngestSelection[],
): Record<string, unknown> {
  return {
    ...(record(metadata) ?? {}),
    safetyIngestSelectionsVersion: REPORT_SAFETY_SELECTION_VERSION,
    safetyIngestSelections: selections.slice(0, 1).map(({ ingestId }) => ({ ingestId })),
  };
}

/** Load only ready crash acquisitions belonging to this report's project. */
export async function loadReportSafetyIngestOptions(
  supabase: SupabaseClient,
  workspaceId: string,
  projectId: string,
) {
  const result = await supabase
    .from("safety_crash_ingests")
    .select("id, source_label, created_at, crash_count, geocoded_count")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(20);

  return {
    error: result.error,
    data: result.data?.map((row) => ({
      id: row.id as string,
      sourceLabel: (row.source_label as string | null) ?? "Crash acquisition",
      createdAt: row.created_at as string,
      crashCount: Number(row.crash_count ?? 0),
      geocodedCount: Number(row.geocoded_count ?? 0),
    })) satisfies ReportSafetyIngestOption[] | undefined,
  };
}

/** The projection behind each project's report-creation crash evidence choice. */
const REPORT_CREATION_SAFETY_INGEST_PROJECTION =
  "id, project_id, source_label, created_at, crash_count, geocoded_count";

/** The same per-project limit the report's own evidence control offers. */
const REPORT_SAFETY_OPTIONS_PER_PROJECT = 20;

/**
 * Ready crash acquisitions attached to any project in the workspace, grouped
 * by project, for the new-report flow (KI-2026-08-31-015).
 *
 * Newest first and capped at PostgREST's 1,000-row page: a workspace past
 * that loses its oldest acquisitions from this list only. The report's own
 * evidence control still reads them by project.
 */
export async function loadReportSafetyIngestOptionsByProject(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const result = await supabase
    .from("safety_crash_ingests")
    .select(REPORT_CREATION_SAFETY_INGEST_PROJECTION)
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")
    .not("project_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (result.error) return { error: result.error, data: null };
  const byProject: Record<string, ReportSafetyIngestOption[]> = {};
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
    const projectId = typeof row.project_id === "string" ? row.project_id : null;
    if (!projectId || typeof row.id !== "string" || typeof row.created_at !== "string") continue;
    const options = (byProject[projectId] ??= []);
    if (options.length >= REPORT_SAFETY_OPTIONS_PER_PROJECT) continue;
    options.push({
      id: row.id,
      sourceLabel: (row.source_label as string | null) ?? "Crash acquisition",
      createdAt: row.created_at,
      crashCount: Number(row.crash_count ?? 0),
      geocodedCount: Number(row.geocoded_count ?? 0),
    });
  }
  return { error: null, data: byProject };
}
