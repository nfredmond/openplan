import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  buildProgramReadiness,
  buildProgramWorkflowSummary,
  PROGRAM_FUNDING_CLASSIFICATION_OPTIONS,
  PROGRAM_LINK_TYPE_OPTIONS,
  PROGRAM_STATUS_OPTIONS,
  PROGRAM_TYPE_OPTIONS,
  type ProgramLinkType,
} from "@/lib/programs/catalog";

const PROGRAM_TYPES = PROGRAM_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PROGRAM_STATUSES = PROGRAM_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PROGRAM_LINK_TYPES = PROGRAM_LINK_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];
const PROGRAM_FUNDING_CLASSIFICATIONS = PROGRAM_FUNDING_CLASSIFICATION_OPTIONS.map((option) => option.value) as [string, ...string[]];

const listProgramsSchema = z.object({
  projectId: z.string().uuid().optional(),
  programType: z.enum(PROGRAM_TYPES).optional(),
  status: z.enum(PROGRAM_STATUSES).optional(),
});

const programLinkInputSchema = z.object({
  linkType: z.enum(PROGRAM_LINK_TYPES),
  linkedId: z.string().uuid(),
  label: z.string().trim().max(160).optional(),
});

const createProgramSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  programType: z.enum(PROGRAM_TYPES),
  status: z.enum(PROGRAM_STATUSES).optional(),
  cycleName: z.string().trim().min(1).max(160),
  fundingClassification: z.enum(PROGRAM_FUNDING_CLASSIFICATIONS).optional(),
  sponsorAgency: z.string().trim().max(160).optional(),
  ownerLabel: z.string().trim().max(160).optional(),
  cadenceLabel: z.string().trim().max(160).optional(),
  fiscalYearStart: z.number().int().min(2000).max(2300).optional(),
  fiscalYearEnd: z.number().int().min(2000).max(2300).optional(),
  nominationDueAt: z.string().datetime().optional(),
  adoptionTargetAt: z.string().datetime().optional(),
  summary: z.string().trim().max(4000).optional(),
  links: z.array(programLinkInputSchema).max(40).optional(),
});

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
      allowed: Boolean(membership && canAccessWorkspaceAction("programs.write", membership.role)),
    };
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, userId);

  if (!membership) {
    return { workspaceId: null, project: null, error: null, allowed: false };
  }

  return {
    workspaceId: membership.workspace_id,
    project: null,
    error: null,
    allowed: canAccessWorkspaceAction("programs.write", membership.role),
  };
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

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("programs.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listProgramsSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      programType: request.nextUrl.searchParams.get("programType") ?? undefined,
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
      .from("programs")
      .select(
        "id, workspace_id, project_id, title, program_type, status, cycle_name, funding_classification, sponsor_agency, owner_label, cadence_label, fiscal_year_start, fiscal_year_end, nomination_due_at, adoption_target_at, summary, created_at, updated_at, projects(id, name)"
      )
      .order("updated_at", { ascending: false });

    if (parsedFilters.data.projectId) {
      query = query.eq("project_id", parsedFilters.data.projectId);
    }

    if (parsedFilters.data.programType) {
      query = query.eq("program_type", parsedFilters.data.programType);
    }

    if (parsedFilters.data.status) {
      query = query.eq("status", parsedFilters.data.status);
    }

    const { data: programsData, error } = await query;

    if (error) {
      audit.error("programs_list_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load programs" }, { status: 500 });
    }

    const programs = programsData ?? [];
    const programIds = programs.map((program) => program.id);
    const projectIds = [
      ...new Set(programs.map((program) => program.project_id).filter((value): value is string => Boolean(value))),
    ];

    const [linksResult, projectPlansResult, projectReportsResult, projectEngagementResult] = await Promise.all([
      programIds.length
        ? supabase.from("program_links").select("id, program_id, link_type, linked_id, label").in("program_id", programIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length ? supabase.from("plans").select("id, project_id").in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? supabase.from("reports").select("id, project_id, status").in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? supabase.from("engagement_campaigns").select("id, project_id").in("project_id", projectIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["program_links", linksResult],
      ["plans", projectPlansResult],
      ["reports", projectReportsResult],
      ["engagement_campaigns", projectEngagementResult],
    ] as const) {
      if (result.error) {
        audit.error("programs_related_lookup_failed", {
          source: name,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load program linkage summary" }, { status: 500 });
      }
    }

    const explicitReportIds = (linksResult.data ?? [])
      .filter((link) => link.link_type === "report")
      .map((link) => link.linked_id);
    const explicitCampaignIds = (linksResult.data ?? [])
      .filter((link) => link.link_type === "engagement_campaign")
      .map((link) => link.linked_id);

    const [explicitReportsResult, reportArtifactsResult, engagementItemsResult] = await Promise.all([
      explicitReportIds.length
        ? supabase.from("reports").select("id, status").in("id", explicitReportIds)
        : Promise.resolve({ data: [], error: null }),
      explicitReportIds.length
        ? supabase.from("report_artifacts").select("report_id").in("report_id", explicitReportIds)
        : Promise.resolve({ data: [], error: null }),
      explicitCampaignIds.length
        ? supabase.from("engagement_items").select("campaign_id, status").in("campaign_id", explicitCampaignIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["explicit_reports", explicitReportsResult],
      ["report_artifacts", reportArtifactsResult],
      ["engagement_items", engagementItemsResult],
    ] as const) {
      if (result.error) {
        audit.error("programs_operational_lookup_failed", {
          source: name,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load program operational summary" }, { status: 500 });
      }
    }

    const linksByProgram = new Map<string, ProgramLinkRow[]>();
    for (const link of (linksResult.data ?? []) as ProgramLinkRow[]) {
      const current = linksByProgram.get(link.program_id) ?? [];
      current.push(link);
      linksByProgram.set(link.program_id, current);
    }

    const planCountsByProject = new Map<string, number>();
    for (const row of projectPlansResult.data ?? []) {
      if (!row.project_id) continue;
      planCountsByProject.set(row.project_id, (planCountsByProject.get(row.project_id) ?? 0) + 1);
    }

    const reportCountsByProject = new Map<string, number>();
    const generatedReportsByProject = new Map<string, number>();
    const projectReportIds = new Set<string>();
    for (const row of projectReportsResult.data ?? []) {
      if (!row.project_id) continue;
      projectReportIds.add(row.id);
      reportCountsByProject.set(row.project_id, (reportCountsByProject.get(row.project_id) ?? 0) + 1);
      if (row.status === "generated") {
        generatedReportsByProject.set(row.project_id, (generatedReportsByProject.get(row.project_id) ?? 0) + 1);
      }
    }

    const engagementCountsByProject = new Map<string, number>();
    for (const row of projectEngagementResult.data ?? []) {
      if (!row.project_id) continue;
      engagementCountsByProject.set(row.project_id, (engagementCountsByProject.get(row.project_id) ?? 0) + 1);
    }

    const explicitGeneratedReports = new Set(
      (explicitReportsResult.data ?? []).filter((row) => row.status === "generated").map((row) => row.id)
    );

    const artifactCountsByReport = new Map<string, number>();
    for (const row of reportArtifactsResult.data ?? []) {
      artifactCountsByReport.set(row.report_id, (artifactCountsByReport.get(row.report_id) ?? 0) + 1);
    }

    const engagementStatsByCampaign = new Map<string, { approved: number; pending: number }>();
    for (const row of engagementItemsResult.data ?? []) {
      const current = engagementStatsByCampaign.get(row.campaign_id) ?? { approved: 0, pending: 0 };
      if (row.status === "approved") current.approved += 1;
      if (row.status === "pending") current.pending += 1;
      engagementStatsByCampaign.set(row.campaign_id, current);
    }

    const typedPrograms = programs.map((program) => {
      const links = linksByProgram.get(program.id) ?? [];
      const explicitPlanCount = links.filter((link) => link.link_type === "plan").length;
      const explicitReportCount = links.filter((link) => link.link_type === "report").length;
      const explicitEngagementCount = links.filter((link) => link.link_type === "engagement_campaign").length;
      const explicitProjectCount = links.filter((link) => link.link_type === "project_record").length;
      const explicitGeneratedReportCount = links.filter(
        (link) => link.link_type === "report" && explicitGeneratedReports.has(link.linked_id)
      ).length;
      const explicitReportArtifactCount = links
        .filter((link) => link.link_type === "report")
        .reduce((sum, link) => sum + (artifactCountsByReport.get(link.linked_id) ?? 0), 0);
      const explicitEngagementStats = links
        .filter((link) => link.link_type === "engagement_campaign")
        .reduce(
          (sum, link) => {
            const stats = engagementStatsByCampaign.get(link.linked_id) ?? { approved: 0, pending: 0 };
            return {
              approved: sum.approved + stats.approved,
              pending: sum.pending + stats.pending,
            };
          },
          { approved: 0, pending: 0 }
        );

      const planCount = explicitPlanCount + (program.project_id ? planCountsByProject.get(program.project_id) ?? 0 : 0);
      const reportCount = explicitReportCount + (program.project_id ? reportCountsByProject.get(program.project_id) ?? 0 : 0);
      const engagementCampaignCount =
        explicitEngagementCount + (program.project_id ? engagementCountsByProject.get(program.project_id) ?? 0 : 0);
      const generatedReportCount =
        explicitGeneratedReportCount + (program.project_id ? generatedReportsByProject.get(program.project_id) ?? 0 : 0);

      const readiness = buildProgramReadiness({
        cycleName: program.cycle_name,
        hasProject: Boolean(program.project_id || explicitProjectCount > 0),
        planCount,
        reportCount,
        engagementCampaignCount,
        sponsorAgency: program.sponsor_agency,
        fiscalYearStart: program.fiscal_year_start,
        fiscalYearEnd: program.fiscal_year_end,
        nominationDueAt: program.nomination_due_at,
        adoptionTargetAt: program.adoption_target_at,
      });

      return {
        ...program,
        readiness,
        linkageCounts: {
          plans: planCount,
          reports: reportCount,
          engagementCampaigns: engagementCampaignCount,
          relatedProjects: explicitProjectCount + (program.project_id ? 1 : 0),
          reportArtifacts: explicitReportArtifactCount,
        },
        workflow: buildProgramWorkflowSummary({
          programStatus: program.status,
          readiness,
          planCount,
          reportCount,
          generatedReportCount,
          engagementCampaignCount,
          approvedEngagementItemCount: explicitEngagementStats.approved,
          pendingEngagementItemCount: explicitEngagementStats.pending,
        }),
      };
    });

    audit.info("programs_list_loaded", {
      userId: user.id,
      count: typedPrograms.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        programs: typedPrograms,
        summary: {
          byStatus: typedPrograms.reduce<Record<string, number>>((acc, program) => {
            acc[program.status] = (acc[program.status] ?? 0) + 1;
            return acc;
          }, {}),
          byType: typedPrograms.reduce<Record<string, number>>((acc, program) => {
            acc[program.program_type] = (acc[program.program_type] ?? 0) + 1;
            return acc;
          }, {}),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("programs_list_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading programs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("programs.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createProgramSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    if (
      typeof parsed.data.fiscalYearStart === "number" &&
      typeof parsed.data.fiscalYearEnd === "number" &&
      parsed.data.fiscalYearEnd < parsed.data.fiscalYearStart
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

    const linkValidation = await validateProgramLinks(supabase, context.workspaceId, parsed.data.links ?? []);

    if ("error" in linkValidation && linkValidation.error) {
      audit.error("program_links_validation_failed", {
        workspaceId: context.workspaceId,
        message: linkValidation.error.message,
        code: linkValidation.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify linked records" }, { status: 500 });
    }

    if ("invalid" in linkValidation && linkValidation.invalid) {
      return NextResponse.json({ error: "One or more linked records are invalid" }, { status: 400 });
    }

    const { data: program, error: insertError } = await supabase
      .from("programs")
      .insert({
        workspace_id: context.workspaceId,
        project_id: parsed.data.projectId ?? null,
        title: parsed.data.title.trim(),
        program_type: parsed.data.programType,
        status: parsed.data.status ?? "draft",
        cycle_name: parsed.data.cycleName.trim(),
        funding_classification: parsed.data.fundingClassification ?? null,
        sponsor_agency: parsed.data.sponsorAgency?.trim() || null,
        owner_label: parsed.data.ownerLabel?.trim() || null,
        cadence_label: parsed.data.cadenceLabel?.trim() || null,
        fiscal_year_start: parsed.data.fiscalYearStart ?? null,
        fiscal_year_end: parsed.data.fiscalYearEnd ?? null,
        nomination_due_at: parsed.data.nominationDueAt ?? null,
        adoption_target_at: parsed.data.adoptionTargetAt ?? null,
        summary: parsed.data.summary?.trim() || null,
        created_by: user.id,
      })
      .select(
        "id, workspace_id, project_id, title, program_type, status, cycle_name, funding_classification, sponsor_agency, owner_label, cadence_label, fiscal_year_start, fiscal_year_end, nomination_due_at, adoption_target_at, summary, created_at, updated_at"
      )
      .single();

    if (insertError || !program) {
      audit.error("program_insert_failed", {
        userId: user.id,
        workspaceId: context.workspaceId,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create program" }, { status: 500 });
    }

    const preparedLinks = linkValidation.preparedLinks ?? [];
    if (preparedLinks.length > 0) {
      const { error: linksError } = await supabase.from("program_links").insert(
        preparedLinks.map((link) => ({
          program_id: program.id,
          ...link,
          created_by: user.id,
        }))
      );

      if (linksError) {
        audit.error("program_links_insert_failed", {
          programId: program.id,
          message: linksError.message,
          code: linksError.code ?? null,
        });
        return NextResponse.json({ error: "Program created but failed to save links" }, { status: 500 });
      }
    }

    audit.info("program_created", {
      userId: user.id,
      programId: program.id,
      workspaceId: context.workspaceId,
      linkCount: preparedLinks.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ programId: program.id, program }, { status: 201 });
  } catch (error) {
    audit.error("program_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating program" }, { status: 500 });
  }
}
