import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadPlanAccess } from "@/lib/plans/api";
import {
  buildPlanArtifactCoverage,
  buildPlanReadiness,
  buildPlanWorkflowSummary,
  PLAN_LINK_TYPE_OPTIONS,
  PLAN_STATUS_OPTIONS,
  PLAN_TYPE_OPTIONS,
  type PlanLinkType,
} from "@/lib/plans/catalog";

const PLAN_TYPES = PLAN_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PLAN_STATUSES = PLAN_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PLAN_LINK_TYPES = PLAN_LINK_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];

const paramsSchema = z.object({
  planId: z.string().uuid(),
});

const planLinkInputSchema = z.object({
  linkType: z.enum(PLAN_LINK_TYPES),
  linkedId: z.string().uuid(),
  label: z.string().trim().max(160).optional(),
});

const patchPlanSchema = z
  .object({
    projectId: z.union([z.string().uuid(), z.null()]).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    planType: z.enum(PLAN_TYPES).optional(),
    status: z.enum(PLAN_STATUSES).optional(),
    geographyLabel: z.union([z.string().trim().max(160), z.null()]).optional(),
    horizonYear: z.union([z.number().int().min(1900).max(2200), z.null()]).optional(),
    summary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    links: z.array(planLinkInputSchema).max(40).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ planId: string }>;
};

type LinkInput = z.infer<typeof planLinkInputSchema>;

type LinkTargetRow = {
  id: string;
  workspace_id: string;
  title?: string | null;
  name?: string | null;
};

type PreparedPlanLink = {
  link_type: PlanLinkType;
  linked_id: string;
  label: string | null;
};

type PlanLinkRow = {
  id: string;
  plan_id: string;
  link_type: string;
  linked_id: string;
  label: string | null;
  created_at?: string;
  updated_at?: string;
};

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

const LINK_TARGET_CONFIG: Record<
  PlanLinkType,
  { table: string; select: string; labelField: "title" | "name" }
