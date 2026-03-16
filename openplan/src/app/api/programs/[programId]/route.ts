import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProgramAccess } from "@/lib/programs/api";
import { replaceLinkSet, restoreLinkSet } from "@/lib/api/link-replacement";
import {
  buildProgramReadiness,
  buildProgramWorkflowSummary,
  PROGRAM_LINK_TYPE_OPTIONS,
  PROGRAM_STATUS_OPTIONS,
  PROGRAM_TYPE_OPTIONS,
  type ProgramLinkType,
} from "@/lib/programs/catalog";

const PROGRAM_TYPES = PROGRAM_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PROGRAM_STATUSES = PROGRAM_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PROGRAM_LINK_TYPES = PROGRAM_LINK_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];

const paramsSchema = z.object({
  programId: z.string().uuid(),
});

const programLinkInputSchema = z.object({
  linkType: z.enum(PROGRAM_LINK_TYPES),
  linkedId: z.string().uuid(),
  label: z.string().trim().max(160).optional(),
});

const patchProgramSchema = z
  .object({
    projectId: z.union([z.string().uuid(), z.null()]).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    programType: z.enum(PROGRAM_TYPES).optional(),
    status: z.enum(PROGRAM_STATUSES).optional(),
    cycleName: z.string().trim().min(1).max(160).optional(),
    sponsorAgency: z.union([z.string().trim().max(160), z.null()]).optional(),
    fiscalYearStart: z.union([z.number().int().min(2000).max(2300), z.null()]).optional(),
    fiscalYearEnd: z.union([z.number().int().min(2000).max(2300), z.null()]).optional(),
    nominationDueAt: z.union([z.string().datetime(), z.null()]).optional(),
    adoptionTargetAt: z.union([z.string().datetime(), z.null()]).optional(),
    summary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    links: z.array(programLinkInputSchema).max(40).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ programId: string }>;
};

type LinkInput = z.infer<typeof programLinkInputSchema>;

type LinkTargetRow = {
  id: string;
  workspace_id: string;
  title?: string | null;
  name?: string | null;
};

type PreparedProgramLink = {
  link_type: ProgramLinkType;
  linked_id: string;
  label: string | null;
};

type ProgramLinkRow = {
  id: string;
  program_id: string;
  link_type: string;
  linked_id: string;
  label: string | null;
};

const LINK_TARGET_CONFIG: Record<
  ProgramLinkType,
  { table: string; select: string; labelField: "title" | "name" }
