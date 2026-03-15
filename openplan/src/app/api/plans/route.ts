import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  buildPlanArtifactCoverage,
  buildPlanReadiness,
  PLAN_LINK_TYPE_OPTIONS,
  PLAN_STATUS_OPTIONS,
  PLAN_TYPE_OPTIONS,
  type PlanLinkType,
} from "@/lib/plans/catalog";

const PLAN_TYPES = PLAN_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PLAN_STATUSES = PLAN_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PLAN_LINK_TYPES = PLAN_LINK_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];

const listPlansSchema = z.object({
  projectId: z.string().uuid().optional(),
  planType: z.enum(PLAN_TYPES).optional(),
  status: z.enum(PLAN_STATUSES).optional(),
});

const planLinkInputSchema = z.object({
  linkType: z.enum(PLAN_LINK_TYPES),
  linkedId: z.string().uuid(),
  label: z.string().trim().max(160).optional(),
});

const createPlanSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  planType: z.enum(PLAN_TYPES),
  status: z.enum(PLAN_STATUSES).optional(),
  geographyLabel: z.string().trim().max(160).optional(),
  horizonYear: z.number().int().min(1900).max(2200).optional(),
  summary: z.string().trim().max(4000).optional(),
  links: z.array(planLinkInputSchema).max(40).optional(),
});

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
  created_at: string;
  updated_at: string;
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

