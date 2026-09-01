import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  GUIDED_AUTO_TRIP_CHANGE_KIND,
  GUIDED_PROJECT_COMPARISON_MODELS,
  GUIDED_PROJECT_COMPARISON_VERSION,
  GUIDED_WORKER_NETWORK_BASIS,
  guidedBuildAssumptions,
  isGuidedProjectComparisonModel,
  parseGuidedBuildAssumption,
  usesGuidedWorkerNetwork,
} from "@/lib/models/project-comparison";
import {
  collectGuidedRunEvidence,
  guidedEvidenceSharesExactNetwork,
  guidedRunJobKey,
  latestGuidedRuns,
  verifiedActivitySimPreflight,
  type GuidedRunJob,
  type GuidedRunRow,
  type ModelRunArtifactRow,
  type ModelRunKpiRow,
  type ModelRunStageRow,
} from "@/lib/models/guided-model-evidence";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  projectId: z.string().uuid(),
  retryActivitySim: z.boolean().optional(),
  buildAssumption: z.object({
    autoTripChangePct: z.number().finite().min(-90).max(200).refine((value) => value !== 0, {
      message: "The build change must be above or below zero",
    }),
    basis: z.string().trim().min(3).max(1000),
  }).optional(),
});

type ExistingModel = {
  id: string;
  model_family: string;
  config_json: unknown;
};

