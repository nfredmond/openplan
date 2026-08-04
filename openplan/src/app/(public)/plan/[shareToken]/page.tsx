import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { formatRtpPortfolioRoleLabel } from "@/lib/rtp/catalog";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  buildPortfolioPriorityNarrative,
  buildRtpPriorityRationale,
  priorityTierLabel,
} from "@/lib/rtp/priority-scoring";
import {
  RTP_EVIDENCE_KPI_NAMES,
  formatRtpEvidenceRunDisclosureLine,
  formatRtpModelingEvidenceLine,
  loadRtpEvidenceRunDisclosures,
  rtpEvidenceRunWarnings,
  summarizeRtpModelingEvidence,
  type RtpEvidenceSupabaseLike,
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

  // A read that failed may not be rendered as an answer — least of all here,
  // where the reader is a member of the public who has no way to tell an empty
  // plan from a broken query. Both reads below keep their `error`.
  const reads = new ReadFailureLog();

  const linksResult = await supabase
    .from("project_rtp_cycle_links")
    .select("id, portfolio_role, priority_rationale, priority_scores, evidence_model_run_id, projects(id, name, status, summary)")
    .eq("rtp_cycle_id", cycle.id);
  const linksFailed = reads.check("the projects in this plan", linksResult);

  const links = (linksResult.data ?? []) as LinkRow[];
  const evidenceRunIds = Array.from(
    new Set(links.map((link) => link.evidence_model_run_id).filter((id): id is string => Boolean(id))),
  );
  const linkedProjectIds = Array.from(
    new Set(links.map((link) => normalizeProject(link.projects)?.id).filter((id): id is string => Boolean(id))),
  );

  // Committed award dollars per project — operator-entered award records only,
  // so a project with none simply shows no funding line.
  const awardsResult = linkedProjectIds.length
    ? await supabase
        .from("funding_awards")
        .select("project_id, title, awarded_amount")
        .in("project_id", linkedProjectIds)
    : { data: [], error: null };
  reads.check("committed funding for these projects", awardsResult);
  const awardData = awardsResult.data;
  const awardsByProject = new Map<string, Array<{ title: string; amount: number }>>();
  for (const row of (awardData ?? []) as Array<{ project_id: string; title: string; awarded_amount: number | string | null }>) {
    const amount = Number(row.awarded_amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const list = awardsByProject.get(row.project_id) ?? [];
    list.push({ title: row.title, amount });
    awardsByProject.set(row.project_id, list);
  }
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  // Engine + status + claim tier travel with the title: a run's name alone
  // cannot tell a reader whether it is a calibrated run or a failed sketch.
  const [kpiResult, evidenceDisclosures] = await Promise.all([
    evidenceRunIds.length
      ? supabase.from("model_run_kpis").select("run_id, kpi_name, value, geometry_ref").in("run_id", evidenceRunIds).in("kpi_name", [...RTP_EVIDENCE_KPI_NAMES])
      : Promise.resolve({ data: [], error: null }),
    loadRtpEvidenceRunDisclosures(supabase as unknown as RtpEvidenceSupabaseLike, evidenceRunIds),
  ]);

  const kpiRows = (kpiResult.data ?? []) as RtpModelingEvidenceKpiRow[];
  // A failed KPI read must not publish "No VMT/GHG KPIs on this run" (or a
  // silent omission of attributed evidence) on a public page. The failure
  // travels into the evidence summary as its own state.
  const evidenceKpiReadFailed = Boolean(kpiResult.error);
  const runTitleById = evidenceDisclosures.titleByRunId;

  const portfolio = buildPortfolioPriorityNarrative(links.map((link) => link.priority_scores ?? {}));

  const rankedProjects = links
    .map((link) => {
      const project = normalizeProject(link.projects);
      const priority = buildRtpPriorityRationale(link.priority_scores ?? {});
      const evidence = link.evidence_model_run_id
        ? summarizeRtpModelingEvidence(link.evidence_model_run_id, runTitleById.get(link.evidence_model_run_id) ?? null, kpiRows, {
            kpiReadFailed: evidenceKpiReadFailed,
          })
        : null;
      const awards = project ? awardsByProject.get(project.id) ?? [] : [];
      const disclosure = link.evidence_model_run_id ? evidenceDisclosures.disclosureFor(link.evidence_model_run_id) : null;
      return { id: link.id, project, portfolioRole: link.portfolio_role, priorityRationale: link.priority_rationale, priority, evidence, disclosure, awards };
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

      {/*
        Disclosed to the reader, not just logged. The database's own message is
        deliberately NOT rendered here — `reads.messages()` is operator detail,
        and this page is public. What a resident needs is the fact that part of
        the page did not load, so an empty list below is not read as an answer.
      */}
      {reads.any ? (
        <section
          role="status"
          className="mt-6 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Part of this plan could not be loaded
          </h2>
          <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">{reads.describe()}</p>
          <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">
            Please check back, or contact the agency that published this plan.
          </p>
        </section>
      ) : null}

      {portfolio.scoredCount > 0 ? (
        <section className="mt-6 rounded-lg border border-emerald-300/50 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <h2 className="text-sm font-semibold text-foreground">Why this plan prioritizes what it does</h2>
          <p className="mt-1 text-sm text-muted-foreground">{portfolio.narrative}</p>
        </section>
      ) : null}

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Projects, ranked by priority</h2>
        {rankedProjects.length === 0 ? (
          linksFailed ? (
            // "No projects have been published" is a claim about the plan. A
            // failed read cannot make it — and on a public page that sentence
            // would tell a resident the agency has funded nothing.
            <p className="text-sm text-muted-foreground">
              The project list could not be loaded, so it is not shown. This does not mean the plan
              has no projects.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No projects have been published for this plan yet.</p>
          )
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
              {entry.evidence ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Modeling evidence</span>
                    {entry.evidence.runTitle ? ` (${entry.evidence.runTitle})` : ""}: {formatRtpModelingEvidenceLine(entry.evidence)}
                  </p>
                  {entry.disclosure ? (
                    <p className="mt-0.5">
                      <span className="font-medium text-foreground">Cited run</span>: {formatRtpEvidenceRunDisclosureLine(entry.disclosure)}
                    </p>
                  ) : null}
                  {entry.disclosure
                    ? rtpEvidenceRunWarnings(entry.disclosure).map((warning) => (
                        <p
                          key={warning}
                          className="mt-1 rounded border border-amber-300/60 bg-amber-50/60 px-2 py-1 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                        >
                          {warning}
                        </p>
                      ))
                    : null}
                </div>
              ) : null}
              {entry.awards.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Committed funding</span>:{" "}
                  {currency.format(entry.awards.reduce((sum, award) => sum + award.amount, 0))} across{" "}
                  {entry.awards.length === 1 ? "1 award" : `${entry.awards.length} awards`} ·{" "}
                  {entry.awards.map((award) => award.title).join(" · ")}
                </p>
              ) : null}
            </article>
          ))
        )}
      </section>

      <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>
          This is a read-only public view published by the agency. Modeling figures are screening-grade and cited to a
          specific model run; committed funding reflects award records the agency has entered, and full documentation is
          in the adopted board packet. Priorities reflect local, county, state, and federal goals (VMT/GHG reduction,
          safety, equity, and multimodal access).
        </p>
      </footer>
    </main>
  );
}