async function resolveWorkspaceContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId?: string
) {
  if (projectId) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      return { workspaceId: null, project: null, error: projectError, allowed: false };
    }

    if (!project) {
      return { workspaceId: null, project: null, error: null, allowed: false };
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", project.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      return { workspaceId: null, project, error: membershipError, allowed: false };
    }

    return {
      workspaceId: project.workspace_id,
      project,
      error: null,
      allowed: Boolean(membership && canAccessWorkspaceAction("plans.write", membership.role)),
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return { workspaceId: null, project: null, error: membershipError, allowed: false };
  }

  if (!membership) {
    return { workspaceId: null, project: null, error: null, allowed: false };
  }

  return {
    workspaceId: membership.workspace_id,
    project: null,
    error: null,
    allowed: canAccessWorkspaceAction("plans.write", membership.role),
  };
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

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("plans.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listPlansSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      planType: request.nextUrl.searchParams.get("planType") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    });

    if (!parsedFilters.success) {
      audit.warn("validation_failed", { issues: parsedFilters.error.issues });
      return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let query = supabase
      .from("plans")
      .select(
        "id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at, projects(id, name)"
      )
      .order("updated_at", { ascending: false });

    if (parsedFilters.data.projectId) {
      query = query.eq("project_id", parsedFilters.data.projectId);
    }

    if (parsedFilters.data.planType) {
      query = query.eq("plan_type", parsedFilters.data.planType);
    }

    if (parsedFilters.data.status) {
      query = query.eq("status", parsedFilters.data.status);
    }

    const { data: plansData, error } = await query;

    if (error) {
      audit.error("plans_list_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load plans" }, { status: 500 });
    }

    const plans = plansData ?? [];
    const planIds = plans.map((plan) => plan.id);
    const projectIds = [...new Set(plans.map((plan) => plan.project_id).filter((value): value is string => Boolean(value)))];

    const [planLinksResult, scenarioResult, engagementResult, reportResult] = await Promise.all([
      planIds.length
        ? supabase
            .from("plan_links")
            .select("id, plan_id, link_type, linked_id, label, created_at, updated_at")
            .in("plan_id", planIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? supabase.from("scenario_sets").select("id, project_id").in("project_id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? supabase.from("engagement_campaigns").select("id, project_id").in("project_id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? supabase.from("reports").select("id, project_id").in("project_id", projectIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["plan_links", planLinksResult],
      ["scenario_sets", scenarioResult],
      ["engagement_campaigns", engagementResult],
      ["reports", reportResult],
    ] as const) {
      if (result.error) {
        audit.error("plans_related_lookup_failed", {
          source: name,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load plan linkage summary" }, { status: 500 });
      }
    }

    const planLinkRows = (planLinksResult.data ?? []) as PlanLinkRow[];
    const linksByPlan = new Map<string, PlanLinkRow[]>();
    for (const link of planLinkRows) {
      const current = linksByPlan.get(link.plan_id) ?? [];
      current.push(link);
      linksByPlan.set(link.plan_id, current);
    }

    const scenariosByProject = new Map<string, number>();
    for (const row of scenarioResult.data ?? []) {
      if (!row.project_id) continue;
      scenariosByProject.set(row.project_id, (scenariosByProject.get(row.project_id) ?? 0) + 1);
    }

    const campaignsByProject = new Map<string, number>();
    for (const row of engagementResult.data ?? []) {
      if (!row.project_id) continue;
      campaignsByProject.set(row.project_id, (campaignsByProject.get(row.project_id) ?? 0) + 1);
    }

    const reportsByProject = new Map<string, number>();
    for (const row of reportResult.data ?? []) {
      if (!row.project_id) continue;
      reportsByProject.set(row.project_id, (reportsByProject.get(row.project_id) ?? 0) + 1);
    }

    const typedPlans = plans.map((plan) => {
      const planLinks = linksByPlan.get(plan.id) ?? [];
      const explicitScenarioCount = planLinks.filter((link) => link.link_type === "scenario_set").length;
      const explicitCampaignCount = planLinks.filter((link) => link.link_type === "engagement_campaign").length;
      const explicitReportCount = planLinks.filter((link) => link.link_type === "report").length;
      const explicitProjectCount = planLinks.filter((link) => link.link_type === "project_record").length;

      const scenarioCount = explicitScenarioCount + (plan.project_id ? scenariosByProject.get(plan.project_id) ?? 0 : 0);
      const engagementCampaignCount =
        explicitCampaignCount + (plan.project_id ? campaignsByProject.get(plan.project_id) ?? 0 : 0);
      const reportCount = explicitReportCount + (plan.project_id ? reportsByProject.get(plan.project_id) ?? 0 : 0);

      return {
        ...plan,
        readiness: buildPlanReadiness({
          hasProject: Boolean(plan.project_id || explicitProjectCount > 0),
          scenarioCount,
          engagementCampaignCount,
          reportCount,
          geographyLabel: plan.geography_label,
          horizonYear: plan.horizon_year,
        }),
        artifactCoverage: buildPlanArtifactCoverage({
          scenarioCount,
          engagementCampaignCount,
          reportCount,
        }),
        linkageCounts: {
          scenarios: scenarioCount,
          engagementCampaigns: engagementCampaignCount,
          reports: reportCount,
          relatedProjects: explicitProjectCount + (plan.project_id ? 1 : 0),
        },
      };
    });

    audit.info("plans_list_loaded", {
      userId: user.id,
      count: typedPlans.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        plans: typedPlans,
        summary: {
          byStatus: typedPlans.reduce<Record<string, number>>((acc, plan) => {
            acc[plan.status] = (acc[plan.status] ?? 0) + 1;
            return acc;
          }, {}),
          byType: typedPlans.reduce<Record<string, number>>((acc, plan) => {
            acc[plan.plan_type] = (acc[plan.plan_type] ?? 0) + 1;
            return acc;
          }, {}),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("plans_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading plans" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("plans.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createPlanSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const context = await resolveWorkspaceContext(supabase, user.id, parsed.data.projectId);

    if (context.error) {
      audit.error("workspace_context_failed", {
        userId: user.id,
        projectId: parsed.data.projectId ?? null,
        message: context.error.message,
        code: context.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (parsed.data.projectId && !context.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!context.workspaceId || !context.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const linkValidation = await validatePlanLinks(supabase, context.workspaceId, parsed.data.links ?? []);

    if ("error" in linkValidation && linkValidation.error) {
      audit.error("plan_links_validation_failed", {
        workspaceId: context.workspaceId,
        message: linkValidation.error.message,
        code: linkValidation.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify linked records" }, { status: 500 });
    }

    if ("invalid" in linkValidation && linkValidation.invalid) {
      return NextResponse.json({ error: "One or more linked records are invalid" }, { status: 400 });
    }

    const { data: plan, error: insertError } = await supabase
      .from("plans")
      .insert({
        workspace_id: context.workspaceId,
        project_id: parsed.data.projectId ?? null,
        title: parsed.data.title.trim(),
        plan_type: parsed.data.planType,
        status: parsed.data.status ?? "draft",
        geography_label: parsed.data.geographyLabel?.trim() || null,
        horizon_year: parsed.data.horizonYear ?? null,
        summary: parsed.data.summary?.trim() || null,
        created_by: user.id,
      })
      .select(
        "id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at"
      )
      .single();

    if (insertError || !plan) {
      audit.error("plan_insert_failed", {
        userId: user.id,
        workspaceId: context.workspaceId,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create plan" }, { status: 500 });
    }

    const preparedLinks = linkValidation.preparedLinks ?? [];

    if (preparedLinks.length > 0) {
      const { error: linksError } = await supabase.from("plan_links").insert(
        preparedLinks.map((link) => ({
          plan_id: plan.id,
          ...link,
          created_by: user.id,
        }))
      );

      if (linksError) {
        audit.error("plan_links_insert_failed", {
          planId: plan.id,
          message: linksError.message,
          code: linksError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to create plan links" }, { status: 500 });
      }
    }

    const readiness = buildPlanReadiness({
      hasProject: Boolean(plan.project_id || preparedLinks.some((link) => link.link_type === "project_record")),
      scenarioCount: preparedLinks.filter((link) => link.link_type === "scenario_set").length,
      engagementCampaignCount: preparedLinks.filter((link) => link.link_type === "engagement_campaign").length,
      reportCount: preparedLinks.filter((link) => link.link_type === "report").length,
      geographyLabel: plan.geography_label,
      horizonYear: plan.horizon_year,
    });

    audit.info("plan_created", {
      userId: user.id,
      workspaceId: context.workspaceId,
      projectId: parsed.data.projectId ?? null,
      planId: plan.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ planId: plan.id, plan: { ...plan, readiness } }, { status: 201 });
  } catch (error) {
    audit.error("plans_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating plan" }, { status: 500 });
  }
}