/**
 * Create the records a baseline-versus-build job needs, without creating an
 * input, a run, or a result. Repeating the request repairs and reuses the same
 * scaffold. A partially completed request is therefore visible and recoverable
 * rather than rolled back into a misleading "nothing happened" state.
 */
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("models.project_comparison.start", request);
  const startedAt = Date.now();

  try {
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    const parsed = inputSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", parsed.data.projectId)
      .maybeSingle();
    if (projectError) {
      audit.error("project_read_failed", { message: projectError.message, code: projectError.code ?? null });
      return NextResponse.json({ error: "Failed to verify project" }, { status: 500 });
    }
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", project.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) {
      audit.error("membership_read_failed", { message: membershipError.message, code: membershipError.code ?? null });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership || !canAccessWorkspaceAction("models.write", membership.role)) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const projectName = project.name?.trim() || "Untitled project";
    const comparisonTitle = `${projectName} baseline and build`;
    const existingSetResult = await supabase
      .from("scenario_sets")
      .select("id, baseline_entry_id")
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .eq("title", comparisonTitle)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingSetResult.error) {
      audit.error("scenario_set_read_failed", { message: existingSetResult.error.message });
      return NextResponse.json({ error: "Failed to read the project comparison" }, { status: 500 });
    }

    let scenarioSet = existingSetResult.data;
    let createdScenarioSet = false;
    if (!scenarioSet) {
      const createdSetResult = await supabase
        .from("scenario_sets")
        .insert({
          workspace_id: project.workspace_id,
          project_id: project.id,
          title: comparisonTitle,
          summary: "Guided baseline-versus-build comparison. Inputs, runs, validation, and uncertainties remain separate and visible.",
          planning_question: "How does the build scenario change traffic and vehicle miles traveled compared with the baseline?",
          status: "draft",
          created_by: user.id,
        })
        .select("id, baseline_entry_id")
        .single();
      if (createdSetResult.error || !createdSetResult.data) {
        audit.error("scenario_set_create_failed", { message: createdSetResult.error?.message ?? "unknown" });
        return NextResponse.json({ error: "Failed to create the project comparison" }, { status: 500 });
      }
      scenarioSet = createdSetResult.data;
      createdScenarioSet = true;
    }

    const entriesResult = await supabase
      .from("scenario_entries")
      .select("id, entry_type, assumptions_json")
      .eq("scenario_set_id", scenarioSet.id);
    if (entriesResult.error) {
      audit.error("scenario_entries_read_failed", { message: entriesResult.error.message });
      return NextResponse.json({ error: "Project comparison created, but its scenarios could not be read" }, { status: 500 });
    }

    const entries = (entriesResult.data ?? []) as Array<{
      id: string;
      entry_type: string;
      assumptions_json: Record<string, unknown> | null;
    }>;
    let baselineEntryId = entries.find((entry) => entry.entry_type === "baseline")?.id ?? null;
    let buildEntryId = entries.find((entry) => entry.entry_type === "alternative")?.id ?? null;

    if (!baselineEntryId) {
      const result = await supabase
        .from("scenario_entries")
        .insert({
          scenario_set_id: scenarioSet.id,
          entry_type: "baseline",
          label: "No-build baseline",
          slug: "no-build-baseline",
          summary: "Existing and committed conditions. Supply the locally adopted assumptions before running.",
          assumptions_json: {},
          status: "draft",
          sort_order: 0,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (result.error || !result.data) {
        return NextResponse.json({ error: "Comparison started, but the baseline scenario could not be created" }, { status: 500 });
      }
      baselineEntryId = result.data.id;
    }

    if (!buildEntryId) {
      const result = await supabase
        .from("scenario_entries")
        .insert({
          scenario_set_id: scenarioSet.id,
          entry_type: "alternative",
          label: "Build scenario",
          slug: "build-scenario",
          summary: "Proposed project conditions. Supply the actual project assumptions before running.",
          assumptions_json: {},
          status: "draft",
          sort_order: 10,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (result.error || !result.data) {
        return NextResponse.json({ error: "Comparison started, but the build scenario could not be created" }, { status: 500 });
      }
      buildEntryId = result.data.id;
    }

    let buildAssumptions =
      entries.find((entry) => entry.entry_type === "alternative")?.assumptions_json ?? {};
    if (parsed.data.buildAssumption) {
      const nextAssumption = guidedBuildAssumptions({
        kind: GUIDED_AUTO_TRIP_CHANGE_KIND,
        autoTripChangePct: parsed.data.buildAssumption.autoTripChangePct,
        basis: parsed.data.buildAssumption.basis,
      });
      const updateBuildResult = await supabase
        .from("scenario_entries")
        .update({ assumptions_json: nextAssumption })
        .eq("id", buildEntryId)
        .select("id")
        .maybeSingle();
      if (updateBuildResult.error || writeMatchedNoRows(updateBuildResult)) {
        return NextResponse.json(
          { error: "Comparison exists, but the build assumption could not be saved" },
          { status: 500 },
        );
      }
      buildAssumptions = nextAssumption;
    }
    const buildAssumption = parseGuidedBuildAssumption(buildAssumptions);

    if (scenarioSet.baseline_entry_id !== baselineEntryId) {
      const baselineLinkResult = await supabase
        .from("scenario_sets")
        .update({ baseline_entry_id: baselineEntryId })
        .eq("id", scenarioSet.id)
        .select("id")
        .maybeSingle();
      if (baselineLinkResult.error || writeMatchedNoRows(baselineLinkResult)) {
        return NextResponse.json({ error: "Comparison scenarios exist, but the baseline could not be designated" }, { status: 500 });
      }
    }

    const existingModelsResult = await supabase
      .from("models")
      .select("id, model_family, config_json")
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .eq("scenario_set_id", scenarioSet.id);
    if (existingModelsResult.error) {
      return NextResponse.json({ error: "Comparison scenarios exist, but its model records could not be read" }, { status: 500 });
    }

    const existingModels = (existingModelsResult.data ?? []) as ExistingModel[];
    const modelIds: Record<"aequilibrae" | "activitysim", string> = {
      aequilibrae: "",
      activitysim: "",
    };
    for (const definition of GUIDED_PROJECT_COMPARISON_MODELS) {
      const existing = existingModels.find((model) =>
        isGuidedProjectComparisonModel(model.config_json, definition.method),
      );
      if (existing) {
        if (!usesGuidedWorkerNetwork(existing.config_json)) {
          const priorConfig =
            existing.config_json && typeof existing.config_json === "object" && !Array.isArray(existing.config_json)
              ? existing.config_json as Record<string, unknown>
              : {};
          const repairResult = await supabase
            .from("models")
            .update({ config_json: { ...priorConfig, networkBasis: GUIDED_WORKER_NETWORK_BASIS } })
            .eq("id", existing.id)
            .select("id")
            .maybeSingle();
          if (repairResult.error || writeMatchedNoRows(repairResult)) {
            return NextResponse.json(
              { error: `Comparison exists, but the ${definition.titleSuffix} network basis could not be registered` },
              { status: 500 },
            );
          }
        }
        modelIds[definition.method] = existing.id;
        continue;
      }

      const createdModelResult = await supabase
        .from("models")
        .insert({
          workspace_id: project.workspace_id,
          project_id: project.id,
          scenario_set_id: scenarioSet.id,
          title: `${projectName} — ${definition.titleSuffix}`,
          model_family: definition.modelFamily,
          status: "draft",
          summary: `Guided ${definition.titleSuffix} record for the project baseline and build. No result exists until its real inputs are supplied and its run succeeds.`,
          assumptions_summary: "Not supplied yet.",
          input_summary: "Shared network and project scenario assumptions are required before launch.",
          output_summary: "No modeled output yet.",
          config_json: {
            guidedProjectComparison: GUIDED_PROJECT_COMPARISON_VERSION,
            method: definition.method,
            networkBasis: GUIDED_WORKER_NETWORK_BASIS,
          },
          created_by: user.id,
        })
        .select("id")
        .single();
      if (createdModelResult.error || !createdModelResult.data) {
        return NextResponse.json({ error: `Comparison started, but the ${definition.titleSuffix} record could not be created` }, { status: 500 });
      }
      modelIds[definition.method] = createdModelResult.data.id;
    }

    const guidedRunsResult = await supabase
      .from("model_runs")
      .select("id, model_id, scenario_entry_id, engine_key, status, assumption_snapshot_json, created_at")
      .in("model_id", [modelIds.aequilibrae, modelIds.activitysim])
      .in("scenario_entry_id", [baselineEntryId, buildEntryId])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (guidedRunsResult.error) {
      return NextResponse.json(
        { error: "Comparison is set up, but its run state could not be read" },
        { status: 500 },
      );
    }

    const guidedRuns = (guidedRunsResult.data ?? []) as GuidedRunRow[];
    if (!baselineEntryId || !buildEntryId) {
      return NextResponse.json(
        { error: "Comparison scenarios exist, but their identities could not be verified" },
        { status: 500 },
      );
    }
    const baselineAssumptions = entries.find((entry) => entry.entry_type === "baseline")?.assumptions_json ?? {};
    const orderedRunJobs = [
      { method: "aequilibrae", scenario: "baseline", modelId: modelIds.aequilibrae, scenarioEntryId: baselineEntryId, assumptionsJson: baselineAssumptions },
      { method: "aequilibrae", scenario: "build", modelId: modelIds.aequilibrae, scenarioEntryId: buildEntryId, assumptionsJson: buildAssumptions },
      { method: "activitysim", scenario: "baseline", modelId: modelIds.activitysim, scenarioEntryId: baselineEntryId, assumptionsJson: baselineAssumptions },
      { method: "activitysim", scenario: "build", modelId: modelIds.activitysim, scenarioEntryId: buildEntryId, assumptionsJson: buildAssumptions },
    ] as const satisfies readonly GuidedRunJob[];
    const guidedRunIds = guidedRuns.map((run) => run.id);
    const artifactsResult = guidedRunIds.length > 0
      ? await supabase
          .from("model_run_artifacts")
          .select("id, run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json, created_at")
          .in("run_id", guidedRunIds)
          .in("artifact_type", ["link_volumes", "activitysim_link_volumes", "evidence_packet"])
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
      : { data: [], error: null };
    if (artifactsResult.error) {
      audit.error("guided_output_artifacts_read_failed", { message: artifactsResult.error.message });
      return NextResponse.json(
        { error: "Comparison is set up, but its output evidence could not be verified" },
        { status: 500 },
      );
    }
    const artifacts = (artifactsResult.data ?? []) as ModelRunArtifactRow[];
    const stagesResult = guidedRunIds.length > 0
      ? await supabase
          .from("model_run_stages")
          .select("id, run_id, stage_name, status")
          .in("run_id", guidedRunIds)
          .in("stage_name", ["Artifact Extraction", "ActivitySim Bundle & Preflight", "ActivitySim Network Assignment"])
      : { data: [], error: null };
    if (stagesResult.error) {
      return NextResponse.json({ error: "Comparison is set up, but its run stages could not be verified" }, { status: 500 });
    }
    const kpisResult = guidedRunIds.length > 0
      ? await supabase
          .from("model_run_kpis")
          .select("id, run_id, kpi_name, breakdown_json, created_at")
          .in("run_id", guidedRunIds)
          .eq("kpi_name", "activitysim_runtime_mode")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
      : { data: [], error: null };
    if (kpisResult.error) {
      return NextResponse.json({ error: "Comparison is set up, but its ActivitySim runtime evidence could not be verified" }, { status: 500 });
    }
    const stages = (stagesResult.data ?? []) as ModelRunStageRow[];
    const kpis = (kpisResult.data ?? []) as ModelRunKpiRow[];
    const currentEvidence = collectGuidedRunEvidence(orderedRunJobs, guidedRuns, artifacts, stages);
    const evidenceByJob = new Map(
      currentEvidence.map((item) => [`${item.method}:${item.scenario}`, item]),
    );
    const latestByJob = latestGuidedRuns(orderedRunJobs, guidedRuns);
    const nextRun = orderedRunJobs.find((job) => {
      const latest = latestByJob.get(guidedRunJobKey(job));
      if (latest?.status !== "succeeded" || !evidenceByJob.has(`${job.method}:${job.scenario}`)) return true;
      return false;
    }) ?? null;

    const buildAssumptionRequired = nextRun?.scenario === "build" && !buildAssumption;
    const activitysimMissingOutputRuns = orderedRunJobs
      .filter((job) => job.method === "activitysim")
      .map((job) => ({ job, run: latestByJob.get(guidedRunJobKey(job)) }))
      .filter(({ job, run }) => run?.status === "succeeded" && !evidenceByJob.has(`${job.method}:${job.scenario}`))
      .map(({ job, run }) => ({
        runId: run!.id,
        scenario: job.scenario,
        runtimeMode: verifiedActivitySimPreflight({ run: run!, artifacts, stages, kpis }),
      }));
    const activitysimPreflightRuns = activitysimMissingOutputRuns
      .filter((item) => item.runtimeMode === "preflight_only")
      .map((item) => ({ runId: item.runId, scenario: item.scenario, status: "preflight_succeeded" as const }));
    const hasActivitySimPreflightForNext = Boolean(
      nextRun?.method === "activitysim" &&
      activitysimPreflightRuns.some((item) => item.scenario === nextRun.scenario),
    );
    const activitySimRetryRequested = Boolean(
      parsed.data.retryActivitySim && hasActivitySimPreflightForNext,
    );
    const needsActivitySimRuntime = Boolean(
      !buildAssumptionRequired &&
      hasActivitySimPreflightForNext &&
      !activitySimRetryRequested,
    );
    const needsActivitySimOutput = Boolean(
      !buildAssumptionRequired &&
      nextRun?.method === "activitysim" &&
      activitysimMissingOutputRuns.some((item) => item.scenario === nextRun.scenario) &&
      !hasActivitySimPreflightForNext,
    );
    const sharedNetworkMismatch = currentEvidence.length === 4 && !guidedEvidenceSharesExactNetwork(currentEvidence);

    audit.info("project_comparison_ready_for_inputs", {
      workspaceId: project.workspace_id,
      projectId: project.id,
      scenarioSetId: scenarioSet.id,
      createdScenarioSet,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        state: buildAssumptionRequired
          ? "needs_build_assumption"
          : needsActivitySimRuntime
            ? "needs_activitysim_runtime"
          : needsActivitySimOutput
            ? "needs_activitysim_output"
          : sharedNetworkMismatch
            ? "needs_shared_network_rerun"
          : nextRun
            ? "ready_for_run"
            : "ready_for_validation",
        scenarioSetId: scenarioSet.id,
        baselineEntryId,
        buildEntryId,
        modelIds,
        networkBasis: GUIDED_WORKER_NETWORK_BASIS.kind,
        nextRun: buildAssumptionRequired ? null : nextRun,
        buildAssumptionRequired,
        buildAssumption,
        verifiedOutputs: currentEvidence.map((item) => ({
          runId: item.runId,
          method: item.method,
          scenario: item.scenario,
          artifactType: item.artifactType,
          artifactId: item.artifactId,
          artifactSha256: item.artifactSha256,
          assignmentProfileSha256: item.assignmentProfileSha256,
          networkSettingsSha256: item.networkSettingsSha256,
          networkStateSha256: item.networkStateSha256,
        })),
        activitysimPreflightRuns,
      },
      { status: createdScenarioSet ? 201 : 200 },
    );
  } catch (error) {
    audit.error("project_comparison_start_unhandled", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while starting the project comparison" }, { status: 500 });
  }
}
