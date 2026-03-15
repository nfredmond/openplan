import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  FileStack,
  FolderKanban,
  GitBranch,
  MessagesSquare,
  Radar,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { PlanDetailControls } from "@/components/plans/plan-detail-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { titleizeEngagementValue, engagementStatusTone } from "@/lib/engagement/catalog";
import { createClient } from "@/lib/supabase/server";
import {
  buildPlanArtifactCoverage,
  buildPlanReadiness,
  buildPlanWorkflowSummary,
  formatPlanDateTime,
  formatPlanLinkTypeLabel,
  formatPlanStatusLabel,
  formatPlanTypeLabel,
  planStatusTone,
} from "@/lib/plans/catalog";
import { formatReportStatusLabel, formatReportTypeLabel, reportStatusTone } from "@/lib/reports/catalog";
import { scenarioStatusTone, titleizeScenarioValue } from "@/lib/scenarios/catalog";

type LinkedArtifactBase = {
  id: string;
  title: string | null;
  status: string | null;
  project_id: string | null;
  updated_at: string | null;
};

type ScenarioArtifactBase = LinkedArtifactBase & {
  summary: string | null;
  planning_question: string | null;
  baseline_entry_id: string | null;
  entryCount: number;
  readyEntryCount: number;
  attachedRunCount: number;
};

type CampaignArtifactBase = LinkedArtifactBase & {
  summary: string | null;
  engagement_type: string | null;
  categoryCount: number;
  itemCount: number;
  approvedItemCount: number;
  pendingItemCount: number;
  flaggedItemCount: number;
};

type ReportArtifactBase = LinkedArtifactBase & {
  summary: string | null;
  report_type: string | null;
  generated_at: string | null;
  latest_artifact_kind: string | null;
  linkedRunCount: number;
  enabledSectionCount: number;
  artifactCount: number;
};

type LinkedProjectBase = LinkedArtifactBase & {
  summary?: string | null;
  plan_type?: string | null;
  delivery_phase?: string | null;
};

function mergeArtifacts<T extends { id: string }>(
  projectItems: T[],
  explicitItems: T[]
): Array<T & { linkBasis: "project" | "plan_link" | "both" }> {
  const merged = new Map<string, T & { linkBasis: "project" | "plan_link" | "both" }>();

  for (const item of projectItems) {
    merged.set(item.id, { ...item, linkBasis: "project" });
  }

  for (const item of explicitItems) {
    const current = merged.get(item.id);
    if (current) {
      merged.set(item.id, { ...current, ...item, linkBasis: "both" });
      continue;
    }
    merged.set(item.id, { ...item, linkBasis: "plan_link" });
  }

  return [...merged.values()];
}

