import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  FUNDING_OPPORTUNITY_STATUS_OPTIONS,
  type FundingOpportunityStatus,
} from "@/lib/programs/catalog";

const FUNDING_OPPORTUNITY_STATUSES = FUNDING_OPPORTUNITY_STATUS_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];

const listFundingOpportunitiesSchema = z.object({
  programId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  status: z.enum(FUNDING_OPPORTUNITY_STATUSES).optional(),
});

const createFundingOpportunitySchema = z.object({
  programId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  status: z.enum(FUNDING_OPPORTUNITY_STATUSES).optional(),
  agencyName: z.string().trim().max(160).optional(),
  ownerLabel: z.string().trim().max(160).optional(),
  cadenceLabel: z.string().trim().max(160).optional(),
  opensAt: z.string().datetime().optional(),
  closesAt: z.string().datetime().optional(),
  decisionDueAt: z.string().datetime().optional(),
  summary: z.string().trim().max(4000).optional(),
});

type ProgramRow = {
  id: string;
  workspace_id: string;
  title: string;
};

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
};

type FundingOpportunityRow = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  project_id: string | null;
  title: string;
  opportunity_status: FundingOpportunityStatus;
  agency_name: string | null;
  owner_label: string | null;
  cadence_label: string | null;
  opens_at: string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  summary: string | null;
  updated_at: string;
  created_at: string;
  programs:
    | {
        id: string;
        title: string;
        funding_classification: string | null;
      }
    | Array<{
        id: string;
        title: string;
        funding_classification: string | null;
      }>
    | null;
  projects:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
};

async function resolveWorkspaceContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  options: { programId?: string; projectId?: string }
) {
  let program: ProgramRow | null = null;
  let project: ProjectRow | null = null;

  if (options.programId) {
    const { data, error } = await supabase
      .from("programs")
      .select("id, workspace_id, title")
      .eq("id", options.programId)
      .maybeSingle();

    if (error) {
      return { workspaceId: null, program: null, project: null, error, allowed: false };
    }

    program = (data as ProgramRow | null) ?? null;
    if (!program) {
      return { workspaceId: null, program: null, project: null, error: null, allowed: false };
    }
  }

  if (options.projectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", options.projectId)
      .maybeSingle();

    if (error) {
      return { workspaceId: null, program, project: null, error, allowed: false };
    }

    project = (data as ProjectRow | null) ?? null;
    if (!project) {
      return { workspaceId: null, program, project: null, error: null, allowed: false };
    }
  }

  const workspaceId = program?.workspace_id ?? project?.workspace_id ?? null;
  if (program && project && program.workspace_id !== project.workspace_id) {
    return { workspaceId: null, program, project, error: null, allowed: false, mismatch: true };
  }

  const membershipQuery = supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .limit(1);

  const { data: membership, error: membershipError } = workspaceId
    ? await membershipQuery.eq("workspace_id", workspaceId).maybeSingle()
    : await membershipQuery.maybeSingle();

  if (membershipError) {
    return { workspaceId: null, program, project, error: membershipError, allowed: false };
  }

  if (!membership) {
    return { workspaceId: null, program, project, error: null, allowed: false };
  }

  return {
    workspaceId: workspaceId ?? membership.workspace_id,
    program,
    project,
    error: null,
    allowed: canAccessWorkspaceAction("programs.write", membership.role),
  };
}

function normalizeJoinedRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function getOpportunityPriority(status: string) {
  switch (status) {
    case "open":
      return 0;
    case "upcoming":
      return 1;
    case "closed":
      return 2;
    case "awarded":
      return 3;
    default:
      return 4;
  }
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("funding-opportunities.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listFundingOpportunitiesSchema.safeParse({
      programId: request.nextUrl.searchParams.get("programId") ?? undefined,
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
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
      .from("funding_opportunities")
      .select(
        "id, workspace_id, program_id, project_id, title, opportunity_status, agency_name, owner_label, cadence_label, opens_at, closes_at, decision_due_at, summary, created_at, updated_at, programs(id, title, funding_classification), projects(id, name)"
      )
      .order("updated_at", { ascending: false });

    if (parsedFilters.data.programId) {
      query = query.eq("program_id", parsedFilters.data.programId);
    }

    if (parsedFilters.data.projectId) {
      query = query.eq("project_id", parsedFilters.data.projectId);
    }

    if (parsedFilters.data.status) {
      query = query.eq("opportunity_status", parsedFilters.data.status);
    }

    const { data, error } = await query;
    if (error) {
      audit.error("funding_opportunities_list_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load funding opportunities" }, { status: 500 });
    }

    const opportunities = ((data ?? []) as FundingOpportunityRow[])
      .map((row) => ({
        ...row,
        program: normalizeJoinedRecord(row.programs),
        project: normalizeJoinedRecord(row.projects),
      }))
      .sort((left, right) => {
        const priorityDelta = getOpportunityPriority(left.opportunity_status) - getOpportunityPriority(right.opportunity_status);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        const leftDate = new Date(left.closes_at ?? left.opens_at ?? left.updated_at).getTime();
        const rightDate = new Date(right.closes_at ?? right.opens_at ?? right.updated_at).getTime();
        return leftDate - rightDate;
      });

    const summary = {
      byStatus: opportunities.reduce<Record<string, number>>((accumulator, item) => {
        accumulator[item.opportunity_status] = (accumulator[item.opportunity_status] ?? 0) + 1;
        return accumulator;
      }, {}),
      openCount: opportunities.filter((item) => item.opportunity_status === "open").length,
      upcomingCount: opportunities.filter((item) => item.opportunity_status === "upcoming").length,
    };

    audit.info("funding_opportunities_listed", {
      userId: user.id,
      opportunityCount: opportunities.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ opportunities, summary });
  } catch (error) {
    audit.error("funding_opportunities_list_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while loading funding opportunities" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("funding-opportunities.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json();
    const parsed = createFundingOpportunitySchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid funding opportunity payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const context = await resolveWorkspaceContext(supabase, user.id, {
      programId: parsed.data.programId,
      projectId: parsed.data.projectId,
    });

    if (context.error) {
      audit.error("funding_opportunity_context_failed", {
        userId: user.id,
        message: context.error.message,
        code: context.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if ((parsed.data.programId && !context.program) || (parsed.data.projectId && !context.project)) {
      return NextResponse.json({ error: "Linked program or project not found" }, { status: 404 });
    }

    if ("mismatch" in context && context.mismatch) {
      return NextResponse.json({ error: "Program and project must belong to the same workspace" }, { status: 400 });
    }

    if (!context.workspaceId || !context.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: opportunity, error } = await supabase
      .from("funding_opportunities")
      .insert({
        workspace_id: context.workspaceId,
        program_id: parsed.data.programId ?? null,
        project_id: parsed.data.projectId ?? null,
        title: parsed.data.title.trim(),
        opportunity_status: parsed.data.status ?? "upcoming",
        agency_name: parsed.data.agencyName?.trim() || null,
        owner_label: parsed.data.ownerLabel?.trim() || null,
        cadence_label: parsed.data.cadenceLabel?.trim() || null,
        opens_at: parsed.data.opensAt ?? null,
        closes_at: parsed.data.closesAt ?? null,
        decision_due_at: parsed.data.decisionDueAt ?? null,
        summary: parsed.data.summary?.trim() || null,
        created_by: user.id,
      })
      .select(
        "id, workspace_id, program_id, project_id, title, opportunity_status, agency_name, owner_label, cadence_label, opens_at, closes_at, decision_due_at, summary, created_at, updated_at"
      )
      .single();

    if (error || !opportunity) {
      audit.error("funding_opportunity_insert_failed", {
        userId: user.id,
        workspaceId: context.workspaceId,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create funding opportunity" }, { status: 500 });
    }

    audit.info("funding_opportunity_created", {
      userId: user.id,
      opportunityId: opportunity.id,
      workspaceId: context.workspaceId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ opportunityId: opportunity.id, opportunity }, { status: 201 });
  } catch (error) {
    audit.error("funding_opportunity_create_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while creating funding opportunity" }, { status: 500 });
  }
}
