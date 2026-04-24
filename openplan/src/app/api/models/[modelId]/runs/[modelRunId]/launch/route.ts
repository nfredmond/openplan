import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import {
  checkMonthlyRunQuota,
  isQuotaExceeded,
  isQuotaLookupError,
  QUOTA_WEIGHTS,
} from "@/lib/billing/quota";
import {
  isWorkspaceSubscriptionActive,
  resolveWorkspaceEntitlements,
  subscriptionGateMessage,
} from "@/lib/billing/subscription";
import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";

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

    const workspaceId = access.model.workspace_id;

    const { data: workspaceBilling, error: billingError } = await supabase
      .from("workspaces")
      .select("plan, subscription_plan, subscription_status")
      .eq("id", workspaceId)
      .maybeSingle();

    if (billingError) {
      audit.error("workspace_billing_lookup_failed", {
        workspaceId,
        userId: user.id,
        message: billingError.message,
        code: billingError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace billing" }, { status: 500 });
    }

    if (!isWorkspaceSubscriptionActive(workspaceBilling ?? {})) {
      const gateMessage = subscriptionGateMessage(workspaceBilling ?? {});
      audit.warn("subscription_inactive", {
        workspaceId,
        userId: user.id,
        subscriptionStatus: workspaceBilling?.subscription_status ?? null,
      });
      return NextResponse.json({ error: gateMessage }, { status: 402 });
    }

    const { plan } = resolveWorkspaceEntitlements(workspaceBilling ?? {});
    const quota = await checkMonthlyRunQuota(supabase, {
      workspaceId,
      plan,
      tableName: "model_runs",
      weight: QUOTA_WEIGHTS.MODEL_RUN_LAUNCH,
    });

    if (isQuotaLookupError(quota)) {
      audit.error("run_limit_count_failed", {
        workspaceId,
        userId: user.id,
        message: quota.message,
        code: quota.code,
      });
      return NextResponse.json({ error: "Failed to validate plan limits" }, { status: 500 });
    }

    if (isQuotaExceeded(quota)) {
      audit.warn("run_limit_reached", {
        workspaceId,
        userId: user.id,
        plan: quota.plan,
        usedRuns: quota.usedRuns,
        monthlyLimit: quota.monthlyLimit,
      });
      return NextResponse.json({ error: quota.message }, { status: 429 });
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

    const nowIso = new Date().toISOString();

    // Update run to queued and clear stale prior-run residue
    const { error: updateError } = await supabase
      .from("model_runs")
      .update({
        status: "queued",
        updated_at: nowIso,
        started_at: null,
        completed_at: null,
        error_message: null,
        result_summary_json: null,
        source_analysis_run_id: null,
      })
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
      const { error: stageInsertError } = await supabase.from("model_run_stages").insert([
        { run_id: modelRun.id, stage_name: "AequilibraE Setup", sort_order: 1, status: "queued" },
        { run_id: modelRun.id, stage_name: "Network Assignment", sort_order: 2, status: "queued" },
        { run_id: modelRun.id, stage_name: "Artifact Extraction", sort_order: 3, status: "queued" },
      ]);

      if (stageInsertError) {
        audit.error("model_run_stage_insert_failed", {
          modelId: access.model.id,
          modelRunId: modelRun.id,
          message: stageInsertError.message,
          code: stageInsertError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to initialize model run stages" }, { status: 500 });
      }
    } else {
      // Reset stages to queued
      const { error: stageResetError } = await supabase
        .from("model_run_stages")
        .update({ status: "queued", error_message: null, log_tail: null, started_at: null, completed_at: null })
        .eq("run_id", modelRun.id);

      if (stageResetError) {
        audit.error("model_run_stage_reset_failed", {
          modelId: access.model.id,
          modelRunId: modelRun.id,
          message: stageResetError.message,
          code: stageResetError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to reset model run stages" }, { status: 500 });
      }
    }

    const [{ error: artifactDeleteError }, { error: kpiDeleteError }] = await Promise.all([
      supabase.from("model_run_artifacts").delete().eq("run_id", modelRun.id),
      supabase.from("model_run_kpis").delete().eq("run_id", modelRun.id),
    ]);

    if (artifactDeleteError || kpiDeleteError) {
      audit.error("model_run_cleanup_failed", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
        artifactDeleteMessage: artifactDeleteError?.message ?? null,
        artifactDeleteCode: artifactDeleteError?.code ?? null,
        kpiDeleteMessage: kpiDeleteError?.message ?? null,
        kpiDeleteCode: kpiDeleteError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to clear prior run artifacts" }, { status: 500 });
    }

    audit.info("model_run_launched", {
      modelId: access.model.id,
      modelRunId: modelRun.id,
      durationMs: Date.now() - startedAt,
    });

    await recordUsageEventBestEffort(
      {
        workspaceId,
        eventKey: "model_run.launch",
        bucketKey: "runs",
        weight: QUOTA_WEIGHTS.MODEL_RUN_LAUNCH,
        sourceRoute: "/api/models/[modelId]/runs/[modelRunId]/launch",
        idempotencyKey: `model_run:${modelRun.id}:launch`,
        metadata: { modelId: access.model.id, modelRunId: modelRun.id },
      },
      audit
    );

    return NextResponse.json({ success: true, status: "queued" }, { status: 200 });
  } catch (error) {
    audit.error("model_run_launch_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error launching model run" }, { status: 500 });
  }
}
