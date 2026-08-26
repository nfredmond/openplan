import type { SupabaseClient } from "@supabase/supabase-js";

export const REPORT_SAFETY_SELECTION_VERSION = "openplan.report_safety_selection.v1";

export type ReportSafetyIngestSelection = { ingestId: string };

type ReportSafetyIngestOption = {
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
