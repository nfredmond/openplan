import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

const patchSchema = z.object({
  scenarioEntryId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

type ModelRunRow = {
  id: string;
  model_id: string;
  scenario_entry_id: string | null;
  scenario_set_id: string | null;
  source_analysis_run_id: string | null;
  status: string;
  run_title: string;
};

type ScenarioEntryRow = {
  id: string;
  scenario_set_id: string;
  status: string;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.promote", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid promotion payload" }, { status: 400 });
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
      return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
    }
    if (!access.model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: modelRun, error: modelRunError } = await supabase
      .from("model_runs")
      .select("id, model_id, scenario_entry_id, scenario_set_id, source_analysis_run_id, status, run_title")
      .eq("id", parsedParams.data.modelRunId)
      .eq("model_id", access.model.id)
      .maybeSingle();

    if (modelRunError) {
      audit.error("model_run_lookup_failed", { message: modelRunError.message, code: modelRunError.code ?? null });
      return NextResponse.json({ error: "Failed to load model run" }, { status: 500 });
    }
    if (!modelRun) {
      return NextResponse.json({ error: "Model run not found" }, { status: 404 });
    }

    const runRow = modelRun as ModelRunRow;
    if (runRow.status !== "succeeded" || !runRow.source_analysis_run_id) {
      return NextResponse.json({ error: "Only succeeded model runs with a linked analysis run can be promoted" }, { status: 400 });
    }

    const { data: scenarioEntry, error: scenarioEntryError } = await supabase
      .from("scenario_entries")
      .select("id, scenario_set_id, status")
      .eq("id", parsed.data.scenarioEntryId)
      .maybeSingle();

    if (scenarioEntryError) {
      audit.error("scenario_entry_lookup_failed", { message: scenarioEntryError.message, code: scenarioEntryError.code ?? null });
      return NextResponse.json({ error: "Failed to load scenario entry" }, { status: 500 });
    }
    if (!scenarioEntry) {
      return NextResponse.json({ error: "Scenario entry not found" }, { status: 404 });
    }

    const entryRow = scenarioEntry as ScenarioEntryRow;
    const expectedScenarioSetId = access.model.scenario_set_id ?? runRow.scenario_set_id;
    if (expectedScenarioSetId && entryRow.scenario_set_id !== expectedScenarioSetId) {
      return NextResponse.json({ error: "Scenario entry does not belong to this model's scenario set" }, { status: 400 });
    }

    const nextScenarioStatus = entryRow.status === "draft" ? "ready" : entryRow.status;
    const now = new Date().toISOString();

    const { error: scenarioUpdateError } = await supabase
      .from("scenario_entries")
      .update({ attached_run_id: runRow.source_analysis_run_id, status: nextScenarioStatus })
      .eq("id", entryRow.id);

    if (scenarioUpdateError) {
      audit.error("scenario_entry_update_failed", { message: scenarioUpdateError.message, code: scenarioUpdateError.code ?? null });
      return NextResponse.json({ error: "Failed to update scenario entry attachment" }, { status: 500 });
    }

    const { error: modelRunUpdateError } = await supabase
      .from("model_runs")
      .update({
        scenario_entry_id: entryRow.id,
        scenario_set_id: entryRow.scenario_set_id,
        updated_at: now,
      })
      .eq("id", runRow.id);

    if (modelRunUpdateError) {
      audit.error("model_run_relink_failed", { message: modelRunUpdateError.message, code: modelRunUpdateError.code ?? null });
      return NextResponse.json({ error: "Scenario entry updated, but model run relink failed" }, { status: 500 });
    }

    audit.info("model_run_promoted", {
      modelId: access.model.id,
      modelRunId: runRow.id,
      scenarioEntryId: entryRow.id,
      sourceAnalysisRunId: runRow.source_analysis_run_id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        modelRunId: runRow.id,
        scenarioEntryId: entryRow.id,
        sourceAnalysisRunId: runRow.source_analysis_run_id,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("model_run_promote_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while promoting model run" }, { status: 500 });
  }
}
