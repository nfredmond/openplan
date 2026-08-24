import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  readAssistantExecutionSource,
  verifyAssistantActionApproval,
  type AssistantApprovalVerification,
} from "@/lib/assistant/action-approval-server";
import { assistantActionAuditIdentity, withAssistantActionAudit } from "@/lib/observability/action-audit";
import { refuseOutOfScopeAgentRequest } from "@/lib/assistant/agent-request-scope";
import { USER_AUTHORED } from "@/lib/assistant/agent-principal";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { insertNotReadableBackResponse, isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { describeOffVocabularyGate, lookupStageGateInTemplate } from "@/lib/stage-gates/gate-vocabulary";
import { resolveWorkspaceStageGateBinding } from "@/lib/stage-gates/template-loader";

/**
 * The stage-gate decision log — read it, and (now) write it.
 *
 * WHAT WAS MISSING. This route exported GET and nothing else, so no human could
 * record a gate decision at all. The only thing that ever wrote to
 * `stage_gate_decisions` was the report-export path, and it wrote a gate id
 * (`report_artifact_gate`) that belongs to no template's gate order, so every
 * row it produced was invisible to every reader. A planner therefore looked at a
 * nine-gate compliance cockpit whose every gate said "no decision" and had no
 * control anywhere in the product that could change that. The board was a
 * display for a workflow with no input.
 *
 * That was the spine's missing upward edge. A project hands its id and its study
 * area DOWN to a run; nothing came back as a judgement. POST is that edge: a
 * decision names the project it is about, may cite the run it turned on
 * (Analysis Studio, worker model, or county validation — the same three
 * `report_runs` cites), and states a rationale that is required, not optional.
 *
 * APPEND-ONLY, and there is no PATCH or DELETE here on purpose. A recorded PASS
 * that turns out to be wrong is corrected by recording the HOLD that supersedes
 * it — the board reads the LATEST decision per gate — never by editing the
 * verdict someone signed. The database agrees: 20260306000010 grants SELECT and
 * INSERT and nothing else.
 */

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The columns every decision surface reads. Kept in one constant because the
 * Supabase clients here are deliberately untyped — a column named in a `.select()`
 * string is not checked against the schema, so a typo surfaces at runtime, and
 * one list is one place for that to be wrong.
 */
const DECISION_COLUMNS =
  "id, workspace_id, project_id, run_id, model_run_id, county_run_id, template_id, gate_id, decision, rationale, missing_artifacts, metadata, decided_by, decided_at";

const createDecisionSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  gateId: z.string().trim().min(1).max(200),
  decision: z.enum(["PASS", "HOLD"]),
  // Required and non-empty, matching the NOT NULL column. A gate decision with
  // no stated reason is a verdict nobody can review, which is the thing a
  // stage-gate process exists to prevent.
  rationale: z.string().trim().min(1).max(4000),
  /** Evidence ids the decider believes are still outstanding. Free-form on purpose:
   *  a template's evidence ids are one source of these, an agency's own checklist
   *  is another, and constraining it to the template would silently drop the second. */
  missingArtifacts: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  // At most one, and validated below rather than in the schema so the refusal can
  // name the rule instead of emitting a shape error.
  runId: z.string().uuid().optional(),
  modelRunId: z.string().uuid().optional(),
  countyRunId: z.string().uuid().optional(),
});

/**
 * Exactly the body keys the `record_stage_gate_hold` action maps onto this
 * endpoint. `decision` is in the list because the route requires it — and is
 * separately pinned to HOLD below, because being ALLOWED to send the key is not
 * the same as being allowed to send either value.
 */
const AGENT_HOLD_BODY_KEYS = [
  "workspaceId",
  "projectId",
  "gateId",
  "decision",
  "rationale",
  "missingArtifacts",
  "runId",
  "modelRunId",
  "countyRunId",
] as const;

/** The three run tables a decision may cite, and where each one lives. */
const RUN_CITATION_TABLES = {
  runId: { table: "runs", column: "run_id", label: "analysis run" },
  modelRunId: { table: "model_runs", column: "model_run_id", label: "model run" },
  countyRunId: { table: "county_runs", column: "county_run_id", label: "county run" },
} as const;

