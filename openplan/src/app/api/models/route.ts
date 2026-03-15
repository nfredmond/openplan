import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  buildModelReadiness,
  buildModelWorkflowSummary,
  MODEL_FAMILY_OPTIONS,
  MODEL_LINK_TYPE_OPTIONS,
  MODEL_STATUS_OPTIONS,
  type ModelLinkType,
} from "@/lib/models/catalog";

const MODEL_FAMILIES = MODEL_FAMILY_OPTIONS.map((option) => option.value) as [string, ...string[]];
const MODEL_STATUSES = MODEL_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];
const MODEL_LINK_TYPES = MODEL_LINK_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];

const listModelsSchema = z.object({
  projectId: z.string().uuid().optional(),
  scenarioSetId: z.string().uuid().optional(),
  modelFamily: z.enum(MODEL_FAMILIES).optional(),
  status: z.enum(MODEL_STATUSES).optional(),
});

const modelLinkInputSchema = z.object({
  linkType: z.enum(MODEL_LINK_TYPES),
  linkedId: z.string().uuid(),
  label: z.string().trim().max(160).optional(),
});

const createModelSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    scenarioSetId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    modelFamily: z.enum(MODEL_FAMILIES),
    status: z.enum(MODEL_STATUSES).optional(),
    configVersion: z.string().trim().max(120).optional(),
    ownerLabel: z.string().trim().max(160).optional(),
    horizonLabel: z.string().trim().max(160).optional(),
    assumptionsSummary: z.string().trim().max(4000).optional(),
    inputSummary: z.string().trim().max(4000).optional(),
    outputSummary: z.string().trim().max(4000).optional(),
    summary: z.string().trim().max(4000).optional(),
    configJson: z.record(z.string(), z.unknown()).optional(),
    lastValidatedAt: z.string().datetime().optional(),
    lastRunRecordedAt: z.string().datetime().optional(),
    links: z.array(modelLinkInputSchema).max(60).optional(),
  })
  .refine((value) => Boolean(value.projectId || value.scenarioSetId), {
    message: "A primary project or scenario set is required",
    path: ["projectId"],
  });

type LinkInput = z.infer<typeof modelLinkInputSchema>;

type LinkTargetRow = {
  id: string;
  workspace_id: string;
  title?: string | null;
  name?: string | null;
};

type PreparedModelLink = {
  link_type: ModelLinkType;
  linked_id: string;
  label: string | null;
};

type ModelLinkRow = {
  model_id: string;
  link_type: ModelLinkType;
  linked_id: string;
};

type WorkspaceContextResult = {
  workspaceId: string | null;
  projectId: string | null;
  scenarioSetId: string | null;
  error: { message: string; code?: string | null } | null;
  allowed: boolean;
  missing?: "project" | "scenario_set";
};

