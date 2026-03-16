import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import { replaceLinkSet, restoreLinkSet } from "@/lib/api/link-replacement";
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

const paramsSchema = z.object({
  modelId: z.string().uuid(),
});

const modelLinkInputSchema = z.object({
  linkType: z.enum(MODEL_LINK_TYPES),
  linkedId: z.string().uuid(),
  label: z.string().trim().max(160).optional(),
});

const patchModelSchema = z
  .object({
    projectId: z.union([z.string().uuid(), z.null()]).optional(),
    scenarioSetId: z.union([z.string().uuid(), z.null()]).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    modelFamily: z.enum(MODEL_FAMILIES).optional(),
    status: z.enum(MODEL_STATUSES).optional(),
    configVersion: z.union([z.string().trim().max(120), z.null()]).optional(),
    ownerLabel: z.union([z.string().trim().max(160), z.null()]).optional(),
    horizonLabel: z.union([z.string().trim().max(160), z.null()]).optional(),
    assumptionsSummary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    inputSummary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    outputSummary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    summary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    configJson: z.record(z.string(), z.unknown()).optional(),
    lastValidatedAt: z.union([z.string().datetime(), z.null()]).optional(),
    lastRunRecordedAt: z.union([z.string().datetime(), z.null()]).optional(),
    links: z.array(modelLinkInputSchema).max(60).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ modelId: string }>;
};

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
  id: string;
  model_id: string;
  link_type: ModelLinkType;
  linked_id: string;
  label: string | null;
};