> = {
  plan: {
    table: "plans",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  report: {
    table: "reports",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  engagement_campaign: {
    table: "engagement_campaigns",
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

async function validateProgramLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  links: LinkInput[]
) {
  const dedupedLinks = dedupeLinks(links);

  if (dedupedLinks.length === 0) {
    return { preparedLinks: [] as PreparedProgramLink[] };
  }

  const labels = new Map<string, string | null>();

  for (const linkType of PROGRAM_LINK_TYPES) {
    const linksForType = dedupedLinks.filter((link) => link.linkType === linkType);
    if (linksForType.length === 0) continue;

    const config = LINK_TARGET_CONFIG[linkType as ProgramLinkType];
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
      return { invalid: true, preparedLinks: null as PreparedProgramLink[] | null };
    }

    for (const row of rows) {
      labels.set(`${linkType}:${row.id}`, row[config.labelField] ?? null);
    }
  }

  return {
    preparedLinks: dedupedLinks.map((link) => ({
      link_type: link.linkType as ProgramLinkType,
      linked_id: link.linkedId,
      label: link.label?.trim() || labels.get(`${link.linkType}:${link.linkedId}`) || null,
    })),
  };
}

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

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("programs.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid program id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProgramAccess(supabase, parsedParams.data.programId, user.id, "programs.read");

    if (access.error) {
      audit.error("program_access_failed", {
        programId: parsedParams.data.programId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load program" }, { status: 500 });
    }

    if (!access.program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const detailSupabase = access.supabase as Awaited<ReturnType<typeof createClient>>;

    const [projectResult, linksResult, projectPlansResult, projectReportsResult, projectEngagementResult] =
      await Promise.all([
        access.program.project_id
          ? detailSupabase
              .from("projects")
              .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
              .eq("id", access.program.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        detailSupabase
          .from("program_links")
          .select("id, program_id, link_type, linked_id, label, created_at, updated_at")
          .eq("program_id", access.program.id),
        access.program.project_id
          ? detailSupabase
              .from("plans")
              .select("id, project_id, title, plan_type, status, summary, geography_label, horizon_year, updated_at")
              .eq("project_id", access.program.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        access.program.project_id
          ? detailSupabase
              .from("reports")
              .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
              .eq("project_id", access.program.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        access.program.project_id
          ? detailSupabase
              .from("engagement_campaigns")
              .select("id, project_id, title, summary, status, engagement_type, updated_at")
              .eq("project_id", access.program.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

    for (const [name, result] of [
      ["project", projectResult],
      ["program_links", linksResult],
      ["project_plans", projectPlansResult],
      ["project_reports", projectReportsResult],
      ["project_engagement", projectEngagementResult],
    ] as const) {
      if (result.error) {
        audit.error("program_related_lookup_failed", {
          source: name,
          programId: access.program.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load program detail" }, { status: 500 });
      }
    }

    const links = (linksResult.data ?? []) as ProgramLinkRow[];
    const planLinkIds = links.filter((link) => link.link_type === "plan").map((link) => link.linked_id);
    const reportLinkIds = links.filter((link) => link.link_type === "report").map((link) => link.linked_id);
    const campaignLinkIds = links.filter((link) => link.link_type === "engagement_campaign").map((link) => link.linked_id);
    const projectLinkIds = links.filter((link) => link.link_type === "project_record").map((link) => link.linked_id);

    const [explicitPlansResult, explicitReportsResult, explicitCampaignsResult, explicitProjectsResult] = await Promise.all([
      planLinkIds.length
        ? detailSupabase
            .from("plans")
            .select("id, project_id, title, plan_type, status, summary, geography_label, horizon_year, updated_at")
            .in("id", planLinkIds)
        : Promise.resolve({ data: [], error: null }),
      reportLinkIds.length
        ? detailSupabase
            .from("reports")
            .select("id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, updated_at")
            .in("id", reportLinkIds)
        : Promise.resolve({ data: [], error: null }),
      campaignLinkIds.length
        ? detailSupabase
            .from("engagement_campaigns")
            .select("id, project_id, title, summary, status, engagement_type, updated_at")
            .in("id", campaignLinkIds)
        : Promise.resolve({ data: [], error: null }),
      projectLinkIds.length
        ? detailSupabase
            .from("projects")
            .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
            .in("id", projectLinkIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["explicit_plans", explicitPlansResult],
      ["explicit_reports", explicitReportsResult],
      ["explicit_campaigns", explicitCampaignsResult],
      ["explicit_projects", explicitProjectsResult],
    ] as const) {
      if (result.error) {
        audit.error("program_explicit_link_lookup_failed", {
          source: name,
          programId: access.program.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load linked records" }, { status: 500 });
      }
    }

    const campaignIds = Array.from(
      new Set([
        ...((projectEngagementResult.data ?? []) as Array<{ id: string }>).map((item) => item.id),
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
        ? detailSupabase.from("engagement_items").select("campaign_id, status").in("campaign_id", campaignIds)
        : Promise.resolve({ data: [], error: null }),
      reportIds.length
        ? detailSupabase.from("report_artifacts").select("report_id").in("report_id", reportIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["engagement_items", engagementItemsResult],
      ["report_artifacts", reportArtifactsResult],
    ] as const) {
      if (result.error) {
        audit.error("program_operational_lookup_failed", {
          source: name,
          programId: access.program.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load record summaries" }, { status: 500 });
      }
    }

    const engagementStatsByCampaign = new Map<string, { approved: number; pending: number }>();
    for (const row of (engagementItemsResult.data ?? []) as Array<{ campaign_id: string; status: string | null }>) {
      const current = engagementStatsByCampaign.get(row.campaign_id) ?? { approved: 0, pending: 0 };
      if (row.status === "approved") current.approved += 1;
      if (row.status === "pending") current.pending += 1;
      engagementStatsByCampaign.set(row.campaign_id, current);
    }

    const artifactCountsByReport = new Map<string, number>();
    for (const row of (reportArtifactsResult.data ?? []) as Array<{ report_id: string }>) {
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
      ((projectEngagementResult.data ?? []) as Array<{
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
      projectResult.data ? [projectResult.data] : [],
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

    const readiness = buildProgramReadiness({
      cycleName: access.program.cycle_name,
      hasProject: linkedProjects.length > 0,
      planCount: linkedPlans.length,
      reportCount: linkedReports.length,
      engagementCampaignCount: linkedCampaigns.length,
      sponsorAgency: access.program.sponsor_agency,
      fiscalYearStart: access.program.fiscal_year_start,
      fiscalYearEnd: access.program.fiscal_year_end,
      nominationDueAt: access.program.nomination_due_at,
      adoptionTargetAt: access.program.adoption_target_at,
    });

    const approvedEngagementItemCount = linkedCampaigns.reduce((sum, item) => sum + item.approvedItemCount, 0);
    const pendingEngagementItemCount = linkedCampaigns.reduce((sum, item) => sum + item.pendingItemCount, 0);
    const generatedReportCount = linkedReports.filter((report) => report.status === "generated").length;

    const workflow = buildProgramWorkflowSummary({
      programStatus: access.program.status,
      readiness,
      planCount: linkedPlans.length,
      reportCount: linkedReports.length,
      generatedReportCount,
      engagementCampaignCount: linkedCampaigns.length,
      approvedEngagementItemCount,
      pendingEngagementItemCount,
    });

    audit.info("program_detail_loaded", {
      userId: user.id,
      programId: access.program.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        program: access.program,
        primaryProject: projectResult.data ?? null,
        links,
        relatedRecords: {
          plans: linkedPlans,
          reports: linkedReports,
          engagementCampaigns: linkedCampaigns,
          projects: linkedProjects,
        },
        readiness,
        workflow,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("program_detail_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading program" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("programs.update", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid program id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchProgramSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const fiscalYearStart = parsed.data.fiscalYearStart;
    const fiscalYearEnd = parsed.data.fiscalYearEnd;
    if (
      typeof fiscalYearStart === "number" &&
      typeof fiscalYearEnd === "number" &&
      fiscalYearEnd < fiscalYearStart
    ) {
      return NextResponse.json({ error: "Fiscal year end must be after fiscal year start" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProgramAccess(supabase, parsedParams.data.programId, user.id, "programs.write");

    if (access.error) {
      audit.error("program_access_failed", {
        programId: parsedParams.data.programId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load program" }, { status: 500 });
    }

    if (!access.program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const detailSupabase = access.supabase as Awaited<ReturnType<typeof createClient>>;
    const projectId = parsed.data.projectId === undefined ? access.program.project_id : parsed.data.projectId;

    if (projectId) {
      const { data: project, error: projectError } = await detailSupabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", projectId)
        .maybeSingle();

      if (projectError) {
        audit.error("program_project_validation_failed", {
          programId: access.program.id,
          projectId,
          message: projectError.message,
          code: projectError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify project" }, { status: 500 });
      }

      if (!project || project.workspace_id !== access.program.workspace_id) {
        return NextResponse.json({ error: "Project is not valid for this workspace" }, { status: 400 });
      }
    }

    let preparedLinks: PreparedProgramLink[] | undefined;
    if (parsed.data.links) {
      const linkValidation = await validateProgramLinks(detailSupabase, access.program.workspace_id, parsed.data.links);

      if ("error" in linkValidation && linkValidation.error) {
        audit.error("program_links_validation_failed", {
          programId: access.program.id,
          message: linkValidation.error.message,
          code: linkValidation.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked records" }, { status: 500 });
      }

      if ("invalid" in linkValidation && linkValidation.invalid) {
        return NextResponse.json({ error: "One or more linked records are invalid" }, { status: 400 });
      }

      preparedLinks = linkValidation.preparedLinks ?? [];
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updatePayload.title = parsed.data.title.trim();
    if (parsed.data.programType !== undefined) updatePayload.program_type = parsed.data.programType;
    if (parsed.data.status !== undefined) updatePayload.status = parsed.data.status;
    if (parsed.data.cycleName !== undefined) updatePayload.cycle_name = parsed.data.cycleName.trim();
    if (parsed.data.projectId !== undefined) updatePayload.project_id = parsed.data.projectId;
    if (parsed.data.sponsorAgency !== undefined) updatePayload.sponsor_agency = parsed.data.sponsorAgency?.trim() || null;
    if (parsed.data.fiscalYearStart !== undefined) updatePayload.fiscal_year_start = parsed.data.fiscalYearStart;
    if (parsed.data.fiscalYearEnd !== undefined) updatePayload.fiscal_year_end = parsed.data.fiscalYearEnd;
    if (parsed.data.nominationDueAt !== undefined) updatePayload.nomination_due_at = parsed.data.nominationDueAt;
    if (parsed.data.adoptionTargetAt !== undefined) updatePayload.adoption_target_at = parsed.data.adoptionTargetAt;
    if (parsed.data.summary !== undefined) updatePayload.summary = parsed.data.summary?.trim() || null;

    const linkReplacement =
      preparedLinks !== undefined
        ? await replaceLinkSet({
            supabase: detailSupabase,
            table: "program_links",
            ownerColumn: "program_id",
            ownerId: access.program.id,
            createdBy: user.id,
            nextLinks: preparedLinks,
          })
        : null;

    if (linkReplacement && !linkReplacement.ok) {
      audit.error(`program_links_${linkReplacement.stage}_failed`, {
        programId: access.program.id,
        message: linkReplacement.error.message,
        code: linkReplacement.error.code ?? null,
        rollbackRestored: linkReplacement.rollback?.ok ?? null,
        rollbackDeleteCode: linkReplacement.rollback?.deleteError?.code ?? null,
        rollbackInsertCode: linkReplacement.rollback?.insertError?.code ?? null,
      });

      return NextResponse.json(
        {
          error:
            linkReplacement.stage === "snapshot"
              ? "Failed to load the current program links"
              : linkReplacement.stage === "delete"
                ? "Failed to refresh linked records"
                : linkReplacement.rollback?.ok
                  ? "Failed to save linked records. Previous links were restored."
                  : "Failed to save linked records and restore the previous link set.",
        },
        { status: 500 }
      );
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await detailSupabase.from("programs").update(updatePayload).eq("id", access.program.id);

      if (updateError) {
        const rollback = linkReplacement?.ok
          ? await restoreLinkSet({
              supabase: detailSupabase,
              table: "program_links",
              ownerColumn: "program_id",
              ownerId: access.program.id,
              createdBy: user.id,
              links: linkReplacement.previousLinks,
            })
          : null;

        audit.error("program_update_failed", {
          programId: access.program.id,
          message: updateError.message,
          code: updateError.code ?? null,
          linksRestored: rollback?.ok ?? null,
          rollbackDeleteCode: rollback?.deleteError?.code ?? null,
          rollbackInsertCode: rollback?.insertError?.code ?? null,
        });
        return NextResponse.json(
          {
            error: rollback
              ? rollback.ok
                ? "Failed to update program. Previous links were restored."
                : "Failed to update program after linked records changed."
              : "Failed to update program",
          },
          { status: 500 }
        );
      }
    }

    audit.info("program_updated", {
      userId: user.id,
      programId: access.program.id,
      durationMs: Date.now() - startedAt,
      updatedFields: Object.keys(updatePayload),
      linkCount: preparedLinks?.length ?? null,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    audit.error("program_update_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating program" }, { status: 500 });
  }
}
