import type { createClient } from "@/lib/supabase/server";
import { readFrozenPlanIdentity } from "./frozen-identity";

type Report = { id: string; workspace_id: string; land_use_plan_id?: string | null; report_type: string | null };

/** Resolve this report's edition without substituting the plan's latest adopted version. */
export async function loadAdoptedReportSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  report: Report,
  metadata: Record<string, unknown>,
) {
  if (!report.land_use_plan_id) return null;
  const frozen = metadata.frozenSnapshot && typeof metadata.frozenSnapshot === "object" && !Array.isArray(metadata.frozenSnapshot)
    ? metadata.frozenSnapshot as Record<string, unknown> : null;
  const versionId = typeof metadata.versionId === "string" ? metadata.versionId : null;
  const result = versionId ? await supabase.from("land_use_plan_versions")
    .select("id, workspace_id, plan_id, version_number, state, content_hash, published_report_id")
    .eq("id", versionId).eq("plan_id", report.land_use_plan_id).eq("workspace_id", report.workspace_id).maybeSingle() : null;
  const version = result?.data;
  const identity = report.report_type === "land_use_plan_packet" && metadata.kind !== "land_use_plan_implementation_report"
    && metadata.landUsePlanId === report.land_use_plan_id && frozen && !result?.error
    && version && version.id === versionId && version.plan_id === report.land_use_plan_id && version.workspace_id === report.workspace_id
    && ["adopted", "superseded", "repealed"].includes(version.state)
    && version.published_report_id === report.id && metadata.contentHash === version.content_hash && version.content_hash
    ? readFrozenPlanIdentity(frozen, report.land_use_plan_id, version.id, version.version_number, version.content_hash) : null;
  if (!identity || !frozen || !version) return null;
  return { identity, frozen, versionId: version.id, contentHash: version.content_hash };
}