> = {
  scenario_set: {
    table: "scenario_sets",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  engagement_campaign: {
    table: "engagement_campaigns",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  report: {
    table: "reports",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  project_record: {
    table: "projects",
    select: "id, workspace_id, name",
    labelField: "name",
  },
};

function dedupeLinks(links: LinkInput[] | undefined): LinkInput[] {
  if (!links?.length) return [];

  const seen = new Set<string>();
  const deduped: LinkInput[] = [];

  for (const link of links) {
    const key = `${link.linkType}:${link.linkedId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

async function validatePlanLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  links: LinkInput[]
) {
  const dedupedLinks = dedupeLinks(links);

  if (dedupedLinks.length === 0) {
    return { preparedLinks: [] as PreparedPlanLink[] };
  }

  const labels = new Map<string, string | null>();

  for (const linkType of PLAN_LINK_TYPES) {
    const linksForType = dedupedLinks.filter((link) => link.linkType === linkType);
    if (linksForType.length === 0) continue;

    const config = LINK_TARGET_CONFIG[linkType as PlanLinkType];
    const ids = linksForType.map((link) => link.linkedId);

    const { data, error } = await supabase
      .from(config.table)
      .select(config.select)
      .eq("workspace_id", workspaceId)
      .in("id", ids);

    if (error) {
      return { error, preparedLinks: null };
    }

    const rows = (data ?? []) as unknown as LinkTargetRow[];
    if (rows.length !== new Set(ids).size) {
      return { invalid: true, preparedLinks: null as PreparedPlanLink[] | null };
    }

    for (const row of rows) {
      labels.set(`${linkType}:${row.id}`, row[config.labelField] ?? null);
    }
  }

  return {
    preparedLinks: dedupedLinks.map((link) => ({
      link_type: link.linkType as PlanLinkType,
      linked_id: link.linkedId,
      label: link.label?.trim() || labels.get(`${link.linkType}:${link.linkedId}`) || null,
    })),
  };
}

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

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("plans.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadPlanAccess(supabase, parsedParams.data.planId, user.id, "plans.read");

    if (access.error) {
      audit.error("plan_access_failed", {
        planId: parsedParams.data.planId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
    }

    if (!access.plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const detailSupabase = access.supabase as Awaited<ReturnType<typeof createClient>>;

    const [projectResult, planLinksResult, projectScenariosResult, projectCampaignsResult, projectReportsResult] =
      await Promise.all([
        access.plan.project_id
          ? detailSupabase
              .from("projects")
              .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
              .eq("id", access.plan.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        detailSupabase
          .from("plan_links")
          .select("id, plan_id, link_type, linked_id, label, created_at, updated_at")
          .eq("plan_id", access.plan.id),
        access.plan.project_id
          ? detailSupabase
              .from("scenario_sets")
              .select("id, project_id, title, summary, planning_question, status, baseline_entry_id, updated_at")
              .eq("project_id", access.plan.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        access.plan.project_id
          ? detailSupabase
              .from("engagement_campaigns")
              .select("id, project_id, title, summary, status, engagement_type, updated_at")
              .eq("project_id", access.plan.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        access.plan.project_id
          ? detailSupabase
              .from("reports")
              .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
              .eq("project_id", access.plan.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

    for (const [name, result] of [
      ["project", projectResult],
      ["plan_links", planLinksResult],
      ["project_scenarios", projectScenariosResult],
      ["project_campaigns", projectCampaignsResult],
      ["project_reports", projectReportsResult],
    ] as const) {
      if (result.error) {
        audit.error("plan_related_lookup_failed", {
          source: name,
          planId: access.plan.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load plan detail" }, { status: 500 });
      }
    }

    const planLinks = (planLinksResult.data ?? []) as PlanLinkRow[];
    const scenarioLinkIds = planLinks.filter((link) => link.link_type === "scenario_set").map((link) => link.linked_id);
    const campaignLinkIds = planLinks.filter((link) => link.link_type === "engagement_campaign").map((link) => link.linked_id);
    const reportLinkIds = planLinks.filter((link) => link.link_type === "report").map((link) => link.linked_id);
    const projectLinkIds = planLinks.filter((link) => link.link_type === "project_record").map((link) => link.linked_id);

    const [explicitScenariosResult, explicitCampaignsResult, explicitReportsResult, explicitProjectsResult] = await Promise.all([
      scenarioLinkIds.length
        ? detailSupabase
            .from("scenario_sets")
            .select("id, project_id, title, summary, planning_question, status, baseline_entry_id, updated_at")
            .in("id", scenarioLinkIds)
        : Promise.resolve({ data: [], error: null }),
      campaignLinkIds.length
        ? detailSupabase
            .from("engagement_campaigns")
            .select("id, project_id, title, summary, status, engagement_type, updated_at")
            .in("id", campaignLinkIds)
        : Promise.resolve({ data: [], error: null }),
      reportLinkIds.length
        ? detailSupabase
            .from("reports")
            .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
            .in("id", reportLinkIds)
        : Promise.resolve({ data: [], error: null }),
      projectLinkIds.length
        ? detailSupabase
            .from("projects")
            .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
            .in("id", projectLinkIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["explicit_scenarios", explicitScenariosResult],
      ["explicit_campaigns", explicitCampaignsResult],
      ["explicit_reports", explicitReportsResult],
      ["explicit_projects", explicitProjectsResult],
    ] as const) {
      if (result.error) {
        audit.error("plan_explicit_links_lookup_failed", {
          source: name,
          planId: access.plan.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load linked records" }, { status: 500 });
      }
    }

    const scenarioIds = Array.from(
      new Set([
        ...((projectScenariosResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
        ...((explicitScenariosResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
      ])
    );
    const campaignIds = Array.from(
      new Set([
        ...((projectCampaignsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
        ...((explicitCampaignsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
      ])
    );
    const linkedReportIds = Array.from(
      new Set([
        ...((projectReportsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
        ...((explicitReportsResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
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
        ? detailSupabase
            .from("scenario_entries")
            .select("scenario_set_id, status, attached_run_id")
            .in("scenario_set_id", scenarioIds)
        : Promise.resolve({ data: [], error: null }),
      campaignIds.length
        ? detailSupabase.from("engagement_categories").select("campaign_id").in("campaign_id", campaignIds)
        : Promise.resolve({ data: [], error: null }),
      campaignIds.length
        ? detailSupabase.from("engagement_items").select("campaign_id, status").in("campaign_id", campaignIds)
        : Promise.resolve({ data: [], error: null }),
      linkedReportIds.length
        ? detailSupabase.from("report_runs").select("report_id").in("report_id", linkedReportIds)
        : Promise.resolve({ data: [], error: null }),
      linkedReportIds.length
        ? detailSupabase.from("report_sections").select("report_id, enabled").in("report_id", linkedReportIds)
        : Promise.resolve({ data: [], error: null }),
      linkedReportIds.length
        ? detailSupabase.from("report_artifacts").select("report_id").in("report_id", linkedReportIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["scenario_entries", scenarioEntriesResult],
      ["engagement_categories", engagementCategoriesResult],
      ["engagement_items", engagementItemsResult],
      ["report_runs", reportRunsResult],
      ["report_sections", reportSectionsResult],
      ["report_artifacts", reportArtifactsResult],
    ] as const) {
      if (result.error) {
        audit.error("plan_operational_summary_lookup_failed", {
          source: name,
          planId: access.plan.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load linked record summaries" }, { status: 500 });
      }
    }

    const scenarioStatsById = new Map<string, { entryCount: number; readyEntryCount: number; attachedRunCount: number }>();
    for (const row of (scenarioEntriesResult.data ?? []) as Array<{
      scenario_set_id: string;
      status: string | null;
      attached_run_id: string | null;
    }>) {
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
    for (const row of (engagementCategoriesResult.data ?? []) as Array<{ campaign_id: string }>) {
      campaignCategoryCounts.set(row.campaign_id, (campaignCategoryCounts.get(row.campaign_id) ?? 0) + 1);
    }

    const campaignItemStats = new Map<
      string,
      { itemCount: number; approvedItemCount: number; pendingItemCount: number; flaggedItemCount: number }
    >();
    for (const row of (engagementItemsResult.data ?? []) as Array<{ campaign_id: string; status: string | null }>) {
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
    for (const row of (reportRunsResult.data ?? []) as Array<{ report_id: string }>) {
      reportRunCounts.set(row.report_id, (reportRunCounts.get(row.report_id) ?? 0) + 1);
    }

    const reportEnabledSectionCounts = new Map<string, number>();
    for (const row of (reportSectionsResult.data ?? []) as Array<{ report_id: string; enabled: boolean }>) {
      if (!row.enabled) continue;
      reportEnabledSectionCounts.set(row.report_id, (reportEnabledSectionCounts.get(row.report_id) ?? 0) + 1);
    }

    const reportArtifactCounts = new Map<string, number>();
    for (const row of (reportArtifactsResult.data ?? []) as Array<{ report_id: string }>) {
      reportArtifactCounts.set(row.report_id, (reportArtifactCounts.get(row.report_id) ?? 0) + 1);
    }

    const linkedScenarios = mergeArtifacts<ScenarioArtifactBase>(
      ((projectScenariosResult.data ?? []) as Array<{
        id: string;
        project_id: string | null;
        title: string | null;
        summary: string | null;
        planning_question: string | null;
        status: string | null;
        baseline_entry_id: string | null;
        updated_at: string | null;
      }>).map((item) => ({
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
      ((explicitScenariosResult.data ?? []) as Array<{
        id: string;
        project_id: string | null;
        title: string | null;
        summary: string | null;
        planning_question: string | null;
        status: string | null;
        baseline_entry_id: string | null;
        updated_at: string | null;
      }>).map((item) => ({
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
      ((projectCampaignsResult.data ?? []) as Array<{
        id: string;
        project_id: string | null;
        title: string | null;
        summary: string | null;
        status: string | null;
        engagement_type: string | null;
        updated_at: string | null;
      }>).map((item) => ({
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
      ((explicitCampaignsResult.data ?? []) as Array<{
        id: string;
        project_id: string | null;
        title: string | null;
        summary: string | null;
        status: string | null;
        engagement_type: string | null;
        updated_at: string | null;
      }>).map((item) => ({
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
      }>).map((item) => ({
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
      }>).map((item) => ({
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

    const linkedProjects = mergeArtifacts<
      {
        id: string;
        title: string | null;
        status: string | null;
        project_id: string | null;
        updated_at: string | null;
        summary?: string | null;
        plan_type?: string | null;
        delivery_phase?: string | null;
      }
    >(
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
      ((explicitProjectsResult.data ?? []) as Array<{
        id: string;
        name: string | null;
        summary: string | null;
        status: string | null;
        plan_type: string | null;
        delivery_phase: string | null;
        updated_at: string | null;
      }>).map((item) => ({
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
      geographyLabel: access.plan.geography_label,
      horizonYear: access.plan.horizon_year,
    });
    const artifactCoverage = buildPlanArtifactCoverage({
      scenarioCount: linkedScenarios.length,
      engagementCampaignCount: linkedCampaigns.length,
      reportCount: linkedReports.length,
    });
    const workflow = buildPlanWorkflowSummary({
      planStatus: access.plan.status,
      readiness,
      linkedProjectCount: linkedProjects.length,
      explicitLinkCount: planLinks.length,
      relatedProjectCount: linkedProjects.length,
      scenarioCount: linkedScenarios.length,
      readyScenarioCount: linkedScenarios.filter((item) => item.readyEntryCount > 0).length,
      engagementCampaignCount: linkedCampaigns.length,
      pendingEngagementItemCount: linkedCampaigns.reduce((sum, item) => sum + item.pendingItemCount, 0),
      flaggedEngagementItemCount: linkedCampaigns.reduce((sum, item) => sum + item.flaggedItemCount, 0),
      reportCount: linkedReports.length,
      generatedReportCount: linkedReports.filter((item) => Boolean(item.generated_at)).length,
      reportArtifactCount: linkedReports.reduce((sum, item) => sum + item.artifactCount, 0),
    });

    return NextResponse.json(
      {
        plan: access.plan,
        project: projectResult.data,
        linkedProjects,
        linkedScenarios,
        linkedCampaigns,
        linkedReports,
        planLinks,
        readiness,
        artifactCoverage,
        workflow,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("plans_detail_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading plan" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("plans.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchPlanSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid plan update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadPlanAccess(supabase, parsedParams.data.planId, user.id, "plans.write");

    if (access.error) {
      audit.error("plan_access_failed", {
        planId: parsedParams.data.planId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify plan access" }, { status: 500 });
    }

    if (!access.plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (parsed.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", parsed.data.projectId)
        .maybeSingle();

      if (projectError) {
        audit.error("plan_project_lookup_failed", {
          planId: access.plan.id,
          projectId: parsed.data.projectId,
          message: projectError.message,
          code: projectError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
      }

      if (!project || project.workspace_id !== access.plan.workspace_id) {
        return NextResponse.json({ error: "Linked project not found" }, { status: 404 });
      }
    }

    let preparedLinks: PreparedPlanLink[] | null = null;

    if (parsed.data.links !== undefined) {
      const linkValidation = await validatePlanLinks(supabase, access.plan.workspace_id, parsed.data.links);

      if ("error" in linkValidation && linkValidation.error) {
        audit.error("plan_links_validation_failed", {
          planId: access.plan.id,
          message: linkValidation.error.message,
          code: linkValidation.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked records" }, { status: 500 });
      }

      if ("invalid" in linkValidation && linkValidation.invalid) {
        return NextResponse.json({ error: "One or more linked records are invalid" }, { status: 400 });
      }

      preparedLinks = linkValidation.preparedLinks;
    }

    const planUpdate: Record<string, unknown> = {};
    if (parsed.data.projectId !== undefined) {
      planUpdate.project_id = parsed.data.projectId;
    }
    if (parsed.data.title !== undefined) {
      planUpdate.title = parsed.data.title;
    }
    if (parsed.data.planType !== undefined) {
      planUpdate.plan_type = parsed.data.planType;
    }
    if (parsed.data.status !== undefined) {
      planUpdate.status = parsed.data.status;
    }
    if (parsed.data.geographyLabel !== undefined) {
      planUpdate.geography_label = parsed.data.geographyLabel;
    }
    if (parsed.data.horizonYear !== undefined) {
      planUpdate.horizon_year = parsed.data.horizonYear;
    }
    if (parsed.data.summary !== undefined) {
      planUpdate.summary = parsed.data.summary;
    }

    if (Object.keys(planUpdate).length > 0) {
      const { error: updateError } = await supabase.from("plans").update(planUpdate).eq("id", access.plan.id);

      if (updateError) {
        audit.error("plan_update_failed", {
          planId: access.plan.id,
          message: updateError.message,
          code: updateError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
      }
    }

    if (preparedLinks !== null) {
      const { error: deleteError } = await supabase.from("plan_links").delete().eq("plan_id", access.plan.id);

      if (deleteError) {
        audit.error("plan_links_delete_failed", {
          planId: access.plan.id,
          message: deleteError.message,
          code: deleteError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to update plan links" }, { status: 500 });
      }

      if (preparedLinks.length > 0) {
        const { error: insertError } = await supabase.from("plan_links").insert(
          preparedLinks.map((link) => ({
            plan_id: access.plan.id,
            ...link,
            created_by: user.id,
          }))
        );

        if (insertError) {
          audit.error("plan_links_insert_failed", {
            planId: access.plan.id,
            message: insertError.message,
            code: insertError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to update plan links" }, { status: 500 });
        }
      }
    }

    const { data: updatedPlan, error: reloadError } = await supabase
      .from("plans")
      .select(
        "id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at"
      )
      .eq("id", access.plan.id)
      .maybeSingle();

    if (reloadError || !updatedPlan) {
      audit.error("plan_reload_failed", {
        planId: access.plan.id,
        message: reloadError?.message ?? "unknown",
        code: reloadError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load updated plan" }, { status: 500 });
    }

    audit.info("plan_updated", {
      userId: user.id,
      planId: access.plan.id,
      durationMs: Date.now() - startedAt,
      linksUpdated: preparedLinks !== null,
    });

    return NextResponse.json({ planId: updatedPlan.id, plan: updatedPlan }, { status: 200 });
  } catch (error) {
    audit.error("plans_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating plan" }, { status: 500 });
  }
}