const LINK_TARGET_CONFIG: Record<ModelLinkType, { table: string; select: string; labelField: "title" | "name" }> = {
  scenario_set: {
    table: "scenario_sets",
    select: "id, workspace_id, title, status, planning_question, updated_at",
    labelField: "title",
  },
  report: {
    table: "reports",
    select: "id, workspace_id, project_id, title, report_type, status, generated_at, updated_at",
    labelField: "title",
  },
  data_dataset: {
    table: "data_datasets",
    select: "id, workspace_id, name, status, vintage_label, geometry_scope, updated_at",
    labelField: "name",
  },
  plan: {
    table: "plans",
    select: "id, workspace_id, project_id, title, plan_type, status, updated_at",
    labelField: "title",
  },
  project_record: {
    table: "projects",
    select: "id, workspace_id, name, status, delivery_phase, updated_at",
    labelField: "name",
  },
  run: {
    table: "runs",
    select: "id, workspace_id, title, created_at",
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

async function resolveAnchors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  projectId: string | null,
  scenarioSetId: string | null
) {
  if (!projectId && !scenarioSetId) {
    return { invalid: true as const, reason: "A project or scenario set is required" };
  }

  if (projectId) {
    const { data: project, error } = await supabase
      .from("projects")
      .select("id, workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .maybeSingle();

    if (error) return { error };
    if (!project) return { invalid: true as const, reason: "Project not found in this workspace" };
  }

  if (scenarioSetId) {
    const { data: scenarioSet, error } = await supabase
      .from("scenario_sets")
      .select("id, workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("id", scenarioSetId)
      .maybeSingle();

    if (error) return { error };
    if (!scenarioSet) return { invalid: true as const, reason: "Scenario set not found in this workspace" };
  }

  return { invalid: false as const };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("models.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid model id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadModelAccess(supabase, parsedParams.data.modelId, user.id, "models.read");

    if (access.error) {
      audit.error("model_access_failed", {
        modelId: parsedParams.data.modelId,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
    }

    if (!access.model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const detailSupabase = access.supabase as Awaited<ReturnType<typeof createClient>>;

    const [projectResult, scenarioResult, linksResult] = await Promise.all([
      access.model.project_id
        ? detailSupabase
            .from("projects")
            .select("id, workspace_id, name, summary, status, delivery_phase, updated_at")
            .eq("id", access.model.project_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      access.model.scenario_set_id
        ? detailSupabase
            .from("scenario_sets")
            .select("id, workspace_id, project_id, title, summary, planning_question, status, updated_at")
            .eq("id", access.model.scenario_set_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      detailSupabase.from("model_links").select("id, model_id, link_type, linked_id, label").eq("model_id", access.model.id),
    ]);

    for (const [name, result] of [
      ["project", projectResult],
      ["scenario", scenarioResult],
      ["model_links", linksResult],
    ] as const) {
      if (result.error) {
        audit.error("model_related_lookup_failed", {
          source: name,
          modelId: access.model.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load model detail" }, { status: 500 });
      }
    }

    const links = (linksResult.data ?? []) as ModelLinkRow[];
    const grouped = {
      scenario_set: links.filter((link) => link.link_type === "scenario_set").map((link) => link.linked_id),
      report: links.filter((link) => link.link_type === "report").map((link) => link.linked_id),
      data_dataset: links.filter((link) => link.link_type === "data_dataset").map((link) => link.linked_id),
      plan: links.filter((link) => link.link_type === "plan").map((link) => link.linked_id),
      project_record: links.filter((link) => link.link_type === "project_record").map((link) => link.linked_id),
      run: links.filter((link) => link.link_type === "run").map((link) => link.linked_id),
    };

    const [linkedScenarios, linkedReports, linkedDatasets, linkedPlans, linkedProjects, linkedRuns] = await Promise.all([
      grouped.scenario_set.length
        ? detailSupabase
            .from("scenario_sets")
            .select("id, workspace_id, project_id, title, summary, planning_question, status, updated_at")
            .in("id", grouped.scenario_set)
        : Promise.resolve({ data: [], error: null }),
      grouped.report.length
        ? detailSupabase
            .from("reports")
            .select("id, workspace_id, project_id, title, report_type, status, generated_at, updated_at")
            .in("id", grouped.report)
        : Promise.resolve({ data: [], error: null }),
      grouped.data_dataset.length
        ? detailSupabase
            .from("data_datasets")
            .select("id, workspace_id, name, status, vintage_label, geometry_scope, updated_at")
            .in("id", grouped.data_dataset)
        : Promise.resolve({ data: [], error: null }),
      grouped.plan.length
        ? detailSupabase
            .from("plans")
            .select("id, workspace_id, project_id, title, plan_type, status, updated_at")
            .in("id", grouped.plan)
        : Promise.resolve({ data: [], error: null }),
      grouped.project_record.length
        ? detailSupabase
            .from("projects")
            .select("id, workspace_id, name, status, delivery_phase, updated_at")
            .in("id", grouped.project_record)
        : Promise.resolve({ data: [], error: null }),
      grouped.run.length
        ? detailSupabase
            .from("runs")
            .select("id, workspace_id, title, created_at")
            .in("id", grouped.run)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [name, result] of [
      ["linked_scenarios", linkedScenarios],
      ["linked_reports", linkedReports],
      ["linked_datasets", linkedDatasets],
      ["linked_plans", linkedPlans],
      ["linked_projects", linkedProjects],
      ["linked_runs", linkedRuns],
    ] as const) {
      if (result.error) {
        audit.error("model_explicit_link_lookup_failed", {
          source: name,
          modelId: access.model.id,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load linked model records" }, { status: 500 });
      }
    }

    const linkedScenarioCount = (linkedScenarios.data?.length ?? 0) + (access.model.scenario_set_id ? 1 : 0);
    const linkedDatasetCount = linkedDatasets.data?.length ?? 0;
    const linkedReportCount = linkedReports.data?.length ?? 0;
    const linkedRunCount = linkedRuns.data?.length ?? 0;

    const readiness = buildModelReadiness({
      hasProject: Boolean(access.model.project_id),
      hasScenario: linkedScenarioCount > 0,
      configVersion: access.model.config_version,
      ownerLabel: access.model.owner_label,
      assumptionsSummary: access.model.assumptions_summary,
      inputDatasetCount: linkedDatasetCount,
      inputSummary: access.model.input_summary,
      outputReportCount: linkedReportCount,
      outputRunCount: linkedRunCount,
      outputSummary: access.model.output_summary,
      lastValidatedAt: access.model.last_validated_at,
    });

    return NextResponse.json(
      {
        model: access.model,
        project: projectResult.data,
        scenarioSet: scenarioResult.data,
        readiness,
        workflow: buildModelWorkflowSummary({
          modelStatus: access.model.status,
          readiness,
          linkedScenarioCount,
          linkedDatasetCount,
          linkedRunCount,
          linkedReportCount,
          lastRunRecordedAt: access.model.last_run_recorded_at,
        }),
        links: {
          scenarios: linkedScenarios.data ?? [],
          reports: linkedReports.data ?? [],
          datasets: linkedDatasets.data ?? [],
          plans: linkedPlans.data ?? [],
          projects: linkedProjects.data ?? [],
          runs: linkedRuns.data ?? [],
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("models_detail_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading model" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("models.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid model id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchModelSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid model update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadModelAccess(supabase, parsedParams.data.modelId, user.id, "models.write");

    if (access.error) {
      audit.error("model_access_failed", {
        modelId: parsedParams.data.modelId,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify model access" }, { status: 500 });
    }

    if (!access.model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const workspaceId = access.model.workspace_id;
    const nextProjectId = parsed.data.projectId === undefined ? access.model.project_id : parsed.data.projectId;
    const nextScenarioSetId = parsed.data.scenarioSetId === undefined ? access.model.scenario_set_id : parsed.data.scenarioSetId;
    const anchorResolution = await resolveAnchors(supabase, workspaceId, nextProjectId, nextScenarioSetId);

    if ("error" in anchorResolution && anchorResolution.error) {
      audit.error("model_anchor_validation_failed", {
        modelId: access.model.id,
        message: anchorResolution.error.message,
        code: anchorResolution.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to validate linked project or scenario set" }, { status: 500 });
    }

    if ("invalid" in anchorResolution && anchorResolution.invalid) {
      return NextResponse.json({ error: anchorResolution.reason }, { status: 400 });
    }

    let preparedLinks: PreparedModelLink[] | undefined;
    if (parsed.data.links !== undefined) {
      const validatedLinks = await validateModelLinks(supabase, workspaceId, parsed.data.links);

      if ("error" in validatedLinks && validatedLinks.error) {
        audit.error("model_link_validation_failed", {
          modelId: access.model.id,
          message: validatedLinks.error.message,
          code: validatedLinks.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to validate linked records" }, { status: 500 });
      }

      if ("invalid" in validatedLinks && validatedLinks.invalid) {
        return NextResponse.json({ error: "One or more linked records are invalid for this workspace" }, { status: 400 });
      }

      preparedLinks = validatedLinks.preparedLinks ?? [];
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.projectId !== undefined) updatePayload.project_id = parsed.data.projectId;
    if (parsed.data.scenarioSetId !== undefined) updatePayload.scenario_set_id = parsed.data.scenarioSetId;
    if (parsed.data.title !== undefined) updatePayload.title = parsed.data.title.trim();
    if (parsed.data.modelFamily !== undefined) updatePayload.model_family = parsed.data.modelFamily;
    if (parsed.data.status !== undefined) updatePayload.status = parsed.data.status;
    if (parsed.data.configVersion !== undefined) updatePayload.config_version = parsed.data.configVersion?.trim() || null;
    if (parsed.data.ownerLabel !== undefined) updatePayload.owner_label = parsed.data.ownerLabel?.trim() || null;
    if (parsed.data.horizonLabel !== undefined) updatePayload.horizon_label = parsed.data.horizonLabel?.trim() || null;
    if (parsed.data.assumptionsSummary !== undefined) updatePayload.assumptions_summary = parsed.data.assumptionsSummary?.trim() || null;
    if (parsed.data.inputSummary !== undefined) updatePayload.input_summary = parsed.data.inputSummary?.trim() || null;
    if (parsed.data.outputSummary !== undefined) updatePayload.output_summary = parsed.data.outputSummary?.trim() || null;
    if (parsed.data.summary !== undefined) updatePayload.summary = parsed.data.summary?.trim() || null;
    if (parsed.data.configJson !== undefined) updatePayload.config_json = parsed.data.configJson;
    if (parsed.data.lastValidatedAt !== undefined) updatePayload.last_validated_at = parsed.data.lastValidatedAt;
    if (parsed.data.lastRunRecordedAt !== undefined) updatePayload.last_run_recorded_at = parsed.data.lastRunRecordedAt;

    const linkReplacement =
      preparedLinks !== undefined
        ? await replaceLinkSet({
            supabase,
            table: "model_links",
            ownerColumn: "model_id",
            ownerId: access.model.id,
            createdBy: user.id,
            nextLinks: preparedLinks,
          })
        : null;

    if (linkReplacement && !linkReplacement.ok) {
      audit.error(`model_links_${linkReplacement.stage}_failed`, {
        modelId: access.model.id,
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
              ? "Failed to load the current model links"
              : linkReplacement.stage === "delete"
                ? "Failed to refresh model links"
                : linkReplacement.rollback?.ok
                  ? "Failed to save model links. Previous links were restored."
                  : "Failed to save model links and restore the previous link set.",
        },
        { status: 500 }
      );
    }

    const { data: model, error: updateError } = await supabase
      .from("models")
      .update(updatePayload)
      .eq("id", access.model.id)
      .select(
        "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at, created_at, updated_at"
      )
      .single();

    if (updateError || !model) {
      const rollback = linkReplacement?.ok
        ? await restoreLinkSet({
            supabase,
            table: "model_links",
            ownerColumn: "model_id",
            ownerId: access.model.id,
            createdBy: user.id,
            links: linkReplacement.previousLinks,
          })
        : null;

      audit.error("model_update_failed", {
        modelId: access.model.id,
        message: updateError?.message ?? "unknown",
        code: updateError?.code ?? null,
        linksRestored: rollback?.ok ?? null,
        rollbackDeleteCode: rollback?.deleteError?.code ?? null,
        rollbackInsertCode: rollback?.insertError?.code ?? null,
      });
      return NextResponse.json(
        {
          error: rollback
            ? rollback.ok
              ? "Failed to update model metadata. Previous links were restored."
              : "Failed to update model after links changed."
            : "Failed to update model",
        },
        { status: 500 }
      );
    }

    audit.info("model_updated", {
      userId: user.id,
      modelId: access.model.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ model }, { status: 200 });
  } catch (error) {
    audit.error("models_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating model" }, { status: 500 });
  }
}
