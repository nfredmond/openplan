import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  readAssistantExecutionSource,
  verifyAssistantActionApproval,
  type AssistantApprovalVerification,
} from "@/lib/assistant/action-approval-server";
import { refuseOutOfScopeAgentRequest } from "@/lib/assistant/agent-request-scope";
import { recordAssistantActionExecution } from "@/lib/observability/action-audit";
import { getActionMetadata } from "@/lib/runtime/action-metadata";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import {
  isWriteFailure,
  noRowsMatchedResponse,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  prepareWorkerZoneAttributes,
  type ZoneAttributeStamp,
} from "@/lib/models/zone-attribute-payload";
import type { ZoneAttributeLevel } from "@/lib/geographies/zone-attribute-source";
import {
  checkMonthlyRunCap,
  isRunCapExceeded,
  isRunCapLookupError,
  RUN_WEIGHTS,
} from "@/lib/config/run-cap";
import {
  buildModelRunDispatchPayload,
  describeModelRunDispatch,
  dispatchModelRun,
  queuedStageRows,
  workerRunStageNames,
} from "@/lib/models/run-dispatch";
import { resolveModelingWorkerDeclaration } from "@/lib/config/deployment-health-facts";
import {
  prepareTransitFeedHandoff,
  transitFeedIdFromSnapshot,
  type TransitFeedStamp,
} from "@/lib/models/transit-feed-handoff";

/**
 * Exactly the body keys the `launch_model_run` action sends. The route reads
 * none of them — the workspace comes from the model — but the set is declared
 * so `refuseOutOfScopeAgentRequest` can reject a widened agent request.
 */
