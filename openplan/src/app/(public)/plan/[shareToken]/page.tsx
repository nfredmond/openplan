import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { formatRtpPortfolioRoleLabel } from "@/lib/rtp/catalog";
import {
  buildPortfolioPriorityNarrative,
  buildRtpPriorityRationale,
  priorityTierLabel,
} from "@/lib/rtp/priority-scoring";
import {
  RTP_EVIDENCE_KPI_NAMES,
  formatRtpModelingEvidenceLine,
  summarizeRtpModelingEvidence,
  type RtpModelingEvidenceKpiRow,
} from "@/lib/rtp/modeling-evidence";

export const metadata = {
  title: "What we're funding and why · Regional Transportation Plan",
  description: "A public, read-only view of an RTP project portfolio: priorities, the reasons behind them, and the policy basis.",
};

type ProjectRef = { id: string; name: string; status: string | null; summary: string | null };

type LinkRow = {
  id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  priority_scores: Record<string, number> | null;
  evidence_model_run_id: string | null;
  projects: ProjectRef | ProjectRef[] | null;
};

function normalizeProject(value: ProjectRef | ProjectRef[] | null): ProjectRef | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function PublicRtpWhyPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params;
  if (!shareToken || shareToken.length < 8) {
    notFound();
  }

  const supabase = createServiceRoleClient();

  const { data: cycleData } = await supabase
    .from("rtp_cycles")
    .select("id, title, status, geography_label, horizon_start_year, horizon_end_year, summary")
    .eq("public_share_token", shareToken)
    .eq("public_share_enabled", true)
    .maybeSingle();

  if (!cycleData) {
    notFound();
  }

  const cycle = cycleData as {
    id: string;
    title: string;
    status: string;
    geography_label: string | null;
    horizon_start_year: number | null;
    horizon_end_year: number | null;
    summary: string | null;
  };

  const { data: linkData } = await supabase
    .from("project_rtp_cycle_links")
    .select("id, portfolio_role, priority_rationale, priority_scores, evidence_model_run_id, projects(id, name, status, summary)")
    .eq("rtp_cycle_id", cycle.id);

  const links = (linkData ?? []) as LinkRow[];
  const evidenceRunIds = Array.from(
    new Set(links.map((link) => link.evidence_model_run_id).filter((id): id is string => Boolean(id))),
  );

  const [kpiResult, runTitleResult] = evidenceRunIds.length
    ? await Promise.all([
        supabase.from("model_run_kpis").select("run_id, kpi_name, value").in("run_id", evidenceRunIds).in("kpi_name", [...RTP_EVIDENCE_KPI_NAMES]),
        supabase.from("model_runs").select("id, run_title").in("id", evidenceRunIds),
      ])
    : [{ data: [] }, { data: [] }];

  const kpiRows = (kpiResult.data ?? []) as RtpModelingEvidenceKpiRow[];
  const runTitleById = new Map(((runTitleResult.data ?? []) as Array<{ id: string; run_title: string }>).map((run) => [run.id, run.run_title]));

  const portfolio = buildPortfolioPriorityNarrative(links.map((link) => link.priority_scores ?? {}));

  const rankedProjects = links
    .map((link) => {
      const project = normalizeProject(link.projects);
      const priority = buildRtpPriorityRationale(link.priority_scores ?? {});
      const evidence = link.evidence_model_run_id
        ? summarizeRtpModelingEvidence(link.evidence_model_run_id, runTitleById.get(link.evidence_model_run_id) ?? null, kpiRows)
        : null;
      return { id: link.id, project, portfolioRole: link.portfolio_role, priorityRationale: link.priority_rationale, priority, evidence };
    })
    .sort((a, b) => b.priority.summary.composite - a.priority.summary.composite);

  const horizon =
    typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
      ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Regional Transportation Plan · Public view
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{cycle.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What we&apos;re funding and why
          {cycle.geography_label ? ` · ${cycle.geography_label}` : ""}
          {horizon ? ` · Horizon ${horizon}` : ""}
        </p>
        {cycle.summary ? <p className="mt-3 text-sm text-muted-foreground">{cycle.summary}</p> : null}
      </header>

      {portfolio.scoredCount > 0 ? (
        <section className="mt-6 rounded-lg border border-emerald-300/50 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <h2 className="text-sm font-semibold text-foreground">Why this plan prioritizes what it does</h2>
          <p className="mt-1 text-sm text-muted-foreground">{portfolio.narrative}</p>
        </section>
      ) : null}

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Projects, ranked by priority</h2>
        {rankedProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects have been published for this plan yet.</p>
        ) : (
          rankedProjects.map((entry) => (
            <article key={entry.id} className="rounded-lg border border-border bg-background/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground">
                  {formatRtpPortfolioRoleLabel(entry.portfolioRole)}
                </span>
                {entry.priority.summary.scoredCriteria > 0 ? (
                  <span className="rounded border border-emerald-300/60 bg-emerald-50/60 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                    Priority {entry.priority.summary.composite}/100 · {priorityTierLabel(entry.priority.summary.tier)}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 text-base font-semibold text-foreground">{entry.project?.name ?? "Project"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {entry.priority.summary.scoredCriteria > 0
                  ? entry.priority.narrative
                  : entry.priorityRationale?.trim() || entry.project?.summary?.trim() || "Prioritization rationale to be published."}
              </p>
              {entry.evidence && (entry.evidence.hasVmt || entry.evidence.hasGhg) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Modeling evidence</span>
                  {entry.evidence.runTitle ? ` (${entry.evidence.runTitle})` : ""}: {formatRtpModelingEvidenceLine(entry.evidence)}
                </p>
              ) : null}
            </article>
          ))
        )}
      </section>

      <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>
          This is a read-only public view published by the agency. Modeling figures are screening-grade and cited to a
          specific model run; detailed funding and full documentation are in the adopted board packet. Priorities reflect
          local, county, state, and federal goals (VMT/GHG reduction, safety, equity, and multimodal access).
        </p>
      </footer>
    </main>
  );
}
