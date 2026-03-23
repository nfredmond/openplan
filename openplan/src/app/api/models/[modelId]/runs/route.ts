import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import {
  buildModelRunResultSummary,
  corridorGeojsonSchema,
  extractModelLaunchTemplate,
  looksLikePendingSchema,
  mergeScenarioLaunchPayload,
} from "@/lib/models/run-launch";
import { buildManagedRunLaunchPlan, buildManagedRunManifest } from "@/lib/models/orchestration";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
});

const launchModelRunSchema = z.object({
  scenarioEntryId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  queryText: z.string().trim().min(1).max(5000).optional(),
  corridorGeojson: corridorGeojsonSchema.optional(),
  attachToScenarioEntry: z.boolean().optional(),
  engineKey: z.enum(["deterministic_corridor_v1", "aequilibrae", "activitysim"]).optional().default("deterministic_corridor_v1"),
});

type RouteContext = {
  params: Promise<{ modelId: string }>;
};

type ScenarioEntryRow = {
  id: string;
  scenario_set_id: string;
  label: string;
  entry_type: string;
  status: string;
  assumptions_json: Record<string, unknown> | null;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.list", request);
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
      return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
    }
    if (!access.model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("model_runs")
      .select(
        "id, model_id, scenario_set_id, scenario_entry_id, source_analysis_run_id, engine_key, launch_source, status, run_title, query_text, result_summary_json, error_message, started_at, completed_at, created_at"
      )
      .eq("model_id", access.model.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json({ modelRuns: [], schemaPending: true }, { status: 200 });
      }
      audit.error("model_runs_list_failed", {
        modelId: access.model.id,
        userId: user.id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load model runs" }, { status: 500 });
    }

    return NextResponse.json({ modelRuns: data ?? [], schemaPending: false }, { status: 200 });
  } catch (error) {
    audit.error("model_runs_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading model runs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.launch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid model id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = launchModelRunSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid model run launch payload" }, { status: 400 });
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
        userId: user.id,
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

    let scenarioEntry: ScenarioEntryRow | null = null;
    if (parsed.data.scenarioEntryId) {
      const { data: entry, error: entryError } = await supabase
        .from("scenario_entries")
        .select("id, scenario_set_id, label, entry_type, status, assumptions_json")
        .eq("id", parsed.data.scenarioEntryId)
        .maybeSingle();

      if (entryError) {
        audit.error("scenario_entry_lookup_failed", {
          modelId: access.model.id,
          scenarioEntryId: parsed.data.scenarioEntryId,
          message: entryError.message,
          code: entryError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify scenario entry" }, { status: 500 });
      }

      if (!entry) {
        return NextResponse.json({ error: "Scenario entry not found" }, { status: 404 });
      }

      if (access.model.scenario_set_id && entry.scenario_set_id !== access.model.scenario_set_id) {
        return NextResponse.json({ error: "Scenario entry does not belong to the model's primary scenario set" }, { status: 400 });
      }

      scenarioEntry = entry as ScenarioEntryRow;
    }

    const modelTemplate = extractModelLaunchTemplate(access.model.config_json ?? {});
    const launchPayload = mergeScenarioLaunchPayload({
      modelTemplate,
      scenarioAssumptions: scenarioEntry?.assumptions_json,
      overrideQueryText: parsed.data.queryText,
      overrideCorridorGeojson: parsed.data.corridorGeojson,
    });
    launchPayload.engineKey = parsed.data.engineKey;

    if (!launchPayload.queryText || !launchPayload.corridorGeojson) {
      return NextResponse.json(
        {
          error:
            "Launch configuration is incomplete. Provide query text and corridor GeoJSON, or store them in model.config_json.runTemplate.",
        },
        { status: 400 }
      );
    }

    const modelRunId = crypto.randomUUID();
    const launchTitle = parsed.data.title?.trim() || scenarioEntry?.label?.trim() || `${access.model.title} run`;
    const launchedAt = new Date().toISOString();
    const launchPlan = buildManagedRunLaunchPlan(
      launchPayload.engineKey as "deterministic_corridor_v1" | "aequilibrae" | "activitysim"
    );
    const runManifest = buildManagedRunManifest({
      plan: launchPlan,
      launchedAt,
      model: {
        id: access.model.id,
        title: access.model.title ?? null,
        family: access.model.model_family ?? null,
        configVersion: access.model.config_version ?? null,
      },
      scenario: scenarioEntry
        ? {
            id: scenarioEntry.id,
            label: scenarioEntry.label,
            status: scenarioEntry.status,
          }
        : null,
      queryText: launchPayload.queryText,
      corridorGeojson: launchPayload.corridorGeojson,
      assumptionSnapshot: launchPayload.assumptionSnapshot,
    });
    const isQueuedRun = launchPlan.defaultRunStatus === "queued";

    const { error: createModelRunError } = await supabase.from("model_runs").insert({
      id: modelRunId,
      workspace_id: access.model.workspace_id,
      model_id: access.model.id,
      scenario_set_id: access.model.scenario_set_id,
      scenario_entry_id: scenarioEntry?.id ?? null,
      engine_key: launchPayload.engineKey || "deterministic_corridor_v1",
      launch_source: scenarioEntry ? "scenario_entry" : "model_detail",
      status: launchPlan.defaultRunStatus,
      run_title: launchTitle,
      query_text: launchPayload.queryText,
      corridor_geojson: launchPayload.corridorGeojson,
      input_snapshot_json: {
        modelId: access.model.id,
        modelTitle: access.model.title,
        modelFamily: access.model.model_family ?? null,
        configVersion: access.model.config_version ?? null,
        launchedAt,
        orchestration: runManifest,
      },
      assumption_snapshot_json: launchPayload.assumptionSnapshot,
      started_at: isQueuedRun ? null : launchedAt,
      created_by: user.id,
    });

    if (createModelRunError) {
      if (looksLikePendingSchema(createModelRunError.message)) {
        return NextResponse.json(
          { error: "model_runs migration is not applied yet. Apply the latest database migration first." },
          { status: 503 }
        );
      }

      audit.error("model_run_insert_failed", {
        modelId: access.model.id,
        userId: user.id,
        message: createModelRunError.message,
        code: createModelRunError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create model run" }, { status: 500 });
    }

    if (isQueuedRun) {
      const stageRows = launchPlan.stagePlan.map((stage) => ({
        run_id: modelRunId,
        stage_name: stage.stageName,
        sort_order: stage.sortOrder,
        status: "queued" as const,
      }));

      if (stageRows.length > 0) {
        const { error: stageInsertError } = await supabase.from("model_run_stages").insert(stageRows);

        if (stageInsertError) {
          await supabase
            .from("model_runs")
            .update({
              status: "failed",
              error_message: `Failed to initialize ${launchPlan.engineLabel} run stages`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", modelRunId);

          audit.error("model_run_stage_insert_failed", {
            modelId: access.model.id,
            modelRunId,
            engineKey: launchPlan.engineKey,
            message: stageInsertError.message,
            code: stageInsertError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to initialize model run stages" }, { status: 500 });
        }
      }

      return NextResponse.json(
        {
          modelRunId,
          status: launchPlan.defaultRunStatus,
          pipelineKey: launchPlan.pipelineKey,
          honestCapability: launchPlan.honestCapability,
        },
        { status: 201 }
      );
    }

    const analysisResponse = await fetch(new URL("/api/analysis", request.nextUrl.origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        workspaceId: access.model.workspace_id,
        queryText: launchPayload.queryText,
        corridorGeojson: launchPayload.corridorGeojson,
      }),
      cache: "no-store",
    });

    const analysisPayload = (await analysisResponse.json().catch(() => null)) as {
      error?: string;
      runId?: string;
      metrics?: Record<string, unknown>;
      summary?: string;
    } | null;

    if (!analysisResponse.ok || !analysisPayload?.runId) {
      const errorMessage = analysisPayload?.error || "Analysis launch failed";
      await supabase
        .from("model_runs")
        .update({ status: "failed", error_message: errorMessage, completed_at: new Date().toISOString() })
        .eq("id", modelRunId);

      return NextResponse.json({ error: errorMessage }, { status: analysisResponse.status || 500 });
    }

    const completedAt = new Date().toISOString();
    const resultSummary = buildModelRunResultSummary({
      runId: analysisPayload.runId,
      metrics: analysisPayload.metrics,
      summary: analysisPayload.summary,
    });

    const { error: modelRunUpdateError } = await supabase
      .from("model_runs")
      .update({
        status: "succeeded",
        source_analysis_run_id: analysisPayload.runId,
        result_summary_json: resultSummary,
        completed_at: completedAt,
      })
      .eq("id", modelRunId);

    if (modelRunUpdateError) {
      audit.error("model_run_update_failed", {
        modelId: access.model.id,
        modelRunId,
        message: modelRunUpdateError.message,
        code: modelRunUpdateError.code ?? null,
      });
      return NextResponse.json({ error: "Managed run launched, but provenance update failed" }, { status: 500 });
    }

    const { error: modelTouchError } = await supabase
      .from("models")
      .update({ last_run_recorded_at: completedAt })
      .eq("id", access.model.id);

    if (modelTouchError) {
      audit.warn("model_last_run_touch_failed", {
        modelId: access.model.id,
        modelRunId,
        message: modelTouchError.message,
        code: modelTouchError.code ?? null,
      });
    }

    const { data: existingRunLink } = await supabase
      .from("model_links")
      .select("id")
      .eq("model_id", access.model.id)
      .eq("link_type", "run")
      .eq("linked_id", analysisPayload.runId)
      .maybeSingle();

    if (!existingRunLink) {
      const { error: insertLinkError } = await supabase.from("model_links").insert({
        model_id: access.model.id,
        link_type: "run",
        linked_id: analysisPayload.runId,
        label: launchTitle,
        created_by: user.id,
      });

      if (insertLinkError) {
        audit.warn("model_run_link_insert_failed", {
          modelId: access.model.id,
          modelRunId,
          runId: analysisPayload.runId,
          message: insertLinkError.message,
          code: insertLinkError.code ?? null,
        });
      }
    }

    if (parsed.data.attachToScenarioEntry && scenarioEntry) {
      const nextScenarioStatus = scenarioEntry.status === "draft" ? "ready" : scenarioEntry.status;
      const { error: attachError } = await supabase
        .from("scenario_entries")
        .update({ attached_run_id: analysisPayload.runId, status: nextScenarioStatus })
        .eq("id", scenarioEntry.id);

      if (attachError) {
        audit.warn("scenario_entry_attach_failed", {
          modelId: access.model.id,
          modelRunId,
          scenarioEntryId: scenarioEntry.id,
          runId: analysisPayload.runId,
          message: attachError.message,
          code: attachError.code ?? null,
        });
      }
    }

    audit.info("model_run_succeeded", {
      modelId: access.model.id,
      modelRunId,
      runId: analysisPayload.runId,
      scenarioEntryId: scenarioEntry?.id ?? null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        modelRunId,
        runId: analysisPayload.runId,
        attachedScenarioEntryId: parsed.data.attachToScenarioEntry ? scenarioEntry?.id ?? null : null,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("model_run_launch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while launching model run" }, { status: 500 });
  }
}