type RunCitationKey = keyof typeof RUN_CITATION_TABLES;

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("stage_gates.decisions.get", request);
  const startedAt = Date.now();

  const parsed = querySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get("workspaceId"),
    projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
    runId: request.nextUrl.searchParams.get("runId") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    audit.warn("validation_failed", { issues: parsed.error.issues });
    return NextResponse.json({ error: "Invalid stage-gate decision query" }, { status: 400 });
  }

  const { workspaceId, projectId, runId, limit } = parsed.data;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", {
        workspaceId,
        runId: runId ?? null,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        workspaceId,
        runId: runId ?? null,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });

      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership) {
      audit.warn("forbidden_workspace", {
        workspaceId,
        runId: runId ?? null,
        userId: user.id,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("stage_gates.decisions.read", membership.role)) {
      audit.warn("forbidden_role", {
        workspaceId,
        runId: runId ?? null,
        userId: user.id,
        role: membership.role ?? null,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    let decisionQuery = supabase
      .from("stage_gate_decisions")
      .select(DECISION_COLUMNS)
      .eq("workspace_id", workspaceId);

    // Project scoping is a filter the caller asks for, not a default: rows
    // written before 20260728000011 carry no project, and defaulting to "this
    // project" would hide them from the only query that can still find them.
    if (projectId) {
      decisionQuery = decisionQuery.eq("project_id", projectId);
    }

    if (runId) {
      decisionQuery = decisionQuery.eq("run_id", runId);
    }

    const { data, error } = await decisionQuery
      .order("decided_at", { ascending: false })
      .limit(limit);

    if (error) {
      audit.error("decision_query_failed", {
        workspaceId,
        projectId: projectId ?? null,
        runId: runId ?? null,
        userId: user.id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to fetch stage-gate decisions" }, { status: 500 });
    }

    audit.info("decisions_fetched", {
      workspaceId,
      projectId: projectId ?? null,
      runId: runId ?? null,
      userId: user.id,
      rowCount: data?.length ?? 0,
      limit,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ decisions: data ?? [] }, { status: 200 });
  } catch (error) {
    audit.error("decisions_unhandled_error", {
      workspaceId,
      runId: runId ?? null,
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while fetching decisions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("stage_gates.decisions.create", request);
  const startedAt = Date.now();

  try {
    // normalJson rather than smallJson: a 4,000-character rationale plus up to
    // fifty evidence ids is ~15 KB before JSON escaping, which sits right on the
    // 16 KB smallJson edge — and a 413 on a decision someone just wrote out is a
    // bad way to lose their words.
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;

    const parsed = createDecisionSchema.safeParse(body.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid stage-gate decision" }, { status: 400 });
    }

    const { workspaceId, projectId, gateId, decision, rationale } = parsed.data;

    /**
     * Whether this request came through the Planner Agent seam, and — if so —
     * whether it stayed inside what an agent is allowed to sign.
     *
     * Both checks run BEFORE any database work, because both are refusals about
     * the request itself rather than about the workspace's state, and a refusal
     * that costs four round trips first is a refusal that invites being skipped.
     */
    const executionSource = readAssistantExecutionSource(request);
    const scopeRefusal = refuseOutOfScopeAgentRequest({
      executionSource,
      body: body.data,
      allowedKeys: AGENT_HOLD_BODY_KEYS,
      actionKind: "record_stage_gate_hold",
    });
    if (scopeRefusal) {
      audit.warn("agent_request_out_of_scope", {
        workspaceId,
        projectId,
        rejectedKeys: scopeRefusal.rejectedKeys,
      });
      return NextResponse.json(
        { error: scopeRefusal.error, details: scopeRefusal.details },
        { status: 400 }
      );
    }

    /**
     * AN AGENT MAY NOT SIGN A PASS.
     *
     * The registered action carries no `decision` field and its effect transmits
     * the HOLD literal, so a payload cannot express a PASS. This is the second,
     * independent refusal, and it is the one that matters: the type lives in the
     * browser bundle, and anything holding a session cookie can post whatever
     * body it likes with the agent header attached. A PASS is the affirmative
     * verdict a board or a funder acts on, recorded under `decided_by = a
     * person`. A HOLD is conservative and supersedable. The asymmetry is the
     * rule, not the tier.
     */
    if (executionSource === "planner_agent_quick_link" && decision !== "HOLD") {
      audit.warn("agent_pass_refused", { workspaceId, projectId, gateId });
      return NextResponse.json(
        {
          error: "The Planner Agent may not record a gate PASS",
          details:
            "An affirmative stage-gate verdict is a person's signature — it is what a board or a funder " +
            "relies on to let a project advance. The Planner Agent can propose a HOLD, with its rationale " +
            "and cited evidence, and a person records the PASS that clears it.",
        },
        { status: 403 }
      );
    }

    const citedRunKeys = (Object.keys(RUN_CITATION_TABLES) as RunCitationKey[]).filter(
      (key) => parsed.data[key]
    );

    // The database enforces at most one citation too (a CHECK in 20260728000011),
    // but a constraint violation would come back as an opaque 500. Refusing here
    // lets the answer say which rule was broken.
    if (citedRunKeys.length > 1) {
      audit.warn("multiple_run_citations", { workspaceId, projectId, gateId, citedRunKeys });
      return NextResponse.json(
        {
          error: "A gate decision may cite at most one run",
          details:
            "This decision named more than one of analysis run, model run, and county run. " +
            "A gate turns on one piece of evidence at a time; record the run the decision " +
            "actually rested on, and cite the others in the rationale.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { workspaceId, durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        workspaceId,
        projectId,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership) {
      audit.warn("forbidden_workspace", { workspaceId, projectId, userId: user.id });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // The role matrix already has an action for this; it simply had no writer.
    // Viewers are additionally denied at the database by the restrictive gate
    // 20260728000006 installed on this table, so this is the readable refusal
    // rather than the only one.
    if (!canAccessWorkspaceAction("stage_gates.decisions.write", membership.role)) {
      audit.warn("forbidden_role", {
        workspaceId,
        projectId,
        userId: user.id,
        role: membership.role ?? null,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // Read the project and its workspace's template binding through the CALLER's
    // client. Two things ride on this read: the project must be in the workspace
    // the decision claims (a CHECK enforces it, but a 400 here reads better than
    // a constraint violation), and the gate id must belong to the template this
    // workspace is actually bound to.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (projectError) {
      audit.error("project_lookup_failed", {
        workspaceId,
        projectId,
        userId: user.id,
        message: projectError.message,
        code: projectError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load the project" }, { status: 500 });
    }

    if (!project) {
      audit.warn("project_not_found", { workspaceId, projectId, userId: user.id });
      return NextResponse.json(
        {
          error: "No such project",
          details:
            "No project you can reach in this workspace matched this decision, so nothing was recorded.",
        },
        { status: 404 }
      );
    }

    // The home-geography columns come along for the same reason the project page
    // reads them: the stored template id carries a database default, so only the
    // workspace's own jurisdiction can tell a template that was MATCHED to this
    // agency from one merely ASSUMED for it — and that distinction is recorded on
    // the decision. A deployment predating those columns rejects the extended
    // select, so the read falls back and the binding resolves as "jurisdiction
    // unknown", which is a disclosed fallback rather than a guess.
    const workspaceCoreColumns = "id, stage_gate_template_id";
    const workspaceRead = await supabase
      .from("workspaces")
      .select(
        `${workspaceCoreColumns}, stage_gate_template_selection, home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code`
      )
      .eq("id", workspaceId)
      .maybeSingle();
    const workspaceFallbackRead = workspaceRead.error
      ? await supabase.from("workspaces").select(workspaceCoreColumns).eq("id", workspaceId).maybeSingle()
      : null;

    if (workspaceRead.error && workspaceFallbackRead?.error) {
      audit.error("workspace_lookup_failed", {
        workspaceId,
        projectId,
        userId: user.id,
        message: workspaceFallbackRead.error.message,
        code: workspaceFallbackRead.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load the workspace" }, { status: 500 });
    }

    const workspaceRow = workspaceRead.error ? workspaceFallbackRead?.data : workspaceRead.data;

    const bindingResolution = resolveWorkspaceStageGateBinding(workspaceRow);
    if (bindingResolution.kind !== "resolved") {
      // The workspace points at a template this deployment does not register, or
      // no template is registered at all. Recording against an unresolvable
      // template would produce a row no board could ever interpret.
      audit.warn("template_unresolved", {
        workspaceId,
        projectId,
        userId: user.id,
        resolution: bindingResolution.kind,
      });
      return NextResponse.json(
        {
          error: "This workspace has no resolvable stage-gate template",
          details:
            bindingResolution.kind === "unknown_template"
              ? `This workspace is bound to "${bindingResolution.requestedTemplateId}", which this deployment does not register. A decision recorded against it could not be shown on any gate board.`
              : "No stage-gate template is registered in this deployment, so there are no gates to decide.",
        },
        { status: 409 }
      );
    }

    const binding = bindingResolution.binding;
    const lookup = lookupStageGateInTemplate(binding.templateId, gateId);

    if (lookup.kind !== "gate") {
      audit.warn("gate_off_vocabulary", {
        workspaceId,
        projectId,
        userId: user.id,
        templateId: binding.templateId,
        gateId,
      });
      return NextResponse.json(
        {
          error: "Unknown stage gate",
          details:
            lookup.kind === "off_vocabulary"
              ? describeOffVocabularyGate(lookup)
              : `The stage-gate template "${lookup.templateId}" is not registered in this deployment.`,
        },
        { status: 400 }
      );
    }

    // Verify any cited run belongs to this workspace before writing. The same
    // rule is a CHECK constraint, so this is not the security boundary — it is
    // what lets the refusal say "that run is not in this workspace" instead of
    // surfacing a constraint name.
    for (const key of citedRunKeys) {
      const citation = RUN_CITATION_TABLES[key];
      const citedId = parsed.data[key] as string;
      const { data: runRow, error: runError } = await supabase
        .from(citation.table)
        .select("id")
        .eq("id", citedId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (runError) {
        audit.error("run_citation_lookup_failed", {
          workspaceId,
          projectId,
          userId: user.id,
          table: citation.table,
          message: runError.message,
          code: runError.code ?? null,
        });
        return NextResponse.json({ error: `Failed to verify the cited ${citation.label}` }, { status: 500 });
      }

      if (!runRow) {
        audit.warn("run_citation_not_found", {
          workspaceId,
          projectId,
          userId: user.id,
          table: citation.table,
        });
        return NextResponse.json(
          {
            error: `No such ${citation.label}`,
            details: `The cited ${citation.label} is not one this workspace can reach, so the decision was not recorded.`,
          },
          { status: 404 }
        );
      }
    }

    const missingArtifacts = (parsed.data.missingArtifacts ?? []).filter(
      (artifact) => artifact.trim().length > 0
    );

    /**
     * Approval evidence, verified against the action this route rebuilds from
     * its OWN parsed data — never from the header. The hash therefore covers the
     * exact wording that is about to be written, so an approval minted for one
     * rationale cannot execute a different one.
     *
     * `missingArtifacts` is hashed in its FILTERED form, matching what the chat
     * proposal trims before validation; an unfiltered list here would hash
     * differently from the payload the planner approved and 403 inexplicably.
     */
    const agentSourced = executionSource === "planner_agent_quick_link";
    const serviceSupabase = agentSourced ? createServiceRoleClient() : null;
    let approval: AssistantApprovalVerification = {
      approvalId: null,
      inputHash: null,
      executionSource: "manual",
      authorship: USER_AUTHORED,
    };

    if (agentSourced && serviceSupabase) {
      try {
        approval = await verifyAssistantActionApproval({
          request,
          serviceSupabase,
          userId: user.id,
          workspaceId,
          action: {
            kind: "record_stage_gate_hold",
            workspaceId,
            projectId,
            gateId,
            rationale,
            ...(missingArtifacts.length > 0 ? { missingArtifacts } : {}),
            ...(parsed.data.runId ? { runId: parsed.data.runId } : {}),
            ...(parsed.data.modelRunId ? { modelRunId: parsed.data.modelRunId } : {}),
            ...(parsed.data.countyRunId ? { countyRunId: parsed.data.countyRunId } : {}),
          },
        });
      } catch (approvalError) {
        audit.warn("agent_approval_rejected", { workspaceId, projectId, gateId });
        return NextResponse.json(
          { error: approvalError instanceof Error ? approvalError.message : "Planner Agent approval failed" },
          { status: 403 }
        );
      }
    }

    /**
     * WHO WROTE THIS VERDICT, on the verdict itself.
     *
     * `decided_by` stays the person: they are accountable for it, and the
     * database's own policies are written around that column. What was missing
     * is that a decision a model drafted looked byte-identical to one a planner
     * typed. When a gate decision is challenged — and a gate decision is exactly
     * the kind of record that gets challenged — the answer to "who wrote this"
     * has to come off the row, not out of a separate ledger somebody has to know
     * to join.
     */
    const authorship = approval.authorship;

    const insertDecision = async () => await supabase
      .from("stage_gate_decisions")
      .insert({
        workspace_id: workspaceId,
        project_id: project.id,
        gate_id: lookup.gate.gate_id,
        // Stamped from the binding that was validated against, not from the
        // request: a gate id is only interpretable inside its own template, and
        // that association cannot be reconstructed after a workspace rebinds.
        template_id: lookup.templateId,
        decision,
        rationale,
        missing_artifacts: missingArtifacts,
        run_id: parsed.data.runId ?? null,
        model_run_id: parsed.data.modelRunId ?? null,
        county_run_id: parsed.data.countyRunId ?? null,
        metadata: {
          source: "api.stage_gates.decisions",
          templateVersion: lookup.templateVersion,
          gateName: lookup.gate.name,
          gateSequence: lookup.gate.sequence,
          // Whether the workspace CHOSE this jurisdiction's gates or inherited
          // the labeled interim default. Recorded on the decision because the
          // binding can change later, and a decision made under assumed gates
          // must stay identifiable as one.
          templateSelection: binding.templateSelection,
          authorship: {
            actorKind: authorship.actorKind,
            agentId: authorship.actorAgentId,
            approvedByUserId: authorship.approvedByUserId,
            approvedAt: authorship.approvedAt,
            approvalId: approval.approvalId,
            inputHash: approval.inputHash,
          },
        },
        decided_by: user.id,
      })
      .select(DECISION_COLUMNS)
      .single();

    /**
     * The ledger row is written for the AGENT path only, and that asymmetry is
     * deliberate rather than an omission.
     *
     * `assistant_action_executions.action_kind` is a claim about what happened.
     * This endpoint records PASS as well as HOLD, and only the agent path is
     * pinned to HOLD — so wrapping a manual decision would stamp
     * `record_stage_gate_hold` on rows describing a PASS a person signed. A
     * mislabelled audit row is worse than an absent one. A manual decision is
     * already recorded twice over: in `stage_gate_decisions` itself, which is
     * append-only, and in this route's `decision_recorded` audit line.
     */
    const insertResult =
      agentSourced && serviceSupabase
        ? await withAssistantActionAudit(
            serviceSupabase,
            {
              actionKind: "record_stage_gate_hold",
              workspaceId,
              userId: user.id,
              ...assistantActionAuditIdentity(approval),
              inputSummary: {
                projectId: project.id,
                gateId: lookup.gate.gate_id,
                decision,
                citedRun: citedRunKeys[0] ?? null,
                missingArtifactCount: missingArtifacts.length,
              },
            },
            insertDecision
          )
        : await insertDecision();

    if (isWriteFailure(insertResult.error)) {
      audit.error("decision_insert_failed", {
        workspaceId,
        projectId,
        userId: user.id,
        gateId: lookup.gate.gate_id,
        decision,
        message: insertResult.error?.message ?? null,
        code: insertResult.error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to record the stage-gate decision" }, { status: 500 });
    }

    if (writeMatchedNoRows(insertResult)) {
      // The INSERT landed and the read-back came up empty. That is a policy
      // shape (INSERT granted, this row not SELECTable), never a failed write —
      // answering an error here would make the client retry and record the
      // decision twice. See src/lib/http/write-outcome.ts.
      audit.warn("decision_not_readable_back", {
        workspaceId,
        projectId,
        userId: user.id,
        gateId: lookup.gate.gate_id,
        decision,
      });
      return insertNotReadableBackResponse({ subject: "stage-gate decision" });
    }

    audit.info("decision_recorded", {
      workspaceId,
      projectId,
      userId: user.id,
      role: membership.role ?? null,
      templateId: lookup.templateId,
      gateId: lookup.gate.gate_id,
      decision,
      missingArtifactCount: missingArtifacts.length,
      citedRun: citedRunKeys[0] ?? null,
      actorKind: authorship.actorKind,
      actorAgentId: authorship.actorAgentId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ decision: insertResult.data }, { status: 201 });
  } catch (error) {
    audit.error("decision_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while recording the stage-gate decision" },
      { status: 500 }
    );
  }
}
