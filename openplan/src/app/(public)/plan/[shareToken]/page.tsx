import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { formatRtpPortfolioRoleLabel } from "@/lib/rtp/catalog";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { RtpCycleProjectMap } from "@/components/rtp/rtp-cycle-project-map";
import { MAP_FEATURE_LAYER_LIMIT } from "@/lib/cartographic/layer-disclosure";
import {
  buildRtpCycleProjectFeatureCollection,
  RTP_CYCLE_PROJECT_MAP_COLUMNS,
  type RtpCycleProjectLinkRow,
} from "@/lib/cartographic/rtp-cycle-project-layer";
import {
  buildPortfolioPriorityNarrative,
  buildRtpPriorityRationale,
  priorityTierLabel,
} from "@/lib/rtp/priority-scoring";
import { describeRtpPriorityFrameworkBinding } from "@/lib/rtp/priority-framework-binding";
import {
  loadRtpPriorityFrameworkBinding,
  type RtpPriorityFrameworkQuerySupabaseLike,
} from "@/lib/rtp/priority-framework-queries";
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
import { formatMoney } from "@/lib/money/format";

export const metadata = {
  title: "What we're funding and why · Regional Transportation Plan",
  description: "A public, read-only view of an RTP project portfolio: priorities, the reasons behind them, and the policy basis.",
  // The URL carries a credential — the share token IS the authorization. An
  // indexed token-bearing URL hands anyone who searches a link the agency
  // chose to give to specific people. The engagement portal has set this on
  // both its branches since it shipped; this page was missing it.
  robots: { index: false, follow: false },
};

/**
 * THE READING-SURFACE RULE, on the page a resident and a board member read.
 *
 * This page is printed and taken to meetings, so it is typeset: one prose
 * column at 36rem, body at 17px/1.65, which lands lines between 62 and 78
 * characters. Measured in Chrome at 1600×900 on 2026-08-13 it ran 127
 * characters per line at 14.7px — a wall of text with the agency's funding
 * decisions inside it.
 *
 * Four heading steps, none smaller than body. Every caveat on this page keeps
 * its own words; only the column and the type changed around them.
 */