function linkBasisLabel(value: "project" | "plan_link" | "both"): string {
  if (value === "both") return "Project + plan link";
  if (value === "project") return "From primary project";
  return "Explicit plan link";
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: plan } = await supabase
    .from("plans")
    .select(
      "id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at"
    )
    .eq("id", planId)
    .maybeSingle();

  if (!plan) {
    notFound();
  }

  const [projectsResult, projectResult, planLinksResult, projectScenariosResult, projectCampaignsResult, projectReportsResult] =
    await Promise.all([
      supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
      plan.project_id
        ? supabase
            .from("projects")
            .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
            .eq("id", plan.project_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("plan_links")
        .select("id, plan_id, link_type, linked_id, label, created_at, updated_at")
        .eq("plan_id", plan.id),
      plan.project_id
        ? supabase
            .from("scenario_sets")
            .select("id, project_id, title, summary, planning_question, status, baseline_entry_id, updated_at")
            .eq("project_id", plan.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      plan.project_id
        ? supabase
            .from("engagement_campaigns")
            .select("id, project_id, title, summary, status, engagement_type, updated_at")
            .eq("project_id", plan.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      plan.project_id
        ? supabase
            .from("reports")
            .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
            .eq("project_id", plan.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

  const planLinks = planLinksResult.data ?? [];
  const scenarioLinkIds = planLinks.filter((link) => link.link_type === "scenario_set").map((link) => link.linked_id);
  const campaignLinkIds = planLinks.filter((link) => link.link_type === "engagement_campaign").map((link) => link.linked_id);
  const reportLinkIds = planLinks.filter((link) => link.link_type === "report").map((link) => link.linked_id);
  const projectLinkIds = planLinks.filter((link) => link.link_type === "project_record").map((link) => link.linked_id);

  const [explicitScenariosResult, explicitCampaignsResult, explicitReportsResult, explicitProjectsResult] = await Promise.all([
    scenarioLinkIds.length
      ? supabase
          .from("scenario_sets")
          .select("id, project_id, title, summary, planning_question, status, baseline_entry_id, updated_at")
          .in("id", scenarioLinkIds)
      : Promise.resolve({ data: [], error: null }),
    campaignLinkIds.length
      ? supabase
          .from("engagement_campaigns")
          .select("id, project_id, title, summary, status, engagement_type, updated_at")
          .in("id", campaignLinkIds)
      : Promise.resolve({ data: [], error: null }),
    reportLinkIds.length
      ? supabase
          .from("reports")
          .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
          .in("id", reportLinkIds)
      : Promise.resolve({ data: [], error: null }),
    projectLinkIds.length
      ? supabase
          .from("projects")
          .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
          .in("id", projectLinkIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const scenarioIds = Array.from(
    new Set([
      ...(projectScenariosResult.data ?? []).map((item) => item.id),
      ...(explicitScenariosResult.data ?? []).map((item) => item.id),
    ])
  );
  const campaignIds = Array.from(
    new Set([
      ...(projectCampaignsResult.data ?? []).map((item) => item.id),
      ...(explicitCampaignsResult.data ?? []).map((item) => item.id),
    ])
  );
  const reportIds = Array.from(
    new Set([
      ...(projectReportsResult.data ?? []).map((item) => item.id),
      ...(explicitReportsResult.data ?? []).map((item) => item.id),
    ])
  );

  const [
    scenarioEntriesResult,
    engagementCategoriesResult,
    engagementItemsResult,
    reportRunsResult,
    reportSectionsResult,
    reportArtifactsResult,
  ] = await Promise.all([
    scenarioIds.length
      ? supabase.from("scenario_entries").select("scenario_set_id, status, attached_run_id").in("scenario_set_id", scenarioIds)
      : Promise.resolve({ data: [], error: null }),
    campaignIds.length
      ? supabase.from("engagement_categories").select("campaign_id").in("campaign_id", campaignIds)
      : Promise.resolve({ data: [], error: null }),
    campaignIds.length
      ? supabase.from("engagement_items").select("campaign_id, status").in("campaign_id", campaignIds)
      : Promise.resolve({ data: [], error: null }),
    reportIds.length
      ? supabase.from("report_runs").select("report_id").in("report_id", reportIds)
      : Promise.resolve({ data: [], error: null }),
    reportIds.length
      ? supabase.from("report_sections").select("report_id, enabled").in("report_id", reportIds)
      : Promise.resolve({ data: [], error: null }),
    reportIds.length
      ? supabase.from("report_artifacts").select("report_id").in("report_id", reportIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const scenarioStatsById = new Map<string, { entryCount: number; readyEntryCount: number; attachedRunCount: number }>();
  for (const row of scenarioEntriesResult.data ?? []) {
    const current = scenarioStatsById.get(row.scenario_set_id) ?? {
      entryCount: 0,
      readyEntryCount: 0,
      attachedRunCount: 0,
    };
    current.entryCount += 1;
    if (row.status === "ready") current.readyEntryCount += 1;
    if (row.attached_run_id) current.attachedRunCount += 1;
    scenarioStatsById.set(row.scenario_set_id, current);
  }

  const campaignCategoryCounts = new Map<string, number>();
  for (const row of engagementCategoriesResult.data ?? []) {
    campaignCategoryCounts.set(row.campaign_id, (campaignCategoryCounts.get(row.campaign_id) ?? 0) + 1);
  }

  const campaignItemStats = new Map<
    string,
    { itemCount: number; approvedItemCount: number; pendingItemCount: number; flaggedItemCount: number }
  >();
  for (const row of engagementItemsResult.data ?? []) {
    const current = campaignItemStats.get(row.campaign_id) ?? {
      itemCount: 0,
      approvedItemCount: 0,
      pendingItemCount: 0,
      flaggedItemCount: 0,
    };
    current.itemCount += 1;
    if (row.status === "approved") current.approvedItemCount += 1;
    if (row.status === "pending") current.pendingItemCount += 1;
    if (row.status === "flagged") current.flaggedItemCount += 1;
    campaignItemStats.set(row.campaign_id, current);
  }

  const reportRunCounts = new Map<string, number>();
  for (const row of reportRunsResult.data ?? []) {
    reportRunCounts.set(row.report_id, (reportRunCounts.get(row.report_id) ?? 0) + 1);
  }

  const reportEnabledSectionCounts = new Map<string, number>();
  for (const row of reportSectionsResult.data ?? []) {
    if (!row.enabled) continue;
    reportEnabledSectionCounts.set(row.report_id, (reportEnabledSectionCounts.get(row.report_id) ?? 0) + 1);
  }

  const reportArtifactCounts = new Map<string, number>();
  for (const row of reportArtifactsResult.data ?? []) {
    reportArtifactCounts.set(row.report_id, (reportArtifactCounts.get(row.report_id) ?? 0) + 1);
  }

  const linkedScenarios = mergeArtifacts<ScenarioArtifactBase>(
    (projectScenariosResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      planning_question: item.planning_question,
      status: item.status,
      baseline_entry_id: item.baseline_entry_id,
      project_id: item.project_id,
      updated_at: item.updated_at,
      entryCount: scenarioStatsById.get(item.id)?.entryCount ?? 0,
      readyEntryCount: scenarioStatsById.get(item.id)?.readyEntryCount ?? 0,
      attachedRunCount: scenarioStatsById.get(item.id)?.attachedRunCount ?? 0,
    })),
    (explicitScenariosResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      planning_question: item.planning_question,
      status: item.status,
      baseline_entry_id: item.baseline_entry_id,
      project_id: item.project_id,
      updated_at: item.updated_at,
      entryCount: scenarioStatsById.get(item.id)?.entryCount ?? 0,
      readyEntryCount: scenarioStatsById.get(item.id)?.readyEntryCount ?? 0,
      attachedRunCount: scenarioStatsById.get(item.id)?.attachedRunCount ?? 0,
    }))
  );

  const linkedCampaigns = mergeArtifacts<CampaignArtifactBase>(
    (projectCampaignsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      status: item.status,
      engagement_type: item.engagement_type,
      project_id: item.project_id,
      updated_at: item.updated_at,
      categoryCount: campaignCategoryCounts.get(item.id) ?? 0,
      itemCount: campaignItemStats.get(item.id)?.itemCount ?? 0,
      approvedItemCount: campaignItemStats.get(item.id)?.approvedItemCount ?? 0,
      pendingItemCount: campaignItemStats.get(item.id)?.pendingItemCount ?? 0,
      flaggedItemCount: campaignItemStats.get(item.id)?.flaggedItemCount ?? 0,
    })),
    (explicitCampaignsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      status: item.status,
      engagement_type: item.engagement_type,
      project_id: item.project_id,
      updated_at: item.updated_at,
      categoryCount: campaignCategoryCounts.get(item.id) ?? 0,
      itemCount: campaignItemStats.get(item.id)?.itemCount ?? 0,
      approvedItemCount: campaignItemStats.get(item.id)?.approvedItemCount ?? 0,
      pendingItemCount: campaignItemStats.get(item.id)?.pendingItemCount ?? 0,
      flaggedItemCount: campaignItemStats.get(item.id)?.flaggedItemCount ?? 0,
    }))
  );

  const linkedReports = mergeArtifacts<ReportArtifactBase>(
    (projectReportsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      status: item.status,
      report_type: item.report_type,
      generated_at: item.generated_at,
      latest_artifact_kind: item.latest_artifact_kind,
      project_id: item.project_id,
      updated_at: item.updated_at,
      linkedRunCount: reportRunCounts.get(item.id) ?? 0,
      enabledSectionCount: reportEnabledSectionCounts.get(item.id) ?? 0,
      artifactCount: reportArtifactCounts.get(item.id) ?? 0,
    })),
    (explicitReportsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      status: item.status,
      report_type: item.report_type,
      generated_at: item.generated_at,
      latest_artifact_kind: item.latest_artifact_kind,
      project_id: item.project_id,
      updated_at: item.updated_at,
      linkedRunCount: reportRunCounts.get(item.id) ?? 0,
      enabledSectionCount: reportEnabledSectionCounts.get(item.id) ?? 0,
      artifactCount: reportArtifactCounts.get(item.id) ?? 0,
    }))
  );

  const linkedProjects = mergeArtifacts<LinkedProjectBase>(
    projectResult.data
      ? [
          {
            id: projectResult.data.id,
            title: projectResult.data.name,
            status: projectResult.data.status,
            project_id: projectResult.data.id,
            updated_at: projectResult.data.updated_at,
            summary: projectResult.data.summary,
            plan_type: projectResult.data.plan_type,
            delivery_phase: projectResult.data.delivery_phase,
          },
        ]
      : [],
    (explicitProjectsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.name,
      status: item.status,
      project_id: item.id,
      updated_at: item.updated_at,
      summary: item.summary,
      plan_type: item.plan_type,
      delivery_phase: item.delivery_phase,
    }))
  );

  const readiness = buildPlanReadiness({
    hasProject: linkedProjects.length > 0,
    scenarioCount: linkedScenarios.length,
    engagementCampaignCount: linkedCampaigns.length,
    reportCount: linkedReports.length,
    geographyLabel: plan.geography_label,
    horizonYear: plan.horizon_year,
  });
  const artifactCoverage = buildPlanArtifactCoverage({
    scenarioCount: linkedScenarios.length,
    engagementCampaignCount: linkedCampaigns.length,
    reportCount: linkedReports.length,
  });
  const explicitScenarioCount = planLinks.filter((link) => link.link_type === "scenario_set").length;
  const explicitCampaignCount = planLinks.filter((link) => link.link_type === "engagement_campaign").length;
  const explicitReportCount = planLinks.filter((link) => link.link_type === "report").length;
  const explicitProjectCount = planLinks.filter((link) => link.link_type === "project_record").length;
  const inheritedScenarioCount = linkedScenarios.filter((item) => item.linkBasis === "project").length;
  const inheritedCampaignCount = linkedCampaigns.filter((item) => item.linkBasis === "project").length;
  const inheritedReportCount = linkedReports.filter((item) => item.linkBasis === "project").length;
  const inheritedProjectCount = linkedProjects.filter((item) => item.linkBasis === "project").length;
  const readyScenarioCount = linkedScenarios.filter((item) => item.readyEntryCount > 0).length;
  const pendingEngagementItemCount = linkedCampaigns.reduce((sum, item) => sum + item.pendingItemCount, 0);
  const flaggedEngagementItemCount = linkedCampaigns.reduce((sum, item) => sum + item.flaggedItemCount, 0);
  const generatedReportCount = linkedReports.filter((item) => Boolean(item.generated_at)).length;
  const reportArtifactCount = linkedReports.reduce((sum, item) => sum + item.artifactCount, 0);
  const workflow = buildPlanWorkflowSummary({
    planStatus: plan.status,
    readiness,
    linkedProjectCount: linkedProjects.length,
    explicitLinkCount: planLinks.length,
    relatedProjectCount: linkedProjects.length,
    scenarioCount: linkedScenarios.length,
    readyScenarioCount,
    engagementCampaignCount: linkedCampaigns.length,
    pendingEngagementItemCount,
    flaggedEngagementItemCount,
    reportCount: linkedReports.length,
    generatedReportCount,
    reportArtifactCount,
  });

  return (
    <section className="module-page space-y-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href="/plans" className="inline-flex items-center gap-2 transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to plans
        </Link>
      </div>

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <FileStack className="h-3.5 w-3.5" />
            Plan detail
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{plan.title}</h1>
            <p className="module-intro-description">
              {plan.summary ||
                "This plan record is intentionally lightweight in pass 1: structured metadata, clear linked inputs and outputs, and an explicit readiness basis."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={planStatusTone(plan.status)}>{formatPlanStatusLabel(plan.status)}</StatusBadge>
            <StatusBadge tone="info">{formatPlanTypeLabel(plan.plan_type)}</StatusBadge>
            <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
            <StatusBadge tone={artifactCoverage.tone}>{artifactCoverage.label}</StatusBadge>
            <StatusBadge tone={workflow.tone}>{workflow.label}</StatusBadge>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Linked scenarios</p>
              <p className="module-summary-value">{linkedScenarios.length}</p>
              <p className="module-summary-detail">Inherited from the project or explicitly linked to the plan.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Engagement campaigns</p>
              <p className="module-summary-value">{linkedCampaigns.length}</p>
              <p className="module-summary-detail">Source campaigns feeding the planning record.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked outputs</p>
              <p className="module-summary-value">{generatedReportCount}</p>
              <p className="module-summary-detail">
                {generatedReportCount > 0
                  ? `${reportArtifactCount} stored artifact${reportArtifactCount === 1 ? "" : "s"} visible across linked reports.`
                  : workflow.planningOutputDetail}
              </p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Readiness basis</p>
              <h2 className="module-operator-title">{readiness.reason}</h2>
            </div>
          </div>
          <p className="module-operator-copy">{workflow.reason}</p>
          <div className="module-operator-list">
            {readiness.checks.map((check) => (
              <div key={check.key} className="module-operator-item">
                <strong>{check.label}:</strong> {check.detail}
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-[22px] border border-border/70 bg-background/30 p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Planning output cue
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge tone={workflow.planningOutputTone}>{workflow.planningOutputLabel}</StatusBadge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{workflow.planningOutputDetail}</p>
          </div>
          {workflow.actionItems.length > 0 ? (
            <div className="mt-5 rounded-[22px] border border-border/70 bg-background/30 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Next actions
              </p>
              <div className="mt-3 space-y-2 text-sm">
                {workflow.actionItems.map((step) => (
                  <p key={step}>{step}</p>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <PlanDetailControls
          plan={plan}
          projects={(projectsResult.data ?? []).map((project) => ({ id: project.id, name: project.name }))}
        />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Workflow</p>
              <h2 className="module-section-title">Operator review posture</h2>
              <p className="module-section-description">
                Keep this page focused on the formal planning record: what is linked, what is ready, and what still needs operator action.
              </p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <GitBranch className="h-5 w-5" />
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={workflow.tone}>{workflow.label}</StatusBadge>
                <StatusBadge tone={workflow.planningOutputTone}>{workflow.planningOutputLabel}</StatusBadge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{workflow.reason}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Readiness checklist</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">
                  {readiness.readyCheckCount}/{readiness.totalCheckCount}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {readiness.missingCheckCount === 0
                    ? "All explicit basis checks are visible."
                    : `${readiness.missingCheckCount} checklist gap${readiness.missingCheckCount === 1 ? "" : "s"} remain.`}
                </p>
              </div>

              <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Linkage ledger</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{planLinks.length}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {planLinks.length === 0
                    ? "No explicit links stored on the plan yet."
                    : `${explicitProjectCount} project, ${explicitScenarioCount} scenario, ${explicitCampaignCount} campaign, ${explicitReportCount} report links are recorded.`}
                </p>
              </div>
            </div>

            {workflow.reviewNotes.length > 0 ? (
              <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Review notes</p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {workflow.reviewNotes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Metadata</p>
              <h2 className="module-section-title">Plan scope and operating context</h2>
              <p className="module-section-description">What this plan is, where it applies, and how it is currently classified.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Geography</p>
              <p className="mt-2 text-sm">{plan.geography_label ?? "Not set"}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Horizon year</p>
              <p className="mt-2 text-sm">{plan.horizon_year ?? "Not set"}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Created</p>
              <p className="mt-2 text-sm">{formatPlanDateTime(plan.created_at)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Updated</p>
              <p className="mt-2 text-sm">{formatPlanDateTime(plan.updated_at)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4 md:col-span-2">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Record posture</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Formal planning record only. Use linked scenarios, engagement, and reports to review basis and outputs; do not treat this surface as chapter authoring.
              </p>
            </div>
          </div>
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Projects</p>
              <h2 className="module-section-title">Primary and related project records</h2>
              <p className="module-section-description">Plans can inherit planning context from a primary project and carry extra project cross-links.</p>
            </div>
          </div>

          {linkedProjects.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No linked projects" description="Attach a primary project or related project record to anchor this plan." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block rounded-[22px] border border-border/80 bg-background/80 p-5 transition hover:border-primary/35"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold tracking-tight">{project.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {project.summary || "No project summary captured yet."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={project.linkBasis === "project" ? "success" : "neutral"}>
                        {project.linkBasis === "project" ? "Primary project" : linkBasisLabel(project.linkBasis)}
                      </StatusBadge>
                      {project.status ? <StatusBadge tone="info">{project.status}</StatusBadge> : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Scenarios</p>
              <h2 className="module-section-title">Scenario evidence</h2>
            </div>
            <Radar className="h-5 w-5 text-muted-foreground" />
          </div>

          {linkedScenarios.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No scenario sets linked" description="Link scenarios directly or through the primary project." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedScenarios.map((scenario) => (
                <Link key={scenario.id} href={`/scenarios/${scenario.id}`} className="block rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">{linkBasisLabel(scenario.linkBasis)}</StatusBadge>
                    {scenario.status ? (
                      <StatusBadge tone={scenarioStatusTone(scenario.status)}>{titleizeScenarioValue(scenario.status)}</StatusBadge>
                    ) : null}
                    <StatusBadge tone={scenario.baseline_entry_id ? "success" : "warning"}>
                      {scenario.baseline_entry_id ? "Baseline set" : "Baseline missing"}
                    </StatusBadge>
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{scenario.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {scenario.summary || scenario.planning_question || "No scenario summary captured yet."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{pluralize(scenario.entryCount, "entry")}</span>
                    <span>{pluralize(scenario.readyEntryCount, "ready alternative", "ready alternatives")}</span>
                    <span>{pluralize(scenario.attachedRunCount, "attached run")}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {scenario.linkBasis === "project"
                      ? "Inherited from the primary project."
                      : scenario.linkBasis === "both"
                        ? "Visible through both the primary project and an explicit plan link."
                        : "Stored as an explicit plan link on this record."}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">Updated {formatPlanDateTime(scenario.updated_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Engagement</p>
              <h2 className="module-section-title">Input campaigns</h2>
            </div>
            <MessagesSquare className="h-5 w-5 text-muted-foreground" />
          </div>

          {linkedCampaigns.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No campaigns linked" description="Link engagement campaigns to expose intake basis for this plan." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedCampaigns.map((campaign) => (
                <Link key={campaign.id} href={`/engagement/${campaign.id}`} className="block rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">{linkBasisLabel(campaign.linkBasis)}</StatusBadge>
                    {campaign.status ? (
                      <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                    ) : null}
                    {campaign.engagement_type ? <StatusBadge tone="info">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge> : null}
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{campaign.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{campaign.summary || "No campaign summary captured yet."}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{pluralize(campaign.categoryCount, "category")}</span>
                    <span>{pluralize(campaign.itemCount, "item")}</span>
                    <span>{campaign.approvedItemCount} approved</span>
                    <span>{campaign.pendingItemCount} pending</span>
                    <span>{campaign.flaggedItemCount} flagged</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {campaign.linkBasis === "project"
                      ? "Inherited from the primary project."
                      : campaign.linkBasis === "both"
                        ? "Visible through both the primary project and an explicit plan link."
                        : "Stored as an explicit plan link on this record."}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">Updated {formatPlanDateTime(campaign.updated_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Reports</p>
              <h2 className="module-section-title">Output packets</h2>
            </div>
            <ScrollText className="h-5 w-5 text-muted-foreground" />
          </div>

          {linkedReports.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No reports linked" description="Link reports directly or via the primary project to show what outputs already exist." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedReports.map((report) => (
                <Link key={report.id} href={`/reports/${report.id}`} className="block rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">{linkBasisLabel(report.linkBasis)}</StatusBadge>
                    {report.status ? <StatusBadge tone={reportStatusTone(report.status)}>{formatReportStatusLabel(report.status)}</StatusBadge> : null}
                    {report.report_type ? <StatusBadge tone="info">{formatReportTypeLabel(report.report_type)}</StatusBadge> : null}
                    {report.latest_artifact_kind ? <StatusBadge tone="neutral">{report.latest_artifact_kind.toUpperCase()}</StatusBadge> : null}
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{report.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{report.summary || "No report summary captured yet."}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{pluralize(report.linkedRunCount, "linked run")}</span>
                    <span>{pluralize(report.enabledSectionCount, "enabled section")}</span>
                    <span>{pluralize(report.artifactCount, "artifact")}</span>
                    <span>
                      {report.generated_at ? `Generated ${formatPlanDateTime(report.generated_at)}` : "Not generated yet"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {report.linkBasis === "project"
                      ? "Inherited from the primary project."
                      : report.linkBasis === "both"
                        ? "Visible through both the primary project and an explicit plan link."
                        : "Stored as an explicit plan link on this record."}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">Updated {formatPlanDateTime(report.updated_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Plan links</p>
            <h2 className="module-section-title">Explicit plan-to-record references</h2>
            <p className="module-section-description">These are the direct links stored on the plan record itself, separate from anything inherited through the primary project.</p>
          </div>
          <FolderKanban className="h-5 w-5 text-muted-foreground" />
        </div>

        {planLinks.length === 0 ? (
          <div className="mt-5">
            <EmptyState title="No explicit links yet" description="Pass 1 already shows project-derived context; explicit plan links can be added through the API." compact />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Projects</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{explicitProjectCount}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {inheritedProjectCount > 0 ? `${inheritedProjectCount} more inherited from the primary project.` : "No inherited project context."}
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Scenarios</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{explicitScenarioCount}</p>
                <p className="mt-2 text-sm text-muted-foreground">{inheritedScenarioCount} inherited from project linkage.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Campaigns</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{explicitCampaignCount}</p>
                <p className="mt-2 text-sm text-muted-foreground">{inheritedCampaignCount} inherited from project linkage.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Reports</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{explicitReportCount}</p>
                <p className="mt-2 text-sm text-muted-foreground">{inheritedReportCount} inherited from project linkage.</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {planLinks.map((link) => (
              <div key={link.id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {formatPlanLinkTypeLabel(link.link_type)}
                </p>
                <p className="mt-2 text-sm font-medium">{link.label || link.linked_id}</p>
                <p className="mt-2 text-xs text-muted-foreground">Updated {formatPlanDateTime(link.updated_at)}</p>
              </div>
            ))}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
