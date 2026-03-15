import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  Database,
  FileStack,
  FolderKanban,
  MessagesSquare,
  ShieldCheck,
} from "lucide-react";
import { ProgramDetailControls } from "@/components/programs/program-detail-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import {
  buildProgramReadiness,
  buildProgramWorkflowSummary,
  formatFiscalWindow,
  formatProgramDateTime,
  formatProgramStatusLabel,
  formatProgramTypeLabel,
  programStatusTone,
  titleizeProgramValue,
} from "@/lib/programs/catalog";
import {
  buildModelWorkspaceSummary,
  formatModelFamilyLabel,
  formatModelStatusLabel,
  modelStatusTone,
} from "@/lib/models/catalog";
import { formatPlanStatusLabel, formatPlanTypeLabel, planStatusTone } from "@/lib/plans/catalog";
import { titleizeEngagementValue, engagementStatusTone } from "@/lib/engagement/catalog";
import { formatReportStatusLabel, formatReportTypeLabel, reportStatusTone } from "@/lib/reports/catalog";

function mergeRecords<T extends { id: string }>(
  projectItems: T[],
  explicitItems: T[]
): Array<T & { linkBasis: "project" | "program_link" | "both" }> {
  const merged = new Map<string, T & { linkBasis: "project" | "program_link" | "both" }>();

  for (const item of projectItems) {
    merged.set(item.id, { ...item, linkBasis: "project" });
  }

  for (const item of explicitItems) {
    const current = merged.get(item.id);
    if (current) {
      merged.set(item.id, { ...current, ...item, linkBasis: "both" });
      continue;
    }
    merged.set(item.id, { ...item, linkBasis: "program_link" });
  }

  return [...merged.values()];
}

function linkBasisLabel(value: "project" | "program_link" | "both"): string {
  if (value === "both") return "Project + program link";
  if (value === "project") return "From primary project";
  return "Explicit program link";
}

type SupportingProgramModelBase = {
  id: string;
  project_id: string | null;
  scenario_set_id: string | null;
  title: string | null;
  model_family: string | null;
  status: string | null;
  config_version: string | null;
  owner_label: string | null;
  summary: string | null;
  last_validated_at: string | null;
  last_run_recorded_at: string | null;
  updated_at: string | null;
};

function mergeSupportingProgramModels<T extends { id: string }>(
  projectItems: T[],
  planItems: T[]
): Array<T & { supportBasis: "project" | "plan" | "both" }> {
  const merged = new Map<string, T & { supportBasis: "project" | "plan" | "both" }>();

  for (const item of projectItems) {
    merged.set(item.id, { ...item, supportBasis: "project" });
  }

  for (const item of planItems) {
    const current = merged.get(item.id);
    if (current) {
      merged.set(item.id, { ...current, ...item, supportBasis: "both" });
      continue;
    }
    merged.set(item.id, { ...item, supportBasis: "plan" });
  }

  return [...merged.values()];
}

