import "server-only";

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
): Promise<{
  unreadable: boolean;
  links: GuidedComparisonLink[];
  kpis: GuidedComparisonKpi[];
  decisions: GuidedComparisonDecision[];
}> {
  const linksResult = snapshotIds.length
    ? await supabase
        .from("scenario_comparison_model_run_links")
        .select("comparison_snapshot_id, model_run_id, method, scenario_role")
        .in("comparison_snapshot_id", snapshotIds)
    : { data: [], error: null };
  const linksUnreadable = reads.check("exact model outputs on saved guided comparisons", linksResult);
  const links = linksUnreadable ? [] : ((linksResult.data ?? []) as GuidedComparisonLink[]);
  const runIds = [...new Set(links.map((link) => link.model_run_id))];
  const [kpisResult, decisionsResult] = runIds.length
    ? await Promise.all([
        supabase
          .from("model_run_kpis")
          .select("run_id, kpi_name, value, unit")
          .in("run_id", runIds)
          .in("kpi_name", ["total_trips", "daily_vmt"]),
        supabase
          .from("modeling_claim_decisions")
          .select("model_run_id, track, claim_status, status_reason, decided_at")
          .in("model_run_id", runIds)
          .order("decided_at", { ascending: false }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const kpisUnreadable = reads.check("headline results on saved guided comparisons", kpisResult);
  const decisionsUnreadable = reads.check("validation decisions on saved guided comparisons", decisionsResult);
  return {
    unreadable: linksUnreadable || kpisUnreadable || decisionsUnreadable,
    links,
    kpis: kpisUnreadable ? [] : ((kpisResult.data ?? []) as GuidedComparisonKpi[]),
    decisions: decisionsUnreadable ? [] : ((decisionsResult.data ?? []) as GuidedComparisonDecision[]),
  };
}
