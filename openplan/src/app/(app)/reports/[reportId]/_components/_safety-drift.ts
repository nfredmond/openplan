import { formatCompactDateTime } from "./_helpers";
import type { DriftItem } from "./_types";
import { artifactSafetyEvidenceReadFailed } from "@/lib/reports/report-registry-freshness";

type SafetyIngestReadResult = {
  data: Array<{ id?: string; created_at?: string | null }> | null;
  error: { message?: string } | null;
};

type SafetyIngestLimitBuilder = {
  limit(value: number): PromiseLike<SafetyIngestReadResult>;
};

type SafetyIngestOrderBuilder = {
  order(column: string, options: { ascending: boolean }): SafetyIngestLimitBuilder;
};

type SafetyIngestEqBuilder = {
  eq(column: string, value: string): SafetyIngestEqBuilder & SafetyIngestOrderBuilder;
};

export type ReportSafetyFreshnessSupabaseLike = {
  from(table: "safety_crash_ingests"): {
    select(columns: string): SafetyIngestEqBuilder;
  };
};

/** Read the latest project-linked crash acquisition used by packet freshness. */
export async function loadLatestProjectSafetyIngest(
  supabase: ReportSafetyFreshnessSupabaseLike,
  workspaceId: string,
  projectId: string | null
): Promise<SafetyIngestReadResult> {
  if (!projectId) return { data: [], error: null };
  return supabase
    .from("safety_crash_ingests")
    .select("id, created_at")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
}

export function describeSafetyEvidenceReadFailure(
  readFailed: boolean,
  result: SafetyIngestReadResult
): string | null {
  return readFailed ? result.error?.message ?? "no message reported" : null;
}

/** Compare a packet snapshot with the project crash acquisition register. */
export function buildProjectSafetyDriftItem(input: {
  readFailed: boolean;
  result: SafetyIngestReadResult;
  packetGeneratedAt: string | null;
}): DriftItem | null {
  const latest = input.result.data?.[0];
  if (input.readFailed || !latest?.created_at || !input.packetGeneratedAt) return null;
  const changed = new Date(latest.created_at).getTime() > new Date(input.packetGeneratedAt).getTime();
  return {
    key: "safety-evidence",
    label: "Crash evidence",
    status: changed ? "updated" : "unchanged",
    detail: changed
      ? `A newer project crash acquisition is not in this packet. Packet generated ${formatCompactDateTime(input.packetGeneratedAt)}; latest crash evidence attached ${formatCompactDateTime(latest.created_at)}.`
      : "The latest project crash acquisition predates this packet.",
  };
}

export function buildArtifactSafetyReadDriftItem(
  artifactMetadata: Record<string, unknown> | null | undefined
): DriftItem | null {
  return artifactSafetyEvidenceReadFailed(artifactMetadata)
    ? {
        key: "safety-evidence-read",
        label: "Crash evidence read",
        status: "updated",
        detail: "This packet recorded that its project-linked crash evidence could not be read. It is not current or ready until regeneration completes with a readable safety section.",
      }
    : null;
}