const PAGE_COLUMN = "mx-auto w-full max-w-[36rem] px-5 py-10 sm:py-14";
const PROSE = "text-[1.0625rem] leading-[1.65]";
const SECTION_HEADING = "text-[1.5rem] font-semibold leading-snug tracking-tight text-foreground";
const ITEM_HEADING = "text-[1.25rem] font-semibold leading-snug tracking-tight text-foreground";
const NOTICE_HEADING = "text-[1.0625rem] font-semibold leading-snug";

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

  // A read that failed may not be rendered as an answer — least of all here,
  // where the reader is a member of the public who has no way to tell an empty
  // plan from a broken query. Every read on this page keeps its `error`.
  const reads = new ReadFailureLog();

  const cycleResult = await supabase
    .from("rtp_cycles")
    // `workspace_id` is here so the page can resolve which jurisdiction's law
    // this plan may cite. Without it every reader was shown California
    // statutes, whatever state the agency is in.
    .select("id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, summary")
    .eq("public_share_token", shareToken)
    .eq("public_share_enabled", true)
    .maybeSingle();

  // "This plan does not exist" and "this plan could not be read" are DIFFERENT
  // FACTS, and a 404 states the first one. A token that is wrong, revoked, or
  // whose sharing was switched off is a genuine absence and still 404s. A read
  // that FAILED tells us nothing about whether the plan exists, so it may not
  // borrow that page: answering 404 over a dropped column or a policy change
  // tells a resident an agency's published plan is gone, which is the same
  // defect as telling them the agency funded nothing.
  if (reads.check("this plan", cycleResult)) {
    return (
      <main className={PAGE_COLUMN}>
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Regional Transportation Plan · Public view
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-tight text-foreground">
            This plan could not be loaded
          </h1>
        </header>
        {/*
          The database's own message is deliberately NOT rendered — that is
          operator detail, and this page is public. What a resident needs is
          the fact that the page failed to load, stated so that it cannot be
          mistaken for the plan being withdrawn or never published.
        */}
        <section
          role="status"
          className="mt-6 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <p className={`${PROSE} text-amber-900/90 dark:text-amber-200/90`}>
            Something went wrong reading this plan, so none of it is shown. This is a problem loading
            the page — it does not mean the plan is missing, unpublished, or withdrawn.
          </p>
          <p className={`mt-2 ${PROSE} text-amber-900/90 dark:text-amber-200/90`}>
            Please try again shortly, or contact the agency that published this plan.
          </p>
        </section>
      </main>
    );
  }

  const cycleData = cycleResult.data;
  if (!cycleData) {
    notFound();
  }

  const cycle = cycleData as {
    id: string;
    workspace_id: string;
    title: string;
    status: string;
    geography_label: string | null;
    horizon_start_year: number | null;
    horizon_end_year: number | null;
    summary: string | null;
  };

  // On a service-role page the filters ARE the access control. The map read
  // below carries this same workspace scope; this list read shipped without it
  // (found 2026-08-16), so a link row inserted from another workspace against
  // this cycle's id would have published that workspace's project names and
  // award amounts on a resident-facing page. Same scope on both reads, always.
  const linksResult = await supabase
    .from("project_rtp_cycle_links")
    .select("id, portfolio_role, priority_rationale, priority_scores, evidence_model_run_id, projects(id, name, status, summary)")
    .eq("rtp_cycle_id", cycle.id)
    .eq("workspace_id", cycle.workspace_id);
  const linksFailed = reads.check("the projects in this plan", linksResult);

  // The same per-cycle project map the agency sees, built HERE with the page's
  // own service-role client because the members-only map route would answer a
  // resident 401. Same projection, same lib builder, so the two maps cannot
  // drift about one plan. The workspace filter is scoping the map to the
  // cycle's own workspace, exactly as the route does — a link row whose
  // workspace ever diverged from its cycle's must not be drawn on a public
  // page. Decision #1 (2026-08-03) asked for this map on the public review
  // surface; every property it exposes (name, role, cost) is already published
  // by the lists on this page and the document page.
  const mapLinksResult = await supabase
    .from("project_rtp_cycle_links")
    .select(RTP_CYCLE_PROJECT_MAP_COLUMNS, { count: "exact" })
    .eq("rtp_cycle_id", cycle.id)
    .eq("workspace_id", cycle.workspace_id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(MAP_FEATURE_LAYER_LIMIT);
  const mapFailed = reads.check("the project map", mapLinksResult);
  const mapCollection = mapFailed
    ? null
    : buildRtpCycleProjectFeatureCollection(
        (mapLinksResult.data ?? []) as unknown as RtpCycleProjectLinkRow[],
        mapLinksResult.count ?? null
      );

  const links = (linksResult.data ?? []) as LinkRow[];
  const evidenceRunIds = Array.from(
    new Set(links.map((link) => link.evidence_model_run_id).filter((id): id is string => Boolean(id))),
  );
  const linkedProjectIds = Array.from(
    new Set(links.map((link) => normalizeProject(link.projects)?.id).filter((id): id is string => Boolean(id))),
  );

  // Committed award dollars per project — operator-entered award records only,
  // so a project with none simply shows no funding line. Workspace-scoped like
  // every other read on this page: project ids arrive from the links read, and
  // an id list is not an authorization.
  const awardsResult = linkedProjectIds.length
    ? await supabase
        .from("funding_awards")
        .select("project_id, title, awarded_amount")
        .in("project_id", linkedProjectIds)
        .eq("workspace_id", cycle.workspace_id)
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

  // The law this agency may cite comes from its own home geography. A failed
  // read yields an uncited binding, so the published narrative drops its
  // policy-basis clause instead of asserting another state's statutes to a
  // resident.
  const priorityFramework = await loadRtpPriorityFrameworkBinding(
    supabase as unknown as RtpPriorityFrameworkQuerySupabaseLike,
    cycle.workspace_id
  );
  reads.check("the policy basis for this plan", priorityFramework.result);
  const priorityFrameworkDisclosure = describeRtpPriorityFrameworkBinding(priorityFramework.binding);

  const portfolio = buildPortfolioPriorityNarrative(
    links.map((link) => link.priority_scores ?? {}),
    priorityFramework.binding.criteria
  );

  const rankedProjects = links
    .map((link) => {
      const project = normalizeProject(link.projects);
      const priority = buildRtpPriorityRationale(link.priority_scores ?? {}, priorityFramework.binding.criteria);
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
    <main className={PAGE_COLUMN}>
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Regional Transportation Plan · Public view
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[2.35rem]">
          {cycle.title}
        </h1>
        <p className="mt-2 text-[0.95rem] text-muted-foreground">
          What we&apos;re funding and why
          {cycle.geography_label ? ` · ${cycle.geography_label}` : ""}
          {horizon ? ` · Horizon ${horizon}` : ""}
        </p>
        {cycle.summary ? <p className={`mt-4 ${PROSE} text-foreground/90`}>{cycle.summary}</p> : null}
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
          <h2 className={`${NOTICE_HEADING} text-amber-900 dark:text-amber-200`}>
            Part of this plan could not be loaded
          </h2>
          <p className={`mt-2 ${PROSE} text-amber-900/90 dark:text-amber-200/90`}>{reads.describe()}</p>
          <p className={`mt-2 ${PROSE} text-amber-900/90 dark:text-amber-200/90`}>
            Please check back, or contact the agency that published this plan.
          </p>
        </section>
      ) : null}

      {/*
        This was a tinted box. It is the first thing the page says about the
        whole plan, so it now reads as the opening paragraph it always was —
        the policy basis stays with it, in the same breath as the claim it
        qualifies.
      */}
      {portfolio.scoredCount > 0 ? (
        <section className="mt-10">
          <h2 className={SECTION_HEADING}>Why this plan prioritizes what it does</h2>
          <p className={`mt-3 ${PROSE} text-foreground/90`}>{portfolio.narrative}</p>
          <p className={`mt-3 ${PROSE} text-muted-foreground`}>
            {priorityFrameworkDisclosure.isUncited
              ? priorityFrameworkDisclosure.detail
              : `${priorityFrameworkDisclosure.headline}. ${priorityFrameworkDisclosure.detail}`}
          </p>
        </section>
      ) : null}

      {/*
        The same token opens the full draft document. Linked from here because
        a resident given the "what we're funding" link would otherwise have no
        route to the plan text itself, and the two pages answer different
        questions about the same plan.
      */}
      <p className={`mt-10 ${PROSE}`}>
        <a
          href={`/plan/${shareToken}/document`}
          className="font-semibold text-foreground underline underline-offset-4"
        >
          Read the full draft plan
        </a>
        <span className="text-muted-foreground">
          {" — "}the plan&apos;s chapters, its financial element, and the full project lists.
        </span>
      </p>

      {/*
        Rendered only when its read succeeded: the page's amber banner already
        tells the reader part of the page is missing, and mounting the map
        over a failed read would draw an empty plan — the exact claim a failed
        read may not make. A collection with zero located projects still
        renders, because "no project has a location recorded yet" is a true
        statement the component makes honestly.
      */}
      {mapCollection ? (
        <section className="mt-8">
          <RtpCycleProjectMap audience="public" collection={mapCollection} />
        </section>
      ) : null}

      <section className="mt-14">
        <h2 className={SECTION_HEADING}>Projects, ranked by priority</h2>
        {rankedProjects.length === 0 ? (
          linksFailed ? (
            // "No projects have been published" is a claim about the plan. A
            // failed read cannot make it — and on a public page that sentence
            // would tell a resident the agency has funded nothing.
            <p className={`mt-3 ${PROSE} text-muted-foreground`}>
              The project list could not be loaded, so it is not shown. This does not mean the plan
              has no projects.
            </p>
          ) : (
            <p className={`mt-3 ${PROSE} text-muted-foreground`}>No projects have been published for this plan yet.</p>
          )
        ) : (
          // ONE PROJECT PER ENTRY, NOT ONE CARD PER PROJECT. Each project was a
          // bordered card holding a bordered warning; a plan read as a stack of
          // forms. The rule between entries does the same separating work, and
          // the modeling caveats keep their own words — a run's engine, status
          // and claim tier still travel with every cited figure, and a warning
          // about a cited run is still marked as a warning.
          <ol className="mt-6 border-t border-border/70">
            {rankedProjects.map((entry) => (
              <li key={entry.id} className="border-b border-border/70 pb-6 pt-7">
                <h3 className={ITEM_HEADING}>{entry.project?.name ?? "Project"}</h3>
                <p className="mt-2 text-[0.95rem] text-muted-foreground">
                  {formatRtpPortfolioRoleLabel(entry.portfolioRole)}
                  {entry.priority.summary.scoredCriteria > 0
                    ? ` · ${priorityTierLabel(entry.priority.summary.tier)}`
                    : ""}
                </p>
                <p className={`mt-3 ${PROSE} text-foreground/90`}>
                  {entry.priority.summary.scoredCriteria > 0
                    ? entry.priority.narrative
                    : entry.priorityRationale?.trim() || entry.project?.summary?.trim() || "Prioritization rationale to be published."}
                </p>
                {entry.evidence ? (
                  <div className="mt-3 text-[0.95rem] leading-[1.6] text-muted-foreground">
                    <p>
                      <span className="font-semibold text-foreground">Modeling evidence</span>
                      {entry.evidence.runTitle ? ` (${entry.evidence.runTitle})` : ""}: {formatRtpModelingEvidenceLine(entry.evidence)}
                    </p>
                    {entry.disclosure ? (
                      <p className="mt-1">
                        <span className="font-semibold text-foreground">Cited run</span>: {formatRtpEvidenceRunDisclosureLine(entry.disclosure)}
                      </p>
                    ) : null}
                    {entry.disclosure
                      ? rtpEvidenceRunWarnings(entry.disclosure).map((warning) => (
                          <p
                            key={warning}
                            className="mt-2 border-l-2 border-amber-400/70 pl-3 text-amber-800 dark:text-amber-200"
                          >
                            {warning}
                          </p>
                        ))
                      : null}
                  </div>
                ) : null}
                {entry.awards.length > 0 ? (
                  <p className="mt-3 text-[0.95rem] leading-[1.6] text-muted-foreground">
                    <span className="font-semibold text-foreground">Committed funding</span>:{" "}
                    {formatMoney(entry.awards.reduce((sum, award) => sum + award.amount, 0), { precision: "whole" })} across{" "}
                    {entry.awards.length === 1 ? "1 award" : `${entry.awards.length} awards`} ·{" "}
                    {entry.awards.map((award) => award.title).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="mt-14 border-t border-border pt-5 text-[0.95rem] leading-[1.6] text-muted-foreground">
        <p>
          This is a read-only public view published by the agency. Modeling figures are screening-grade and cited to a
          specific model run; committed funding reflects the awards the agency has entered, and the full documentation
          is in the adopted plan document. Priorities reflect local, county, state, and federal goals (VMT/GHG
          reduction, safety, equity, and multimodal access).
        </p>
      </footer>
    </main>
  );
}