const AGENT_LAUNCH_BODY_KEYS = ["workspaceId"] as const;

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

    // The workspace billing lookup and subscription gate that stood here are
    // gone with the plan concept: OpenPlan is free, so there is no state in
    // which a member may not launch a run. Only an operator-set cap can refuse.
    const runCap = await checkMonthlyRunCap(supabase, {
      workspaceId,
      tableName: "model_runs",
      weight: RUN_WEIGHTS.MODEL_RUN_LAUNCH,
    });

    if (isRunCapLookupError(runCap)) {
      audit.error("run_cap_count_failed", {
        workspaceId,
        userId: user.id,
        message: runCap.message,
        code: runCap.code,
      });
      return NextResponse.json({ error: "Failed to validate the run limit" }, { status: 500 });
    }

    if (isRunCapExceeded(runCap)) {
      audit.warn("run_cap_reached", {
        workspaceId,
        userId: user.id,
        usedRuns: runCap.usedRuns,
        cap: runCap.cap,
      });
      return NextResponse.json({ error: runCap.message }, { status: 429 });
    }

    // Load the model run. `corridor_geojson` and `input_snapshot_json` are read
    // because relaunching REBUILDS this run's demographic inputs (below) rather
    // than re-queueing a stale copy of them.
    const { data: modelRun, error: modelRunError } = await supabase
      .from("model_runs")
      .select("id, status, engine_key, corridor_geojson, input_snapshot_json")
      .eq("id", parsedParams.data.modelRunId)
      .eq("model_id", access.model.id)
      .maybeSingle();

    if (modelRunError || !modelRun) {
      return NextResponse.json({ error: "Model run not found" }, { status: 404 });
    }

    if (modelRun.status === "running" || modelRun.status === "succeeded") {
      return NextResponse.json({ error: "Cannot launch a run that is already running or succeeded" }, { status: 400 });
    }

    // This route re-queues a run into the AequilibraE worker (stages below).
    // In-process engines must never take that path: the worker claims queued
    // stages with no engine filter, would fall back to the pilot bbox for the
    // missing corridor, and would write assignment outputs onto a run whose
    // engine_key still says sketch/trip-gen — an engine/provenance mismatch on
    // a claim-boundary surface. Relaunch those engines via POST /runs instead.
    if (modelRun.engine_key === "sketch_abm" || modelRun.engine_key === "ite_trip_generation") {
      return NextResponse.json(
        {
          error:
            "This run's engine executes in-process and cannot be re-queued to the worker. Launch a new run from the model or scenario entry instead.",
        },
        { status: 409 }
      );
    }

    /**
     * ============ THE `launch_model_run` ACTION, REGISTERED 2026-08-08 ========
     *
     * The approval tier is `approval_required`, and it is enforced HERE. A
     * "registered" action whose route never verifies its own approval
     * type-checks fine and executes with the tier enforced only in the browser.
     *
     * The action is rebuilt from the ROUTE'S OWN verified values — the workspace
     * off the model this caller was granted access to, and the two ids parsed
     * out of the path — never from the request body. The hash must cover what
     * this route will actually do, not what the caller says it approved.
     *
     * THE BODY IS SCOPE-CHECKED even though this route reads nothing from it.
     * The approval hash covers the ACTION, so a request carrying the action's
     * fields plus extras hashes identically to what the planner approved; a
     * future edit that starts reading a body key would silently inherit that
     * hole. `workspaceId` is the only key the effect sends.
     */
    const executionSource = readAssistantExecutionSource(request);
    const agentSourced = executionSource === "planner_agent_quick_link";
    let approval: AssistantApprovalVerification = {
      approvalId: null,
      inputHash: null,
      authorship: null,
    } as unknown as AssistantApprovalVerification;

    if (agentSourced) {
      // Through the shared limited reader, never an unbounded read:
      // `body-limit-route-inventory.test.ts` forbids a mutating route pulling
      // the body directly off the request, and it caught this the first time
      // this block was written. (The guard scans source text, so naming the
      // forbidden call here — even to warn against it — trips it too.)
      const bodyRead = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
      if (!bodyRead.ok) return bodyRead.response;
      const agentBody = (bodyRead.data ?? {}) as Record<string, unknown>;
      const scopeRefusal = refuseOutOfScopeAgentRequest({
        executionSource,
        body: agentBody,
        allowedKeys: AGENT_LAUNCH_BODY_KEYS,
        actionKind: "launch_model_run",
      });
      if (scopeRefusal) {
        audit.warn("agent_request_out_of_scope", {
          modelId: access.model.id,
          modelRunId: modelRun.id,
          rejectedKeys: scopeRefusal.rejectedKeys,
        });
        return NextResponse.json(
          { error: scopeRefusal.error, details: scopeRefusal.details },
          { status: 400 }
        );
      }

      try {
        approval = await verifyAssistantActionApproval({
          request,
          serviceSupabase: createServiceRoleClient(),
          userId: user.id,
          workspaceId: workspaceId as string,
          action: {
            kind: "launch_model_run",
            workspaceId: workspaceId as string,
            modelId: access.model.id,
            modelRunId: modelRun.id,
          },
        });
      } catch (approvalError) {
        audit.warn("agent_approval_rejected", {
          modelId: access.model.id,
          modelRunId: modelRun.id,
        });
        return NextResponse.json(
          {
            error:
              approvalError instanceof Error ? approvalError.message : "Planner Agent approval failed",
          },
          { status: 403 }
        );
      }
    }

    const nowIso = new Date().toISOString();

    // ── Rebuild the run's demographic inputs, because a relaunch that did not
    // was a recovery instruction that could never work ──────────────────────
    //
    // `input_snapshot_json.zoneAttributes` is the pointer the worker follows to
    // this run's zone demographics, and it is a snapshot of ONE read — taken
    // with whatever Census key the workspace had at the moment of the original
    // launch. This route used to re-queue the row and leave that stamp alone, so
    // a run stamped `{status: "unavailable", reason: "No US Census API key…"}`
    // re-read the same refusal on every relaunch. "Add a key under Settings →
    // Integrations, then relaunch" is the obvious recovery, and it is what the
    // worker's own error text tells the planner to do — and it provably could
    // not succeed. Telling someone to do something that cannot work is a false
    // statement, not a rough edge, so the payload is rebuilt here instead.
    //
    // This runs BEFORE the status flip: a run whose inputs could not be rebuilt
    // must not be sitting in the queue for a worker to claim.
    const priorSnapshot =
      (modelRun.input_snapshot_json as Record<string, unknown> | null) ?? {};

    // Same resolution the run was originally built at. Read from the snapshot
    // rather than re-derived, so a relaunch of a stamped run cannot quietly
    // change the zone geography — and stamped back below so the app's fetch and
    // the worker's `resolve_zone_geography` cannot disagree.
    //
    // HONEST LIMIT: a run launched BEFORE the stamp existed carries no
    // `zoneGeography`, and the worker resolved its own `AEQ_ZONE_GEOGRAPHY` env
    // for it. There is no record here of what that env said, so relaunching such
    // a run pins it to "tract" — which, on a deployment that set that env to
    // block_group, rebuilds the cached package at the coarser resolution. Every
    // run launched since the stamp shipped is unaffected; the alternative
    // (leaving it unstamped) would let the worker build zones at one resolution
    // against the table this route is about to read at another.
    const zoneGeography: ZoneAttributeLevel =
      priorSnapshot.zoneGeography === "block_group" ? "block_group" : "tract";

    let refreshedSnapshot = priorSnapshot;
    let zoneAttributes: ZoneAttributeStamp | null = null;

    // ── Re-resolve the transit feed this run models from ──────────────────
    //
    // Same argument as the demographics above, and the same shape of broken
    // recovery if it is skipped. The stamp remembers the FEED the planner
    // chose, never the version — so a run stamped "the archive behind this
    // feed's current ingest was not kept" becomes `selected` after they bring
    // the feed in again, with nothing to pick a second time. Re-stamping the
    // stored version id instead would pin the run to an ingest that is no
    // longer the one this workspace analyses with.
    //
    // Runs before the stamp existed carry no `transitFeed` key; those resolve
    // to `not_selected`, which is what they always behaved as.
    //
    // NOT gated on `corridor_geojson`: a run with no study area still records
    // which feed was named, and the coverage pre-check inside the handoff is
    // the part that needs geometry (it answers `not_determined` without it).
    const transitFeed: TransitFeedStamp = await prepareTransitFeedHandoff({
      client: supabase,
      workspaceId,
      feedId: transitFeedIdFromSnapshot(priorSnapshot),
      corridorGeojson: modelRun.corridor_geojson,
      launchDateIso: nowIso,
    });

    if (transitFeed.status !== "selected" && transitFeed.status !== "not_selected") {
      audit.warn("transit_feed_handoff_unavailable", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
        status: transitFeed.status,
        feedId: transitFeed.feedId,
        reason: transitFeed.reason,
      });
    }

    // A run with no study-area geometry has nothing to resolve demographics
    // for, and the worker refuses it by name ("This run has no study area…").
    // Rebuilding a stamp for it would only replace one true reason with another.
    if (modelRun.corridor_geojson) {
      // Inside the workspace's integration context, or `censusApiKey()` cannot
      // see the workspace's own key and the rebuild would silently answer from
      // the deployment env — the same precedence the initial launch uses.
      zoneAttributes = await withWorkspaceIntegrationContext(workspaceId, () =>
        prepareWorkerZoneAttributes({
          modelRunId: modelRun.id,
          corridorGeojson: modelRun.corridor_geojson,
          zoneGeography,
        })
      );

      refreshedSnapshot = {
        ...priorSnapshot,
        zoneGeography,
        zoneAttributes,
        relaunchedAt: nowIso,
      };

      if (zoneAttributes.status !== "supplied") {
        // Not a launch failure — the worker may still have a key of its own —
        // but it is the leading cause of a dead worker run, and after a relaunch
        // it is also the answer to "did adding the key help?".
        audit.warn("zone_attribute_handoff_unavailable", {
          modelId: access.model.id,
          modelRunId: modelRun.id,
          status: zoneAttributes.status,
          keyOrigin: zoneAttributes.keyOrigin,
          reason: zoneAttributes.reason ?? zoneAttributes.demographics.reason,
        });
      }
    }

    // Merged for EVERY relaunch, including one whose study area is missing and
    // whose demographics were therefore not rebuilt. A run that cannot resolve
    // zones still has a transit selection worth recording, and leaving the
    // prior stamp in place is how a stale refusal outlives the thing that
    // caused it — the exact defect the demographics rebuild above exists to fix.
    refreshedSnapshot = { ...refreshedSnapshot, transitFeed };

    // Update run to queued and clear stale prior-run residue.
    // result_summary_json is NOT NULL DEFAULT '{}' — reset to {}, never null.
    // `.select(...).maybeSingle()` is not decoration: without it PostgREST
    // reports a write that matched zero rows as success, and this one carries
    // the rebuilt inputs the whole recovery depends on.
    const requeue = await supabase
      .from("model_runs")
      .update({
        status: "queued",
        updated_at: nowIso,
        started_at: null,
        completed_at: null,
        error_message: null,
        result_summary_json: {},
        source_analysis_run_id: null,
        input_snapshot_json: refreshedSnapshot,
      })
      .eq("id", modelRun.id)
      .select("id")
      .maybeSingle();

    if (isWriteFailure(requeue.error)) {
      audit.error("model_run_requeue_failed", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
        message: requeue.error?.message ?? null,
        code: requeue.error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to queue model run" }, { status: 500 });
    }

    if (writeMatchedNoRows(requeue)) {
      // This route already read this exact row through the caller's own client
      // and passed every membership and role check, so zero rows here is the
      // database disagreeing with the application — a policy gap, not a missing
      // run. `targetWasVerified` makes the answer say that instead of inventing
      // a 404 for a run the caller just saw.
      audit.error("model_run_requeue_matched_no_rows", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
      });
      return noRowsMatchedResponse({ subject: "model run", targetWasVerified: true });
    }

    // Create the first stage if it doesn't exist, or reset it.
    //
    // THIS READ IS THE DECISION, so a failed one cannot be waved through. It
    // arrives as the same `null` an empty table produces, and `null` picks the
    // INSERT branch — while `model_run_stages` carries no unique key on
    // (run_id, stage_name), only a PK on `id` and an index on (run_id,
    // sort_order). A relaunch whose stage read failed therefore lays a second
    // full set of queued stages over the ones already there: the run's progress
    // list shows every stage twice, the originals keep whatever status the
    // prior attempt left them at because the reset branch never ran, and
    // nothing downstream can tell the duplicates apart afterwards. Refusing
    // the relaunch is the only answer that does not corrupt the run.
    const stagesResult = await supabase
      .from("model_run_stages")
      .select("id")
      .eq("run_id", modelRun.id);

    const stagesFailure = classifyRouteReadFailure("model run stages", stagesResult);
    if (stagesFailure) {
      audit.error("model_run_stage_lookup_failed", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
        message: stagesFailure.message,
      });
      return NextResponse.json(stagesFailure.body, { status: stagesFailure.status });
    }

    const existingStages = stagesResult.data;

    // Engine-aware stage names, from the one place that owns them. The
    // behavioral_demand lane adds an ActivitySim preflight stage (owned by the
    // activitysim_worker) after the three AequilibraE assignment stages.
    const stageNames = workerRunStageNames(modelRun.engine_key);

    if (!existingStages || existingStages.length === 0) {
      const { error: stageInsertError } = await supabase
        .from("model_run_stages")
        .insert(queuedStageRows(modelRun.id, stageNames));

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

    // The claim-tier evidence rows are deleted ALONGSIDE the KPIs they grade.
    // The worker writes `modeling_claim_decisions` / `modeling_validation_results`
    // mid-run (inside Artifact Extraction, before the run's terminal status is
    // decided), so a run that failed after that point already carries a tier —
    // including `calibrated_to_counts`. Leaving those rows here while deleting
    // the KPIs let a relaunch that died early display a calibrated badge over
    // outputs this route had destroyed: a tier with no evidence under it. A
    // failed delete refuses the relaunch for the same reason the KPI delete
    // does — proceeding would requeue a run still wearing its old grade.
    const [
      { error: artifactDeleteError },
      { error: kpiDeleteError },
      { error: claimDecisionDeleteError },
      { error: validationResultDeleteError },
    ] = await Promise.all([
      supabase.from("model_run_artifacts").delete().eq("run_id", modelRun.id),
      supabase.from("model_run_kpis").delete().eq("run_id", modelRun.id),
      supabase.from("modeling_claim_decisions").delete().eq("model_run_id", modelRun.id),
      supabase.from("modeling_validation_results").delete().eq("model_run_id", modelRun.id),
    ]);

    if (artifactDeleteError || kpiDeleteError || claimDecisionDeleteError || validationResultDeleteError) {
      audit.error("model_run_cleanup_failed", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
        artifactDeleteMessage: artifactDeleteError?.message ?? null,
        artifactDeleteCode: artifactDeleteError?.code ?? null,
        kpiDeleteMessage: kpiDeleteError?.message ?? null,
        kpiDeleteCode: kpiDeleteError?.code ?? null,
        claimDecisionDeleteMessage: claimDecisionDeleteError?.message ?? null,
        claimDecisionDeleteCode: claimDecisionDeleteError?.code ?? null,
        validationResultDeleteMessage: validationResultDeleteError?.message ?? null,
        validationResultDeleteCode: validationResultDeleteError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to clear prior run artifacts" }, { status: 500 });
    }

    // The stages are queued again, so ring the worker's doorbell exactly as the
    // first launch does. Ordering matters and is the same both times: the rows
    // are back in `queued` and the PRIOR run's artifacts and KPIs are already
    // deleted before anything is pushed — a worker that answers instantly must
    // not have this route delete the outputs it has just started writing. The
    // push claims
    // nothing — the worker still takes each stage with the atomic conditional
    // update, so a pushed worker and a polling one cannot both execute this run.
    // A push that does not land leaves the pre-existing behaviour untouched: a
    // requeued run waiting for a poller.
    /**
     * THE LEDGER ROW, written for the AGENT path only and written DIRECTLY
     * rather than through `withAssistantActionAudit`.
     *
     * The wrapper decides success by whether the body threw, and this route
     * does not throw for ordinary failures — it RETURNS a NextResponse with a
     * status for each one. Wrapping it would stamp `outcome: 'succeeded'` on a
     * relaunch that answered 500, and a ledger that misreports outcomes is
     * worse than one missing rows, because it is believed.
     *
     * It is written HERE, once the run is queued, because that is the point at
     * which the action has actually happened. The refusals above return an
     * error to the agent and are recorded by this route's own audit logger; a
     * refused approval is not an executed action.
     *
     * The manual path writes no row on purpose: `action_kind` is a claim that
     * this was a Planner Agent action, and stamping it on a relaunch a person
     * clicked would be false.
     */
    if (agentSourced) {
      const metadata = getActionMetadata("launch_model_run");
      const { error: ledgerError } = await recordAssistantActionExecution(createServiceRoleClient(), {
        workspaceId: workspaceId as string,
        userId: user.id,
        actionKind: "launch_model_run",
        auditEvent: metadata.auditEvent,
        approval: metadata.approval,
        regrounding: metadata.regrounding,
        outcome: "succeeded",
        inputSummary: {
          modelId: access.model.id,
          modelRunId: modelRun.id,
          // The engine and resolution this relaunch RAN AT, recorded so the
          // ledger shows that neither was chosen by the agent.
          engineKey: modelRun.engine_key ?? null,
          zoneGeography,
        },
        approvalId: approval.approvalId,
        inputHash: approval.inputHash,
        executionSource,
        authorship: approval.authorship,
        startedAt: nowIso,
        completedAt: new Date().toISOString(),
      });
      if (ledgerError) {
        audit.warn("agent_ledger_row_failed", {
          modelRunId: modelRun.id,
          message: ledgerError.message,
        });
      }
    }

    const dispatch = await dispatchModelRun(
      buildModelRunDispatchPayload({
        requestId: crypto.randomUUID(),
        runId: modelRun.id,
        engineKey: modelRun.engine_key ?? "aequilibrae",
        stageNames: [...stageNames],
      })
    );

    if (dispatch.state === "accepted") {
      audit.info("model_run_pushed_to_worker", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
        workerHost: dispatch.workerHost,
        jobReference: dispatch.jobReference,
      });
    } else if (dispatch.state === "dispatch_failed") {
      audit.error("model_run_push_failed", {
        modelId: access.model.id,
        modelRunId: modelRun.id,
        workerHost: dispatch.workerHost,
        detail: dispatch.detail,
      });
    }

    audit.info("model_run_launched", {
      modelId: access.model.id,
      modelRunId: modelRun.id,
      zoneAttributeStatus: zoneAttributes?.status ?? "not_rebuilt",
      transitFeedStatus: transitFeed.status,
      dispatchState: dispatch.state,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        success: true,
        status: "queued",
        // Additive, and deliberately not silent. A relaunch is usually the
        // second half of "add a Census key, then relaunch", so whether the
        // rebuild above actually read this study area's demographics is the
        // answer to the question the planner just asked.
        //
        // NOT YET RENDERED: the only caller today, the relaunch button in
        // `components/models/model-run-evidence-panel.tsx`, reads `error` and
        // `executionOutlook` off this body and nothing else — so a planner still
        // learns the demographic-rebuild outcome from the worker's failure
        // minutes later, not from here. This field is what a surface would read;
        // it is not itself that surface, and it must not be described as one
        // until the panel shows it.
        zoneAttributes: zoneAttributes
          ? {
              status: zoneAttributes.status,
              keyOrigin: zoneAttributes.keyOrigin,
              reason: zoneAttributes.reason ?? zoneAttributes.demographics.reason,
            }
          : null,
        // The transit selection this relaunch just re-resolved. UNLIKE
        // `zoneAttributes` above, this one IS rendered: the relaunch button in
        // `components/models/model-run-evidence-panel.tsx` reads it and prints
        // the reason, because a planner who re-ingested their feed in order to
        // fix a run needs to learn here whether it worked — not from the
        // worker's transit stage some minutes later.
        transitFeed: {
          status: transitFeed.status,
          agencyName: transitFeed.agencyName,
          scheduleExpiredAtLaunch: transitFeed.scheduleExpiredAtLaunch,
          coversStudyArea: transitFeed.coversStudyArea,
          reason: transitFeed.reason,
        },
        // The raw dispatch outcome, for a caller that wants to decide for itself.
        dispatch,
        // ...and the sentence a planner reads, resolved HERE rather than by the
        // caller. The relaunch button lives in the evidence panel, which is
        // handed a run and nothing about the deployment — and the outlook is
        // meaningless without the worker declaration, because "nothing took it"
        // reads completely differently on a deployment that declares a poller
        // and one that declares none. Resolving it client-side would have meant
        // threading the declaration into a component two pages deep, and a
        // default of "undeclared" there would print "nothing declares whether a
        // worker polls this deployment" at a deployment that had declared
        // exactly that. The server already knows; it answers.
        executionOutlook: describeModelRunDispatch(dispatch, resolveModelingWorkerDeclaration()),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("model_run_launch_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error launching model run" }, { status: 500 });
  }
}