function modelSupportBasisLabel(value: "project" | "plan" | "both"): string {
  if (value === "both") return "Project + linked plan";
  if (value === "project") return "From project context";
  return "From linked plan";
}

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: program } = await supabase
    .from("programs")
    .select(
      "id, workspace_id, project_id, title, program_type, status, cycle_name, sponsor_agency, fiscal_year_start, fiscal_year_end, nomination_due_at, adoption_target_at, summary, created_at, updated_at"
    )
    .eq("id", programId)
    .maybeSingle();

  if (!program) {
    notFound();
  }

  const [projectsResult, primaryProjectResult, linksResult, projectPlansResult, projectReportsResult, projectCampaignsResult] =
    await Promise.all([
      supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
      program.project_id
        ? supabase
            .from("projects")
            .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
            .eq("id", program.project_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("program_links").select("id, program_id, link_type, linked_id, label").eq("program_id", program.id),
      program.project_id
        ? supabase
            .from("plans")
            .select("id, project_id, title, plan_type, status, summary, geography_label, horizon_year, updated_at")
            .eq("project_id", program.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      program.project_id
        ? supabase
            .from("reports")
            .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
            .eq("project_id", program.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      program.project_id
        ? supabase
            .from("engagement_campaigns")
            .select("id, project_id, title, summary, status, engagement_type, updated_at")
            .eq("project_id", program.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

  const links = linksResult.data ?? [];
  const planLinkIds = links.filter((link) => link.link_type === "plan").map((link) => link.linked_id);
  const reportLinkIds = links.filter((link) => link.link_type === "report").map((link) => link.linked_id);
  const campaignLinkIds = links.filter((link) => link.link_type === "engagement_campaign").map((link) => link.linked_id);
  const projectLinkIds = links.filter((link) => link.link_type === "project_record").map((link) => link.linked_id);

  const [allPlansResult, allReportsResult, allCampaignsResult, explicitPlansResult, explicitReportsResult, explicitCampaignsResult, explicitProjectsResult] =
    await Promise.all([
      supabase.from("plans").select("id, title").eq("workspace_id", program.workspace_id).order("updated_at", { ascending: false }),
      supabase.from("reports").select("id, title").eq("workspace_id", program.workspace_id).order("updated_at", { ascending: false }),
      supabase
        .from("engagement_campaigns")
        .select("id, title")
        .eq("workspace_id", program.workspace_id)
        .order("updated_at", { ascending: false }),
      planLinkIds.length
        ? supabase
            .from("plans")
            .select("id, project_id, title, plan_type, status, summary, geography_label, horizon_year, updated_at")
            .in("id", planLinkIds)
        : Promise.resolve({ data: [], error: null }),
      reportLinkIds.length
        ? supabase
            .from("reports")
            .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
            .in("id", reportLinkIds)
        : Promise.resolve({ data: [], error: null }),
      campaignLinkIds.length
        ? supabase
            .from("engagement_campaigns")
            .select("id, project_id, title, summary, status, engagement_type, updated_at")
            .in("id", campaignLinkIds)
        : Promise.resolve({ data: [], error: null }),
      projectLinkIds.length
        ? supabase
            .from("projects")
            .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
            .in("id", projectLinkIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const campaignIds = Array.from(
    new Set([
      ...((projectCampaignsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
      ...((explicitCampaignsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
    ])
  );
  const reportIds = Array.from(
    new Set([
      ...((projectReportsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
      ...((explicitReportsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
    ])
  );

  const [engagementItemsResult, reportArtifactsResult] = await Promise.all([
    campaignIds.length
      ? supabase.from("engagement_items").select("campaign_id, status").in("campaign_id", campaignIds)
      : Promise.resolve({ data: [], error: null }),
    reportIds.length
      ? supabase.from("report_artifacts").select("report_id").in("report_id", reportIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const engagementStatsByCampaign = new Map<string, { approved: number; pending: number }>();
  for (const row of engagementItemsResult.data ?? []) {
    const current = engagementStatsByCampaign.get(row.campaign_id) ?? { approved: 0, pending: 0 };
    if (row.status === "approved") current.approved += 1;
    if (row.status === "pending") current.pending += 1;
    engagementStatsByCampaign.set(row.campaign_id, current);
  }

  const artifactCountsByReport = new Map<string, number>();
  for (const row of reportArtifactsResult.data ?? []) {
    artifactCountsByReport.set(row.report_id, (artifactCountsByReport.get(row.report_id) ?? 0) + 1);
  }

  const linkedPlans = mergeRecords(
    (projectPlansResult.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      title: string | null;
      plan_type: string | null;
      status: string | null;
      summary: string | null;
      geography_label: string | null;
      horizon_year: number | null;
      updated_at: string | null;
    }>,
    (explicitPlansResult.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      title: string | null;
      plan_type: string | null;
      status: string | null;
      summary: string | null;
      geography_label: string | null;
      horizon_year: number | null;
      updated_at: string | null;
    }>
  );

  const linkedReports = mergeRecords(
    ((projectReportsResult.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      title: string | null;
      report_type: string | null;
      status: string | null;
      summary: string | null;
      generated_at: string | null;
      latest_artifact_kind: string | null;
      updated_at: string | null;
    }>).map((report) => ({
      ...report,
      artifactCount: artifactCountsByReport.get(report.id) ?? 0,
    })),
    ((explicitReportsResult.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      title: string | null;
      report_type: string | null;
      status: string | null;
      summary: string | null;
      generated_at: string | null;
      latest_artifact_kind: string | null;
      updated_at: string | null;
    }>).map((report) => ({
      ...report,
      artifactCount: artifactCountsByReport.get(report.id) ?? 0,
    }))
  );

  const linkedCampaigns = mergeRecords(
    ((projectCampaignsResult.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      title: string | null;
      summary: string | null;
      status: string | null;
      engagement_type: string | null;
      updated_at: string | null;
    }>).map((campaign) => ({
      ...campaign,
      approvedItemCount: engagementStatsByCampaign.get(campaign.id)?.approved ?? 0,
      pendingItemCount: engagementStatsByCampaign.get(campaign.id)?.pending ?? 0,
    })),
    ((explicitCampaignsResult.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      title: string | null;
      summary: string | null;
      status: string | null;
      engagement_type: string | null;
      updated_at: string | null;
    }>).map((campaign) => ({
      ...campaign,
      approvedItemCount: engagementStatsByCampaign.get(campaign.id)?.approved ?? 0,
      pendingItemCount: engagementStatsByCampaign.get(campaign.id)?.pending ?? 0,
    }))
  );

  const linkedProjects = mergeRecords(
    primaryProjectResult.data ? [primaryProjectResult.data] : [],
    (explicitProjectsResult.data ?? []) as Array<{
      id: string;
      workspace_id: string;
      name: string | null;
      summary: string | null;
      status: string | null;
      plan_type: string | null;
      delivery_phase: string | null;
      updated_at: string | null;
    }>
  );

  const linkedPlanTitleById = new Map(
    linkedPlans.map((plan) => [plan.id, plan.title ?? "Untitled plan"] as const)
  );
  const linkedPlanIds = [...linkedPlanTitleById.keys()];

  const [projectModelsResult, planModelLinksResult] = await Promise.all([
    program.project_id
      ? supabase
          .from("models")
          .select(
            "id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, summary, last_validated_at, last_run_recorded_at, updated_at"
          )
          .eq("project_id", program.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    linkedPlanIds.length
      ? supabase.from("model_links").select("model_id, link_type, linked_id").eq("link_type", "plan").in("linked_id", linkedPlanIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const planBasedModelIds = Array.from(
    new Set(((planModelLinksResult.data ?? []) as Array<{ model_id: string }>).map((link) => link.model_id))
  );

  const [planBasedModelsResult, supportingModelLinksResult] = await Promise.all([
    planBasedModelIds.length
      ? supabase
          .from("models")
          .select(
            "id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, summary, last_validated_at, last_run_recorded_at, updated_at"
          )
          .in("id", planBasedModelIds)
      : Promise.resolve({ data: [], error: null }),
    (projectModelsResult.data ?? []).length || planBasedModelIds.length
      ? supabase
          .from("model_links")
          .select("model_id, link_type, linked_id")
          .in(
            "model_id",
            Array.from(
              new Set([
                ...((projectModelsResult.data ?? []) as Array<{ id: string }>).map((model) => model.id),
                ...planBasedModelIds,
              ])
            )
          )
      : Promise.resolve({ data: [], error: null }),
  ]);

  const supportingModelLinksByModel = new Map<string, Array<{ model_id: string; link_type: string; linked_id: string }>>();
  for (const link of (supportingModelLinksResult.data ?? []) as Array<{ model_id: string; link_type: string; linked_id: string }>) {
    const current = supportingModelLinksByModel.get(link.model_id) ?? [];
    current.push(link);
    supportingModelLinksByModel.set(link.model_id, current);
  }

  const planTitlesByModel = new Map<string, string[]>();
  for (const link of (planModelLinksResult.data ?? []) as Array<{ model_id: string; linked_id: string }>) {
    const title = linkedPlanTitleById.get(link.linked_id);
    if (!title) continue;
    const current = planTitlesByModel.get(link.model_id) ?? [];
    if (!current.includes(title)) current.push(title);
    planTitlesByModel.set(link.model_id, current);
  }

  const supportingModels = mergeSupportingProgramModels<SupportingProgramModelBase>(
    (projectModelsResult.data ?? []) as SupportingProgramModelBase[],
    (planBasedModelsResult.data ?? []) as SupportingProgramModelBase[]
  ).map((model) => {
    const workspaceSummary = buildModelWorkspaceSummary({
      modelStatus: model.status,
      projectId: model.project_id,
      scenarioSetId: model.scenario_set_id,
      configVersion: model.config_version,
      ownerLabel: model.owner_label,
      assumptionsSummary: null,
      inputSummary: null,
      outputSummary: null,
      lastValidatedAt: model.last_validated_at,
      lastRunRecordedAt: model.last_run_recorded_at,
      links: supportingModelLinksByModel.get(model.id) ?? [],
    });

    return {
      ...model,
      ...workspaceSummary,
      linkedPlanTitles: planTitlesByModel.get(model.id) ?? [],
    };
  });

  const readiness = buildProgramReadiness({
    cycleName: program.cycle_name,
    hasProject: linkedProjects.length > 0,
    planCount: linkedPlans.length,
    reportCount: linkedReports.length,
    engagementCampaignCount: linkedCampaigns.length,
    sponsorAgency: program.sponsor_agency,
    fiscalYearStart: program.fiscal_year_start,
    fiscalYearEnd: program.fiscal_year_end,
    nominationDueAt: program.nomination_due_at,
    adoptionTargetAt: program.adoption_target_at,
  });

  const supportingModelReadyCount = supportingModels.filter((model) => model.readiness.ready).length;
  const projectBasedModelCount = supportingModels.filter((model) => model.supportBasis !== "plan").length;
  const planBasedModelCount = supportingModels.filter((model) => model.supportBasis !== "project").length;
  const linkedBasisCount = linkedPlans.length + linkedReports.length + linkedCampaigns.length + supportingModels.length;

  const workflow = buildProgramWorkflowSummary({
    programStatus: program.status,
    readiness,
    planCount: linkedPlans.length,
    reportCount: linkedReports.length,
    generatedReportCount: linkedReports.filter((report) => report.status === "generated").length,
    engagementCampaignCount: linkedCampaigns.length,
    approvedEngagementItemCount: linkedCampaigns.reduce((sum, item) => sum + item.approvedItemCount, 0),
    pendingEngagementItemCount: linkedCampaigns.reduce((sum, item) => sum + item.pendingItemCount, 0),
  });

  return (
    <section className="space-y-6">
      <Link
        href="/programs"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Programs
      </Link>

      <header className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ClipboardList className="h-3.5 w-3.5" />
            Programming record
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{program.title}</h1>
            <p className="module-intro-description">{program.summary || workflow.reason}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={programStatusTone(program.status)}>{formatProgramStatusLabel(program.status)}</StatusBadge>
            <StatusBadge tone="info">{formatProgramTypeLabel(program.program_type)}</StatusBadge>
            <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
          </div>

          <div className="module-summary-grid cols-3 mt-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Cycle</p>
              <p className="module-summary-value text-xl">{program.cycle_name}</p>
              <p className="module-summary-detail">{formatFiscalWindow(program.fiscal_year_start, program.fiscal_year_end)}</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked basis</p>
              <p className="module-summary-value">{linkedBasisCount}</p>
              <p className="module-summary-detail">Plans, models, reports, and engagement records tied into this package.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Schedule</p>
              <p className="module-summary-value">{readiness.readyCheckCount}/{readiness.totalCheckCount}</p>
              <p className="module-summary-detail">Readiness checks satisfied across metadata and supporting evidence.</p>
            </div>
          </div>
        </article>

        <ProgramDetailControls
          program={program}
          projects={(projectsResult.data ?? []) as Array<{ id: string; name: string }>}
          plans={(allPlansResult.data ?? []) as Array<{ id: string; title: string }>}
          reports={(allReportsResult.data ?? []) as Array<{ id: string; title: string }>}
          engagementCampaigns={(allCampaignsResult.data ?? []) as Array<{ id: string; title: string }>}
          selectedLinks={{
            plans: planLinkIds,
            reports: reportLinkIds,
            engagementCampaigns: campaignLinkIds,
            relatedProjects: projectLinkIds,
          }}
        />
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Readiness</p>
              <h2 className="module-section-title">Package basis and timing</h2>
              <p className="module-section-description">{workflow.packageDetail}</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              {readiness.label}
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {readiness.checks.map((check) => (
              <div key={check.key} className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{check.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{check.detail}</p>
                  </div>
                  <StatusBadge tone={check.ready ? "success" : "warning"}>{check.ready ? "Ready" : "Missing"}</StatusBadge>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-border/70 bg-background/80 p-4">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workflow summary</p>
            <p className="mt-2 text-base font-semibold text-foreground">{workflow.label}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{workflow.reason}</p>
            <div className="mt-4 space-y-2">
              {workflow.actionItems.length > 0 ? (
                workflow.actionItems.map((item) => (
                  <div key={item} className="rounded-xl border border-border/60 bg-card px-3 py-2 text-sm text-muted-foreground">
                    {item}
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-border/60 bg-card px-3 py-2 text-sm text-muted-foreground">
                  No immediate action items surfaced by the current metadata and linked records.
                </div>
              )}
            </div>
          </div>
        </article>

        <div className="space-y-6">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Identity</p>
                <h2 className="module-section-title">Cycle metadata</h2>
                <p className="module-section-description">Timing and package posture that should travel with the funding record.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <FolderKanban className="h-3.5 w-3.5" />
                {linkedProjects.length} project link{linkedProjects.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sponsor</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{program.sponsor_agency || "Not set"}</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Fiscal window</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {formatFiscalWindow(program.fiscal_year_start, program.fiscal_year_end)}
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Nomination due</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{formatProgramDateTime(program.nomination_due_at)}</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Adoption target</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{formatProgramDateTime(program.adoption_target_at)}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-1.5 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
              <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
                Created {formatProgramDateTime(program.created_at)}
              </span>
              <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
                Updated {formatProgramDateTime(program.updated_at)}
              </span>
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Linked records</p>
                <h2 className="module-section-title">Projects, plans, models, reports, and engagement evidence</h2>
                <p className="module-section-description">
                  Programs inherit context from the primary project and linked plans, so model support stays visible alongside the rest of the package evidence.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Projects</h3>
                </div>
                {linkedProjects.length === 0 ? (
                  <EmptyState title="No project links yet" description="Attach a primary or related project to anchor the package." />
                ) : (
                  <div className="space-y-3">
                    {linkedProjects.map((project) => (
                      <Link key={project.id} href={`/projects/${project.id}`} className="module-record-row is-interactive group block">
                        <div className="module-record-head">
                          <div className="module-record-main">
                            <div className="module-record-kicker">
                              <StatusBadge tone="neutral">{linkBasisLabel(project.linkBasis)}</StatusBadge>
                              <StatusBadge tone="info">{titleizeProgramValue(project.plan_type)}</StatusBadge>
                              <StatusBadge tone="neutral">{titleizeProgramValue(project.delivery_phase)}</StatusBadge>
                            </div>
                            <div className="space-y-1.5">
                              <h3 className="module-record-title text-[1.02rem] transition group-hover:text-primary">
                                {project.name ?? "Unknown project"}
                              </h3>
                              <p className="module-record-summary line-clamp-2">
                                {project.summary || "No summary on file for this project record."}
                              </p>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Plans</h3>
                </div>
                {linkedPlans.length === 0 ? (
                  <EmptyState title="No plan basis linked" description="Attach plan records that justify why this package belongs in the cycle." />
                ) : (
                  <div className="space-y-3">
                    {linkedPlans.map((plan) => (
                      <Link key={plan.id} href={`/plans/${plan.id}`} className="module-record-row is-interactive group block">
                        <div className="module-record-head">
                          <div className="module-record-main">
                            <div className="module-record-kicker">
                              <StatusBadge tone="neutral">{linkBasisLabel(plan.linkBasis)}</StatusBadge>
                              <StatusBadge tone={planStatusTone(plan.status)}>{formatPlanStatusLabel(plan.status)}</StatusBadge>
                              <StatusBadge tone="info">{formatPlanTypeLabel(plan.plan_type)}</StatusBadge>
                            </div>
                            <div className="space-y-1.5">
                              <h3 className="module-record-title text-[1.02rem] transition group-hover:text-primary">
                                {plan.title ?? "Untitled plan"}
                              </h3>
                              <p className="module-record-summary line-clamp-2">
                                {plan.summary || "No summary on file for this linked plan record."}
                              </p>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Models</h3>
                </div>
                {supportingModels.length === 0 ? (
                  <EmptyState
                    title="No supporting models visible"
                    description="Anchor models to the primary project or linked plans so the package carries an explicit modeling basis."
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Supporting models</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{supportingModels.length}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{supportingModelReadyCount} fully ready.</p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Project context</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{projectBasedModelCount}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Models anchored to the package project.</p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Linked plan basis</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{planBasedModelCount}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Models surfaced through linked plans.</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {supportingModels.map((model) => (
                        <Link key={model.id} href={`/models/${model.id}`} className="module-record-row is-interactive group block">
                          <div className="module-record-head">
                            <div className="module-record-main">
                              <div className="module-record-kicker">
                                <StatusBadge tone="neutral">{modelSupportBasisLabel(model.supportBasis)}</StatusBadge>
                                <StatusBadge tone={modelStatusTone(model.status)}>{formatModelStatusLabel(model.status)}</StatusBadge>
                                <StatusBadge tone="info">{formatModelFamilyLabel(model.model_family)}</StatusBadge>
                                <StatusBadge tone={model.readiness.ready ? "success" : "warning"}>{model.readiness.label}</StatusBadge>
                              </div>
                              <div className="space-y-1.5">
                                <h3 className="module-record-title text-[1.02rem] transition group-hover:text-primary">
                                  {model.title ?? "Untitled model"}
                                </h3>
                                <p className="module-record-summary line-clamp-2">
                                  {model.summary || "No summary on file for this supporting model record."}
                                </p>
                                <div className="module-record-meta">
                                  <span className="module-record-chip">{model.config_version ? `Config ${model.config_version}` : "Config pending"}</span>
                                  <span className="module-record-chip">{model.owner_label ? `Owner ${model.owner_label}` : "Owner pending"}</span>
                                  <span className="module-record-chip">{model.linkageCounts.runs} runs</span>
                                  <span className="module-record-chip">{model.linkageCounts.reports} reports</span>
                                  {model.linkedPlanTitles.map((title) => (
                                    <span key={`${model.id}-${title}`} className="module-record-chip">Plan {title}</span>
                                  ))}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {model.readiness.missingCheckLabels.length > 0
                                    ? `Missing basis: ${model.readiness.missingCheckLabels.join(", ")}.`
                                    : model.workflow.reason}
                                </p>
                              </div>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <FileStack className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reports</h3>
                </div>
                {linkedReports.length === 0 ? (
                  <EmptyState title="No packet outputs linked" description="Attach reports or packet records that support the programming narrative." />
                ) : (
                  <div className="space-y-3">
                    {linkedReports.map((report) => (
                      <Link key={report.id} href={`/reports/${report.id}`} className="module-record-row is-interactive group block">
                        <div className="module-record-head">
                          <div className="module-record-main">
                            <div className="module-record-kicker">
                              <StatusBadge tone="neutral">{linkBasisLabel(report.linkBasis)}</StatusBadge>
                              <StatusBadge tone={reportStatusTone(report.status)}>{formatReportStatusLabel(report.status)}</StatusBadge>
                              <StatusBadge tone="info">{formatReportTypeLabel(report.report_type)}</StatusBadge>
                            </div>
                            <div className="space-y-1.5">
                              <h3 className="module-record-title text-[1.02rem] transition group-hover:text-primary">
                                {report.title ?? "Untitled report"}
                              </h3>
                              <p className="module-record-summary line-clamp-2">
                                {report.summary || "No summary on file for this linked packet record."}
                              </p>
                              <div className="module-record-meta">
                                <span className="module-record-chip">{report.artifactCount} artifacts</span>
                                <span className="module-record-chip">
                                  {report.generated_at ? `Generated ${formatProgramDateTime(report.generated_at)}` : "Not generated"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <MessagesSquare className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Engagement</h3>
                </div>
                {linkedCampaigns.length === 0 ? (
                  <EmptyState title="No engagement evidence linked" description="Attach outreach campaigns so the package carries a visible public record basis." />
                ) : (
                  <div className="space-y-3">
                    {linkedCampaigns.map((campaign) => (
                      <Link key={campaign.id} href={`/engagement/${campaign.id}`} className="module-record-row is-interactive group block">
                        <div className="module-record-head">
                          <div className="module-record-main">
                            <div className="module-record-kicker">
                              <StatusBadge tone="neutral">{linkBasisLabel(campaign.linkBasis)}</StatusBadge>
                              <StatusBadge tone={engagementStatusTone(campaign.status ?? "draft")}>
                                {titleizeEngagementValue(campaign.status)}
                              </StatusBadge>
                              <StatusBadge tone="info">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                            </div>
                            <div className="space-y-1.5">
                              <h3 className="module-record-title text-[1.02rem] transition group-hover:text-primary">
                                {campaign.title ?? "Untitled campaign"}
                              </h3>
                              <p className="module-record-summary line-clamp-2">
                                {campaign.summary || "No summary on file for this linked engagement campaign."}
                              </p>
                              <div className="module-record-meta">
                                <span className="module-record-chip">{campaign.approvedItemCount} approved items</span>
                                <span className="module-record-chip">{campaign.pendingItemCount} pending items</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
