import "server-only";
import { currentModelResultRows, readModelAttemptOutputs, currentCompletedModelOutputs } from "./attempt-output-read";

import type { createClient } from "@/lib/supabase/server";
import type { ReadFailureLog } from "@/lib/ui/read-failures";
import type {
  GuidedComparisonDecision,
  GuidedComparisonKpi,
  GuidedComparisonLink,
} from "@/lib/models/guided-comparison-results";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export async function loadGuidedComparisonEvidence(
  supabase: ServerSupabase,
  reads: ReadFailureLog,
  snapshotIds: readonly string[],
  workspaceId: string,
): Promise<{
  unreadable: boolean;
  links: GuidedComparisonLink[];
  kpis: GuidedComparisonKpi[];
  decisions: GuidedComparisonDecision[];
}> {
  const linksResult = snapshotIds.length
    ? await supabase
        .from("scenario_comparison_model_run_links")
        .select("comparison_snapshot_id, model_run_id, model_run_artifact_id, method, scenario_role")
        .in("comparison_snapshot_id", snapshotIds)
    : { data: [], error: null };
  const linksUnreadable = reads.check("exact model outputs on saved guided comparisons", linksResult);
  const links = linksUnreadable ? [] : ((linksResult.data ?? []) as GuidedComparisonLink[]);
  const runIds = [...new Set(links.map((link) => link.model_run_id))];
  for (const link of links as Array<GuidedComparisonLink & { model_run_artifact_id?: string }>) {
    // An existing snapshot names its original output. A fresh attempt is not
    // permission to replace that binding with the latest same-run numbers.
    const original = await supabase.from("model_runs").select("id, attempt_managed")
      .eq("id", link.model_run_id).eq("workspace_id", workspaceId).maybeSingle();
    if (reads.check("saved comparison run custody", original) || !original.data) return { unreadable: true, links, kpis: [], decisions: [] };
    if (original.data.attempt_managed === true) {
      const custody = await readModelAttemptOutputs(workspaceId, link.model_run_id);
      if (!custody.available || !currentCompletedModelOutputs(custody, "artifact").some(row => row.id === link.model_run_artifact_id)) {
        reads.check("saved comparison original output is no longer current; original artifacts remain retained", { error: { message: "Saved comparison output requires its original attempt binding" } });
        return { unreadable: true, links, kpis: [], decisions: [] };
      }
    }
  }
  const [kpisResult, decisionsResult] = runIds.length
    ? await Promise.all([
        supabase
          .from("model_run_kpis")
          .select("id, run_id, attempt_id, kpi_name, value, unit")
          .in("run_id", runIds)
          .in("kpi_name", [
            "total_trips",
            "daily_vmt",
            "activitysim_trips",
            "activitysim_daily_vmt",
          ]),
        supabase
          .from("modeling_claim_decisions")
          .select("model_run_id, track, claim_status, status_reason, decided_at")
          .in("model_run_id", runIds)
          .order("decided_at", { ascending: false }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const currentKpis = kpisResult.error ? { data: [], error: kpisResult.error }
    : await currentModelResultRows(supabase, workspaceId, runIds, "kpi", kpisResult.data ?? [], false, ["total_trips", "daily_vmt", "activitysim_trips", "activitysim_daily_vmt"]);
  const kpisUnreadable = reads.check("headline results on saved guided comparisons", currentKpis);
  const decisionsUnreadable = reads.check("validation decisions on saved guided comparisons", decisionsResult);
  return {
    unreadable: linksUnreadable || kpisUnreadable || decisionsUnreadable,
    links,
    kpis: kpisUnreadable ? [] : (currentKpis.data as GuidedComparisonKpi[]),
    decisions: decisionsUnreadable ? [] : ((decisionsResult.data ?? []) as GuidedComparisonDecision[]),
  };
}
