import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  checkMonthlyRunCap,
  isRunCapExceeded,
  isRunCapLookupError,
  RUN_WEIGHTS,
} from "@/lib/config/run-cap";
import {
  markScenarioLinkedReportsBasisStale,
  type ScenarioReportWritebackSupabaseLike,
} from "@/lib/reports/scenario-writeback";
import { loadScenarioSetAccess, looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import { SCENARIO_COMPARISON_SNAPSHOT_STATUSES } from "@/lib/scenarios/catalog";
import { buildScenarioComparisonSourceContext } from "@/lib/scenarios/comparison-source-context";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  isWriteFailure,
  noRowsMatchedResponse,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";
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
import {
  hasGuidedProjectComparisonIntent,
  isGuidedProjectComparisonModel,
  usesGuidedWorkerNetwork,
} from "@/lib/models/project-comparison";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

const indicatorDeltaSchema = z.object({
  baselineIndicatorSnapshotId: z.string().uuid().optional(),
  candidateIndicatorSnapshotId: z.string().uuid().optional(),
  indicatorKey: z.string().trim().min(1).max(120),
  indicatorLabel: z.string().trim().min(1).max(160),
  unitLabel: z.string().trim().max(80).optional(),
  delta: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const createComparisonSnapshotSchema = z.object({
  baselineEntryId: z.string().uuid(),
  candidateEntryId: z.string().uuid(),
  assumptionSetId: z.string().uuid().optional(),
  dataPackageId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  narrative: z.string().trim().max(8000).optional(),
  caveats: z.array(z.string().trim().min(1).max(400)).max(25).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(SCENARIO_COMPARISON_SNAPSHOT_STATUSES).optional(),
  indicatorDeltas: z.array(indicatorDeltaSchema).max(100).optional(),
});

type RouteContext = {
  params: Promise<{ scenarioSetId: string }>;
};

async function loadScenarioEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  scenarioEntryId: string
) {
  const { data, error } = await supabase
    .from("scenario_entries")
    .select("id, scenario_set_id, entry_type, label, assumptions_json, attached_run_id")
    .eq("id", scenarioEntryId)
    .eq("scenario_set_id", scenarioSetId)
    .maybeSingle();

  return { entry: data, error };
}

async function loadScenarioAssumptionSet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  assumptionSetId: string | undefined
) {
  if (!assumptionSetId) return { assumptionSet: null, error: null };

  const { data, error } = await supabase
    .from("scenario_assumption_sets")
    .select("id, scenario_set_id")
    .eq("id", assumptionSetId)
    .eq("scenario_set_id", scenarioSetId)
    .maybeSingle();

  return { assumptionSet: data, error };
}

async function loadScenarioDataPackage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  dataPackageId: string | undefined
) {
  if (!dataPackageId) return { dataPackage: null, error: null };

  const { data, error } = await supabase
    .from("scenario_data_packages")
    .select("id, scenario_set_id")
    .eq("id", dataPackageId)
    .eq("scenario_set_id", scenarioSetId)
    .maybeSingle();

  return { dataPackage: data, error };
}

async function loadIndicatorSnapshotIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  snapshotIds: string[]
) {
  if (!snapshotIds.length) {
    return { snapshotIds: new Set<string>(), error: null };
  }

  const { data, error } = await supabase
    .from("scenario_indicator_snapshots")
    .select("id")
    .eq("scenario_set_id", scenarioSetId)
    .in("id", snapshotIds);

  return {
    snapshotIds: new Set((data ?? []).map((item) => item.id as string)),
    error,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.spine.comparison_snapshots.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.documentJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
    const parsed = createComparisonSnapshotSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid comparison snapshot payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadScenarioSetAccess(supabase, parsedParams.data.scenarioSetId, user.id, "scenarios.write");

    if (access.error) {
      audit.error("scenario_set_access_failed", {
        scenarioSetId: parsedParams.data.scenarioSetId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify scenario set access" }, { status: 500 });
    }

    if (!access.scenarioSet) {
      return NextResponse.json({ error: "Scenario set not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // The workspace billing lookup and subscription gate that stood here are
    // gone with the plan concept: OpenPlan is free, so there is no state in
    // which a member may not do this. Only an operator-set cap can refuse.
    const runCap = await checkMonthlyRunCap(supabase, {
      workspaceId: access.scenarioSet.workspace_id,
      tableName: "runs",
      weight: RUN_WEIGHTS.DEFAULT,
    });

    if (isRunCapLookupError(runCap)) {
      audit.error("run_cap_count_failed", {
        workspaceId: access.scenarioSet.workspace_id,
        userId: user.id,
        message: runCap.message,
        code: runCap.code,
      });
      return NextResponse.json({ error: "Failed to validate the run limit" }, { status: 500 });
    }

    if (isRunCapExceeded(runCap)) {
      audit.warn("run_cap_reached", {
        workspaceId: access.scenarioSet.workspace_id,
        userId: user.id,
        usedRuns: runCap.usedRuns,
        cap: runCap.cap,
      });
      return NextResponse.json({ error: runCap.message }, { status: 429 });
    }

    const [baselineEntryResult, candidateEntryResult, assumptionSetResult, dataPackageResult] = await Promise.all([
      loadScenarioEntry(supabase, access.scenarioSet.id, parsed.data.baselineEntryId),
      loadScenarioEntry(supabase, access.scenarioSet.id, parsed.data.candidateEntryId),
      loadScenarioAssumptionSet(supabase, access.scenarioSet.id, parsed.data.assumptionSetId),
      loadScenarioDataPackage(supabase, access.scenarioSet.id, parsed.data.dataPackageId),
    ]);

    const validationLookupError =
      baselineEntryResult.error ??
      candidateEntryResult.error ??
      assumptionSetResult.error ??
      dataPackageResult.error;

    if (validationLookupError) {
      audit.error("comparison_snapshot_dependency_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: validationLookupError.message,
        code: validationLookupError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify comparison snapshot dependencies" }, { status: 500 });
    }

    if (!baselineEntryResult.entry || baselineEntryResult.entry.entry_type !== "baseline") {
      return NextResponse.json(
        { error: "Baseline entry must be a baseline in this scenario set" },
        { status: 400 }
      );
    }

    if (!candidateEntryResult.entry || candidateEntryResult.entry.entry_type === "baseline") {
      return NextResponse.json(
        { error: "Candidate entry must be an alternative in this scenario set" },
        { status: 400 }
      );
    }

    if (baselineEntryResult.entry.id === candidateEntryResult.entry.id) {
      return NextResponse.json(
        { error: "Baseline and candidate entries must be different" },
        { status: 400 }
      );
    }

    if (parsed.data.assumptionSetId && !assumptionSetResult.assumptionSet) {
      return NextResponse.json(
        { error: "Assumption set must belong to this scenario set" },
        { status: 400 }
      );
    }

    if (parsed.data.dataPackageId && !dataPackageResult.dataPackage) {
      return NextResponse.json(
        { error: "Data package must belong to this scenario set" },
        { status: 400 }
      );
    }

    const indicatorSnapshotIds = Array.from(
      new Set(
        (parsed.data.indicatorDeltas ?? []).flatMap((delta) => [
          delta.baselineIndicatorSnapshotId,
          delta.candidateIndicatorSnapshotId,
        ])
      )
    ).filter((value): value is string => Boolean(value));

    const indicatorSnapshotResult = await loadIndicatorSnapshotIds(
      supabase,
      access.scenarioSet.id,
      indicatorSnapshotIds
    );

    if (indicatorSnapshotResult.error) {
      audit.error("comparison_snapshot_indicator_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: indicatorSnapshotResult.error.message,
        code: indicatorSnapshotResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify indicator snapshots" }, { status: 500 });
    }

    const missingIndicatorReference = indicatorSnapshotIds.find(
      (snapshotId) => !indicatorSnapshotResult.snapshotIds.has(snapshotId)
    );
    if (missingIndicatorReference) {
      return NextResponse.json(
        { error: "Indicator snapshots must belong to this scenario set" },
        { status: 400 }
      );
    }

    const sourceContext = buildScenarioComparisonSourceContext({
      baselineEntry: baselineEntryResult.entry,
      candidateEntry: candidateEntryResult.entry,
      indicatorDeltaCount: parsed.data.indicatorDeltas?.length ?? 0,
      evidenceLabels: (parsed.data.indicatorDeltas ?? []).map((delta) => delta.indicatorLabel),
      caveats: parsed.data.caveats ?? [],
      status: parsed.data.status ?? "draft",
    });
    const metadataJson = {
      ...(parsed.data.metadata ?? {}),
      sourceContext,
    };

    const guidedModelsResult = await supabase
      .from("models")
      .select("id, config_json")
      .eq("scenario_set_id", access.scenarioSet.id)
      .eq("project_id", access.scenarioSet.project_id);
    if (guidedModelsResult.error) {
      return NextResponse.json({ error: "Failed to verify guided comparison models" }, { status: 500 });
    }
    const guidedModels = (guidedModelsResult.data ?? []) as Array<{ id: string; config_json: unknown }>;
    const aequilibraeModel = guidedModels.find((model) =>
      isGuidedProjectComparisonModel(model.config_json, "aequilibrae"),
    );
    const activitysimModel = guidedModels.find((model) =>
      isGuidedProjectComparisonModel(model.config_json, "activitysim"),
    );
    const guidedIntent = guidedModels.some((model) => hasGuidedProjectComparisonIntent(model.config_json));
    const isGuidedReadyRequest = parsed.data.status === "ready" && guidedIntent;
    let guidedEvidence: ReturnType<typeof collectGuidedRunEvidence> = [];
    if (
      isGuidedReadyRequest &&
      (!aequilibraeModel || !activitysimModel ||
        !usesGuidedWorkerNetwork(aequilibraeModel.config_json) ||
        !usesGuidedWorkerNetwork(activitysimModel.config_json))
    ) {
      return NextResponse.json(
        { error: "The guided model contract is incomplete or corrupt and cannot be treated as a generic ready snapshot.", repairState: "guided_contract_invalid" },
        { status: 409 },
      );
    }
    if (isGuidedReadyRequest && aequilibraeModel && activitysimModel) {
      const jobs = [
        { method: "aequilibrae", scenario: "baseline", modelId: aequilibraeModel.id, scenarioEntryId: parsed.data.baselineEntryId, assumptionsJson: (baselineEntryResult.entry.assumptions_json as Record<string, unknown> | null) ?? {} },
        { method: "aequilibrae", scenario: "build", modelId: aequilibraeModel.id, scenarioEntryId: parsed.data.candidateEntryId, assumptionsJson: (candidateEntryResult.entry.assumptions_json as Record<string, unknown> | null) ?? {} },
        { method: "activitysim", scenario: "baseline", modelId: activitysimModel.id, scenarioEntryId: parsed.data.baselineEntryId, assumptionsJson: (baselineEntryResult.entry.assumptions_json as Record<string, unknown> | null) ?? {} },
        { method: "activitysim", scenario: "build", modelId: activitysimModel.id, scenarioEntryId: parsed.data.candidateEntryId, assumptionsJson: (candidateEntryResult.entry.assumptions_json as Record<string, unknown> | null) ?? {} },
      ] as const satisfies readonly GuidedRunJob[];
      const runsResult = await supabase
        .from("model_runs")
        .select("id, model_id, scenario_entry_id, engine_key, status, assumption_snapshot_json, created_at")
        .in("model_id", [aequilibraeModel.id, activitysimModel.id])
        .in("scenario_entry_id", [parsed.data.baselineEntryId, parsed.data.candidateEntryId])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (runsResult.error) {
        return NextResponse.json({ error: "Failed to verify guided comparison runs" }, { status: 500 });
      }
      const runs = (runsResult.data ?? []) as GuidedRunRow[];
      const runIds = runs.map((run) => run.id);
      const artifactsResult = runIds.length
        ? await supabase
            .from("model_run_artifacts")
            .select("id, run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json, created_at")
            .in("run_id", runIds)
            .in("artifact_type", ["link_volumes", "activitysim_link_volumes", "evidence_packet"])
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
        : { data: [], error: null };
      if (artifactsResult.error) {
        return NextResponse.json({ error: "Failed to verify guided output artifacts" }, { status: 500 });
      }
      const stagesResult = runIds.length
        ? await supabase.from("model_run_stages")
            .select("id, run_id, stage_name, status")
            .in("run_id", runIds)
            .in("stage_name", ["Artifact Extraction", "ActivitySim Bundle & Preflight", "ActivitySim Network Assignment"])
        : { data: [], error: null };
      const kpisResult = runIds.length
        ? await supabase.from("model_run_kpis")
            .select("id, run_id, kpi_name, breakdown_json, created_at")
            .in("run_id", runIds)
            .eq("kpi_name", "activitysim_runtime_mode")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
        : { data: [], error: null };
      if (stagesResult.error || kpisResult.error) {
        return NextResponse.json({ error: "Failed to verify guided run stages and runtime evidence" }, { status: 500 });
      }
      const artifacts = (artifactsResult.data ?? []) as ModelRunArtifactRow[];
      const stages = (stagesResult.data ?? []) as ModelRunStageRow[];
      const kpis = (kpisResult.data ?? []) as ModelRunKpiRow[];
      guidedEvidence = collectGuidedRunEvidence(jobs, runs, artifacts, stages);
      const latest = latestGuidedRuns(jobs, runs);
      const missingActivitySim = jobs
        .filter((job) => job.method === "activitysim")
        .map((job) => latest.get(guidedRunJobKey(job)))
        .find((run) => run?.status === "succeeded" && !guidedEvidence.some((item) => item.runId === run.id));
      const activitySimMode = missingActivitySim
        ? verifiedActivitySimPreflight({ run: missingActivitySim, artifacts, stages, kpis })
        : null;
      if (!guidedEvidenceSharesExactNetwork(guidedEvidence)) {
        return NextResponse.json(
          {
            error: "A ready guided comparison requires current baseline and build output artifacts from both methods.",
            repairState: guidedEvidence.length === 4
              ? "needs_shared_network_rerun"
              : activitySimMode === "preflight_only"
                ? "needs_activitysim_runtime"
                : missingActivitySim
                  ? "needs_activitysim_output"
                  : "needs_model_outputs",
          },
          { status: 409 },
        );
      }
      const decisionsResult = await supabase.from("modeling_claim_decisions")
        .select("model_run_id, track, claim_status")
        .in("model_run_id", guidedEvidence.map((item) => item.runId));
      if (decisionsResult.error) {
        return NextResponse.json({ error: "Failed to verify guided validation decisions" }, { status: 500 });
      }
      const decisions = (decisionsResult.data ?? []) as Array<{ model_run_id: string; track: string; claim_status: string }>;
      const decidedRunIds = new Set(decisions
        .filter((decision) => guidedEvidence.some((item) =>
          item.runId === decision.model_run_id &&
          decision.track === (item.method === "aequilibrae" ? "assignment" : "behavioral_demand"),
        ))
        .map((decision) => decision.model_run_id));
      if (decidedRunIds.size !== 4) {
        return NextResponse.json(
          { error: "A ready guided comparison requires a track-matched validation decision for each exact output.", repairState: "needs_validation_decisions" },
          { status: 409 },
        );
      }
    }

    const { data: comparisonSnapshot, error: insertError } = await supabase
      .from("scenario_comparison_snapshots")
      .insert({
        scenario_set_id: access.scenarioSet.id,
        baseline_entry_id: parsed.data.baselineEntryId,
        candidate_entry_id: parsed.data.candidateEntryId,
        assumption_set_id: parsed.data.assumptionSetId ?? null,
        data_package_id: parsed.data.dataPackageId ?? null,
        label: parsed.data.label.trim(),
        summary: parsed.data.summary?.trim() || null,
        narrative: parsed.data.narrative?.trim() || null,
        caveats_json: parsed.data.caveats ?? [],
        metadata_json: metadataJson,
        status: isGuidedReadyRequest ? "draft" : parsed.data.status ?? "draft",
        created_by: user.id,
      })
      .select(
        "id, scenario_set_id, baseline_entry_id, candidate_entry_id, assumption_set_id, data_package_id, label, summary, narrative, caveats_json, metadata_json, status, created_at, updated_at"
      )
      .single();

    if (insertError || !comparisonSnapshot) {
      if (looksLikePendingScenarioSpineSchema(insertError?.message)) {
        return NextResponse.json(
          {
            error: "Scenario comparison schema is not available yet",
            hint: "Apply the latest Supabase migrations for the scenarios module before creating comparison snapshots.",
          },
          { status: 503 }
        );
      }

      audit.error("comparison_snapshot_insert_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create comparison snapshot" }, { status: 500 });
    }

    let comparisonIndicatorDeltas: Array<Record<string, unknown>> = [];

    if ((parsed.data.indicatorDeltas?.length ?? 0) > 0) {
      const { data: insertedDeltas, error: deltaInsertError } = await supabase
        .from("scenario_comparison_indicator_deltas")
        .insert(
          (parsed.data.indicatorDeltas ?? []).map((delta, index) => ({
            comparison_snapshot_id: comparisonSnapshot.id,
            indicator_key: delta.indicatorKey.trim(),
            indicator_label: delta.indicatorLabel.trim(),
            unit_label: delta.unitLabel?.trim() || null,
            baseline_indicator_snapshot_id: delta.baselineIndicatorSnapshotId ?? null,
            candidate_indicator_snapshot_id: delta.candidateIndicatorSnapshotId ?? null,
            delta_json: delta.delta ?? {},
            summary_text: delta.summary?.trim() || null,
            sort_order: delta.sortOrder ?? index,
          }))
        )
        .select(
          "id, comparison_snapshot_id, indicator_key, indicator_label, unit_label, baseline_indicator_snapshot_id, candidate_indicator_snapshot_id, delta_json, summary_text, sort_order, created_at, updated_at"
        );

      if (deltaInsertError) {
        if (looksLikePendingScenarioSpineSchema(deltaInsertError.message)) {
          return NextResponse.json(
            {
              error: "Scenario comparison schema is not available yet",
              hint: "Apply the latest Supabase migrations for the scenarios module before creating comparison indicator deltas.",
            },
            { status: 503 }
          );
        }

        audit.error("comparison_indicator_delta_insert_failed", {
          scenarioSetId: access.scenarioSet.id,
          comparisonSnapshotId: comparisonSnapshot.id,
          message: deltaInsertError.message,
          code: deltaInsertError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to create comparison indicator deltas" }, { status: 500 });
      }

      comparisonIndicatorDeltas = (insertedDeltas ?? []) as Array<Record<string, unknown>>;
    }

    if (isGuidedReadyRequest) {
      const linksResult = await supabase.from("scenario_comparison_model_run_links").insert(
        guidedEvidence.map((item) => ({
          workspace_id: access.scenarioSet.workspace_id,
          comparison_snapshot_id: comparisonSnapshot.id,
          model_run_id: item.runId,
          model_run_artifact_id: item.artifactId,
          method: item.method,
          scenario_role: item.scenario,
          artifact_type: item.artifactType,
          artifact_sha256: item.artifactSha256,
          assignment_profile_sha256: item.assignmentProfileSha256,
          network_settings_sha256: item.networkSettingsSha256,
          network_state_sha256: item.networkStateSha256,
          scenario_assumptions_json: item.scenarioAssumptionsJson,
          created_by: user.id,
        })),
      );
      if (linksResult.error) {
        audit.error("guided_comparison_links_insert_failed", {
          scenarioSetId: access.scenarioSet.id,
          comparisonSnapshotId: comparisonSnapshot.id,
          message: linksResult.error.message,
        });
        return NextResponse.json(
          { error: "The snapshot was retained as a draft because its exact model outputs could not be bound." },
          { status: 500 },
        );
      }
      const readyResult = await supabase
        .from("scenario_comparison_snapshots")
        .update({ status: "ready" })
        .eq("id", comparisonSnapshot.id)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();
      if (isWriteFailure(readyResult.error)) {
        audit.error("guided_comparison_ready_update_failed", {
          scenarioSetId: access.scenarioSet.id,
          comparisonSnapshotId: comparisonSnapshot.id,
          message: readyResult.error?.message ?? null,
        });
        return NextResponse.json(
          { error: "The exact model outputs were bound, but the comparison remains a draft." },
          { status: 500 },
        );
      }
      if (writeMatchedNoRows(readyResult)) {
        audit.error("guided_comparison_ready_update_matched_no_rows", {
          scenarioSetId: access.scenarioSet.id,
          comparisonSnapshotId: comparisonSnapshot.id,
        });
        return noRowsMatchedResponse({ subject: "comparison snapshot", targetWasVerified: true });
      }
      comparisonSnapshot.status = "ready";
    }

    const staleWriteback = await markScenarioLinkedReportsBasisStale({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: access.scenarioSet.id,
      workspaceId: access.scenarioSet.workspace_id,
      runId: null,
      reason: `Scenario comparison snapshot ${comparisonSnapshot.label} changed the linked RTP packet basis.`,
    });

    if (staleWriteback.error) {
      audit.warn("comparison_snapshot_report_basis_stale_failed", {
        scenarioSetId: access.scenarioSet.id,
        comparisonSnapshotId: comparisonSnapshot.id,
        message: staleWriteback.error.message,
        code: staleWriteback.error.code ?? null,
      });
    }

    audit.info("comparison_snapshot_created", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      comparisonSnapshotId: comparisonSnapshot.id,
      indicatorDeltaCount: comparisonIndicatorDeltas.length,
      staleReportCount: staleWriteback.staleReportIds.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        comparisonSnapshotId: comparisonSnapshot.id,
        comparisonSnapshot,
        comparisonIndicatorDeltas,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("comparison_snapshot_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while creating comparison snapshot" },
      { status: 500 }
    );
  }
}