const LINK_TARGET_CONFIG: Record<ModelLinkType, { table: string; select: string; labelField: "title" | "name" }> = {
  scenario_set: {
    table: "scenario_sets",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  report: {
    table: "reports",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  data_dataset: {
    table: "data_datasets",
    select: "id, workspace_id, name",
    labelField: "name",
  },
  plan: {
    table: "plans",
    select: "id, workspace_id, title",
    labelField: "title",
  },
  project_record: {
    table: "projects",
    select: "id, workspace_id, name",
    labelField: "name",
  },
  run: {
    table: "runs",
    select: "id, workspace_id, title",
    labelField: "title",
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
  projectId?: string,
  scenarioSetId?: string
): Promise<WorkspaceContextResult> {
  if (projectId) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      return { workspaceId: null, projectId: null, scenarioSetId: null, error: projectError, allowed: false };
    }

    if (!project) {
      return { workspaceId: null, projectId: null, scenarioSetId: null, error: null, allowed: false, missing: "project" };
    }

    if (scenarioSetId) {
      const { data: scenarioSet, error: scenarioSetError } = await supabase
        .from("scenario_sets")
        .select("id, workspace_id, project_id")
        .eq("id", scenarioSetId)
        .maybeSingle();

      if (scenarioSetError) {
        return { workspaceId: null, projectId: null, scenarioSetId: null, error: scenarioSetError, allowed: false };
      }

      if (!scenarioSet) {
        return { workspaceId: null, projectId: project.id, scenarioSetId: null, error: null, allowed: false, missing: "scenario_set" };
      }

      if (scenarioSet.workspace_id !== project.workspace_id) {
        return {
          workspaceId: null,
          projectId: project.id,
          scenarioSetId: scenarioSet.id,
          error: { message: "Scenario set belongs to a different workspace" },
          allowed: false,
        };
      }
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", project.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      return { workspaceId: null, projectId: project.id, scenarioSetId: scenarioSetId ?? null, error: membershipError, allowed: false };
    }

    return {
      workspaceId: project.workspace_id,
      projectId: project.id,
      scenarioSetId: scenarioSetId ?? null,
      error: null,
      allowed: Boolean(membership && canAccessWorkspaceAction("models.write", membership.role)),
    };
  }

  if (scenarioSetId) {
    const { data: scenarioSet, error: scenarioSetError } = await supabase
      .from("scenario_sets")
      .select("id, workspace_id, project_id")
      .eq("id", scenarioSetId)
      .maybeSingle();

    if (scenarioSetError) {
      return { workspaceId: null, projectId: null, scenarioSetId: null, error: scenarioSetError, allowed: false };
    }

    if (!scenarioSet) {
      return { workspaceId: null, projectId: null, scenarioSetId: null, error: null, allowed: false, missing: "scenario_set" };
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", scenarioSet.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      return {
        workspaceId: null,
        projectId: scenarioSet.project_id,
        scenarioSetId: scenarioSet.id,
        error: membershipError,
        allowed: false,
      };
    }

    return {
      workspaceId: scenarioSet.workspace_id,
      projectId: scenarioSet.project_id,
      scenarioSetId: scenarioSet.id,
      error: null,
      allowed: Boolean(membership && canAccessWorkspaceAction("models.write", membership.role)),
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return { workspaceId: null, projectId: null, scenarioSetId: null, error: membershipError, allowed: false };
  }

  if (!membership) {
    return { workspaceId: null, projectId: null, scenarioSetId: null, error: null, allowed: false };
  }

  return {
    workspaceId: membership.workspace_id,
    projectId: null,
    scenarioSetId: null,
    error: null,
    allowed: canAccessWorkspaceAction("models.write", membership.role),
  };
}

async function validateModelLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  links: LinkInput[]
) {
  const dedupedLinks = dedupeLinks(links);

  if (dedupedLinks.length === 0) {
    return { preparedLinks: [] as PreparedModelLink[] };
  }

  const labels = new Map<string, string | null>();

  for (const linkType of MODEL_LINK_TYPES) {
    const linksForType = dedupedLinks.filter((link) => link.linkType === linkType);
    if (linksForType.length === 0) continue;

    const config = LINK_TARGET_CONFIG[linkType as ModelLinkType];
    const ids = linksForType.map((link) => link.linkedId);

    const { data, error } = await supabase.from(config.table).select(config.select).eq("workspace_id", workspaceId).in("id", ids);

    if (error) {
      return { error, preparedLinks: null };
    }

    const rows = (data ?? []) as unknown as LinkTargetRow[];
    if (rows.length !== new Set(ids).size) {
      return { invalid: true, preparedLinks: null as PreparedModelLink[] | null };
    }

    for (const row of rows) {
      labels.set(`${linkType}:${row.id}`, row[config.labelField] ?? null);
    }
  }

  return {
    preparedLinks: dedupedLinks.map((link) => ({
      link_type: link.linkType as ModelLinkType,
      linked_id: link.linkedId,
      label: link.label?.trim() || labels.get(`${link.linkType}:${link.linkedId}`) || null,
    })),
  };
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("models.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listModelsSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      scenarioSetId: request.nextUrl.searchParams.get("scenarioSetId") ?? undefined,
      modelFamily: request.nextUrl.searchParams.get("modelFamily") ?? undefined,
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
      .from("models")
      .select(
        "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at, created_at, updated_at, projects(id, name), scenario_sets(id, title)"
      )
      .order("updated_at", { ascending: false });

    if (parsedFilters.data.projectId) {
      query = query.eq("project_id", parsedFilters.data.projectId);
    }

    if (parsedFilters.data.scenarioSetId) {
      query = query.eq("scenario_set_id", parsedFilters.data.scenarioSetId);
    }

    if (parsedFilters.data.modelFamily) {
      query = query.eq("model_family", parsedFilters.data.modelFamily);
    }

    if (parsedFilters.data.status) {
      query = query.eq("status", parsedFilters.data.status);
    }

    const { data: modelsData, error } = await query;

    if (error) {
      audit.error("models_list_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load models" }, { status: 500 });
    }

    const models = modelsData ?? [];
    const modelIds = models.map((model) => model.id);
    const linksResult = modelIds.length
      ? await supabase.from("model_links").select("model_id, link_type, linked_id").in("model_id", modelIds)
      : { data: [], error: null };

    if (linksResult.error) {
      audit.error("model_links_list_failed", { message: linksResult.error.message, code: linksResult.error.code ?? null });
      return NextResponse.json({ error: "Failed to load model links" }, { status: 500 });
    }

    const linksByModel = new Map<string, ModelLinkRow[]>();
    for (const link of (linksResult.data ?? []) as ModelLinkRow[]) {
      const current = linksByModel.get(link.model_id) ?? [];
      current.push(link);
      linksByModel.set(link.model_id, current);
    }

    const catalog = models.map((model) => {
      const links = linksByModel.get(model.id) ?? [];
      const linkedScenarioCount = links.filter((link) => link.link_type === "scenario_set").length + (model.scenario_set_id ? 1 : 0);
      const linkedDatasetCount = links.filter((link) => link.link_type === "data_dataset").length;
      const linkedReportCount = links.filter((link) => link.link_type === "report").length;
      const linkedRunCount = links.filter((link) => link.link_type === "run").length;
      const linkedPlanCount = links.filter((link) => link.link_type === "plan").length;
      const linkedProjectCount = links.filter((link) => link.link_type === "project_record").length + (model.project_id ? 1 : 0);
      const readiness = buildModelReadiness({
        hasProject: Boolean(model.project_id),
        hasScenario: linkedScenarioCount > 0,
        configVersion: model.config_version,
        ownerLabel: model.owner_label,
        assumptionsSummary: model.assumptions_summary,
        inputDatasetCount: linkedDatasetCount,
        inputSummary: model.input_summary,
        outputReportCount: linkedReportCount,
        outputRunCount: linkedRunCount,
        outputSummary: model.output_summary,
        lastValidatedAt: model.last_validated_at,
      });

      return {
        ...model,
        readiness,
        workflow: buildModelWorkflowSummary({
          modelStatus: model.status,
          readiness,
          linkedScenarioCount,
          linkedDatasetCount,
          linkedRunCount,
          linkedReportCount,
          lastRunRecordedAt: model.last_run_recorded_at,
        }),
        linkageCounts: {
          scenarios: linkedScenarioCount,
          datasets: linkedDatasetCount,
          reports: linkedReportCount,
          runs: linkedRunCount,
          plans: linkedPlanCount,
          projects: linkedProjectCount,
        },
      };
    });

    audit.info("models_list_loaded", {
      userId: user.id,
      count: catalog.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ models: catalog }, { status: 200 });
  } catch (error) {
    audit.error("models_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading models" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("models.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createModelSchema.safeParse(payload);

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

    const workspaceContext = await resolveWorkspaceContext(
      supabase,
      user.id,
      parsed.data.projectId,
      parsed.data.scenarioSetId
    );

    if (workspaceContext.error) {
      audit.error("workspace_context_failed", {
        message: workspaceContext.error.message,
        code: workspaceContext.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify model context" }, { status: 500 });
    }

    if (workspaceContext.missing === "project") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (workspaceContext.missing === "scenario_set") {
      return NextResponse.json({ error: "Scenario set not found" }, { status: 404 });
    }

    if (!workspaceContext.workspaceId) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!workspaceContext.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const validatedLinks = await validateModelLinks(supabase, workspaceContext.workspaceId, parsed.data.links ?? []);

    if ("error" in validatedLinks && validatedLinks.error) {
      audit.error("model_link_validation_failed", {
        message: validatedLinks.error.message,
        code: validatedLinks.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to validate linked records" }, { status: 500 });
    }

    if ("invalid" in validatedLinks && validatedLinks.invalid) {
      return NextResponse.json({ error: "One or more linked records are invalid for this workspace" }, { status: 400 });
    }

    const { data: model, error: insertError } = await supabase
      .from("models")
      .insert({
        workspace_id: workspaceContext.workspaceId,
        project_id: workspaceContext.projectId,
        scenario_set_id: workspaceContext.scenarioSetId,
        title: parsed.data.title.trim(),
        model_family: parsed.data.modelFamily,
        status: parsed.data.status ?? "draft",
        config_version: parsed.data.configVersion?.trim() || null,
        owner_label: parsed.data.ownerLabel?.trim() || null,
        horizon_label: parsed.data.horizonLabel?.trim() || null,
        assumptions_summary: parsed.data.assumptionsSummary?.trim() || null,
        input_summary: parsed.data.inputSummary?.trim() || null,
        output_summary: parsed.data.outputSummary?.trim() || null,
        summary: parsed.data.summary?.trim() || null,
        config_json: parsed.data.configJson ?? {},
        last_validated_at: parsed.data.lastValidatedAt ?? null,
        last_run_recorded_at: parsed.data.lastRunRecordedAt ?? null,
        created_by: user.id,
      })
      .select(
        "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at, created_at, updated_at"
      )
      .single();

    if (insertError || !model) {
      audit.error("model_insert_failed", {
        workspaceId: workspaceContext.workspaceId,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create model" }, { status: 500 });
    }

    const preparedLinks = validatedLinks.preparedLinks ?? [];

    if (preparedLinks.length > 0) {
      const { error: linkInsertError } = await supabase.from("model_links").insert(
        preparedLinks.map((link) => ({
          model_id: model.id,
          ...link,
          created_by: user.id,
        }))
      );

      if (linkInsertError) {
        audit.error("model_links_insert_failed", {
          modelId: model.id,
          message: linkInsertError.message,
          code: linkInsertError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to create model links" }, { status: 500 });
      }
    }

    audit.info("model_created", {
      userId: user.id,
      workspaceId: workspaceContext.workspaceId,
      modelId: model.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ modelId: model.id, model }, { status: 201 });
  } catch (error) {
    audit.error("models_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating model" }, { status: 500 });
  }
}
