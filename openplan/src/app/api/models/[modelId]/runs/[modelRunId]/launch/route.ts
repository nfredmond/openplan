import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.launch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadModelAccess(supabase, parsedParams.data.modelId, user.id, "models.write");
    if (access.error || !access.model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // Load the model run
    const { data: modelRun, error: modelRunError } = await supabase
      .from("model_runs")
      .select("id, status")
      .eq("id", parsedParams.data.modelRunId)
      .eq("model_id", access.model.id)
      .maybeSingle();

    if (modelRunError || !modelRun) {
      return NextResponse.json({ error: "Model run not found" }, { status: 404 });
    }

    if (modelRun.status === "running" || modelRun.status === "succeeded") {
      return NextResponse.json({ error: "Cannot launch a run that is already running or succeeded" }, { status: 400 });
    }

    // Update run to queued
    const { error: updateError } = await supabase
      .from("model_runs")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", modelRun.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to queue model run" }, { status: 500 });
    }

    // Create the first stage if it doesn't exist, or reset it
    const { data: existingStages } = await supabase
      .from("model_run_stages")
      .select("id")
      .eq("run_id", modelRun.id);

    if (!existingStages || existingStages.length === 0) {
      // Create initial stages
      await supabase.from("model_run_stages").insert([
        { run_id: modelRun.id, stage_name: "AequilibraE Setup", sort_order: 1, status: "queued" },
        { run_id: modelRun.id, stage_name: "Network Assignment", sort_order: 2, status: "queued" },
        { run_id: modelRun.id, stage_name: "Artifact Extraction", sort_order: 3, status: "queued" }
      ]);
    } else {
      // Reset stages to queued
      await supabase
        .from("model_run_stages")
        .update({ status: "queued", error_message: null, log_tail: null, started_at: null, completed_at: null })
        .eq("run_id", modelRun.id);
    }

    audit.info("model_run_launched", {
      modelId: access.model.id,
      modelRunId: modelRun.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, status: "queued" }, { status: 200 });
  } catch (error) {
    audit.error("model_run_launch_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error launching model run" }, { status: 500 });
  }
}
