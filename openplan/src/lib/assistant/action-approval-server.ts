import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { canonicalizeActionPayload, getActionMetadata } from "@/lib/runtime/action-metadata";
import {
  plannerAgentAuthored,
  USER_AUTHORED,
  type AssistantActionAuthorship,
} from "@/lib/assistant/agent-principal";

export const ASSISTANT_ACTION_APPROVAL_TTL_MS = 5 * 60 * 1000;
export const ASSISTANT_ACTION_EXECUTION_SOURCE = "planner_agent_quick_link";

export const assistantApprovalActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("generate_report_artifact"),
    reportId: z.string().min(1),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_rtp_packet_record"),
    rtpCycleId: z.string().min(1),
    modelingCountyRunId: z.string().nullable().optional(),
    generateAfterCreate: z.boolean().optional(),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_funding_opportunity"),
    programId: z.string().optional(),
    projectId: z.string().optional(),
    title: z.string().min(1),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_project_funding_profile"),
    projectId: z.string().min(1),
    notes: z.string().optional(),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("update_funding_opportunity_decision"),
    opportunityId: z.string().min(1),
    decisionState: z.enum(["monitor", "pursue", "skip"]),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_project_record"),
    projectId: z.string().min(1),
    recordType: z.literal("submittal"),
    title: z.string().min(1),
    submittalType: z
      .enum(["authorization_packet", "invoice_backup", "environmental_package", "hearing_record", "ps_e", "reimbursement", "progress_report", "other"])
      .optional(),
    status: z.enum(["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"]).optional(),
    notes: z.string().optional(),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("record_stage_gate_hold"),
    workspaceId: z.string().min(1),
    projectId: z.string().min(1),
    gateId: z.string().min(1).max(200),
    // Matches the route's own rule: a gate decision with no stated reason is a
    // verdict nobody can review, and that goes double for one a model drafted.
    rationale: z.string().min(1).max(4000),
    missingArtifacts: z.array(z.string().min(1).max(200)).max(50).optional(),
    runId: z.string().min(1).optional(),
    modelRunId: z.string().min(1).optional(),
    countyRunId: z.string().min(1).optional(),
    // NOTE: there is no `decision` key here, and adding one would be a change to
    // what an agent is allowed to sign — not a schema tidy-up. See the union
    // variant in catalog.ts.
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("link_billing_invoice_funding_award"),
    workspaceId: z.string().min(1),
    invoiceId: z.string().min(1),
    fundingAwardId: z.string().min(1),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("launch_model_run"),
    // `.min(1)` and NOT `.uuid()`, matching every other branch in this union:
    // `action-registry-is-complete.test.ts` synthesises a minimal payload for
    // each kind out of `FALLBACK_VALUES`, none of which is a uuid, so a
    // `.uuid()` here reads as a branch nothing can satisfy and fails the build.
    // The uuid shape is enforced where it can also be acted on — the route
    // parses both ids with `z.string().uuid()` and answers 400 on either.
    workspaceId: z.string().min(1),
    modelId: z.string().min(1),
    modelRunId: z.string().min(1),
    // NOTE: there is deliberately no study-area, engine or zone-geography key
    // here, and adding one would be a change to what an agent may decide about
    // a model rather than a schema tidy-up. See the union variant in catalog.ts.
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("refresh_gtfs_feed"),
    // `.min(1)` and NOT `.uuid()`, matching every other branch in this union.
    // `action-registry-is-complete.test.ts` synthesises a minimal payload for
    // each kind out of `FALLBACK_VALUES`, none of which is a uuid, so a
    // `.uuid()` field here reads as a branch nothing can satisfy and fails the
    // build. The uuid shape is enforced where it can also be acted on: the route
    // parses both ids with `z.string().uuid()` and answers 400 on either.
    workspaceId: z.string().min(1),
    gtfsFeedId: z.string().min(1),
    // NOTE: there is no `adoptDespiteCollapse` key here, and adding one would be
    // a change to what an agent is allowed to decide — not a schema tidy-up. See
    // the union variant in catalog.ts.
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_survey_question_draft"),
    workspaceId: z.string().min(1),
    campaignId: z.string().min(1),
    // The type vocabulary is the route's to enforce (it has the registry that
    // defines them and can say which one was wrong); this branch only has to
    // agree on the shape.
    questionType: z.string().min(1),
    // Bounded here as well as at the route, because this is what gets HASHED:
    // an approval sheet a planner cannot read in full is not consent.
    prompt: z.string().min(1).max(2000),
    helpText: z.string().max(2000).optional(),
    // NOTE: there is no `status` key here, and there must never be one. The
    // route writes the draft literal; a payload that could carry a status would
    // be an agent able to publish. `required`, `sortOrder`, `categoryId` and
    // `config` are absent for the reasons the union variant gives.
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
]);

export type AssistantApprovalAction = z.infer<typeof assistantApprovalActionSchema>;

/**
 * Fields that ride along on a quick link's `executeAction` but are NEVER part of
 * the write.
 *
 * `postActionWorkflowId` / `postActionPrompt` / `postActionPromptLabel` steer
 * the follow-up question the copilot asks itself after the action lands. No
 * effect transmits them and no route reconstructs them — every route rebuilds
 * its action from its own parsed BODY, which never carried them.
 *
 * WHY THEY MUST NOT BE HASHED. `/api/assistant/actions/approvals` hashes the
 * whole `executeAction`, post-action fields included; the target route hashes
 * its reconstruction, which excludes them. Those two hashes differ, so every
 * `approval_required` quick link that sets a post-action prompt minted evidence
 * the route could never match and answered 403 "approval hash mismatch" AFTER
 * the planner had approved it — the funding-opportunity, funding-profile,
 * pursue-decision and invoice-link offers, and the new gate hold. The chat
 * proposal path never hit it because `PROPOSAL_HIDDEN_INPUT_FIELDS` already
 * strips the same three fields before hashing.
 *
 * Excluding them here is also the stricter reading of what an approval means:
 * the hash should cover exactly what will be WRITTEN, and a field that reaches
 * no route is not part of that.
 */
const NON_EXECUTED_ACTION_FIELDS = [
  "postActionWorkflowId",
  "postActionPrompt",
  "postActionPromptLabel",
] as const;

/** The action as it will be executed: presentation-only chaining fields removed. */
export function executedActionPayload(action: unknown): unknown {
  if (!action || typeof action !== "object" || Array.isArray(action)) return action;
  const entries = Object.entries(action as Record<string, unknown>).filter(
    ([key]) => !(NON_EXECUTED_ACTION_FIELDS as readonly string[]).includes(key)
  );
  return Object.fromEntries(entries);
}

export function hashAssistantActionPayload(action: unknown): string {
  return createHash("sha256").update(canonicalizeActionPayload(executedActionPayload(action))).digest("hex");
}

export function readAssistantExecutionSource(request: NextRequest): "manual" | "planner_agent_quick_link" {
  return request.headers.get("x-openplan-assistant-execution-source") === ASSISTANT_ACTION_EXECUTION_SOURCE
    ? ASSISTANT_ACTION_EXECUTION_SOURCE
    : "manual";
}

/**
 * What the route learns about a request that claims to be a Planner Agent
 * execution — including WHO AUTHORED IT, which is not the same question as who
 * is signed in.
 *
 * `authorship` is carried here rather than reconstructed per route because it is
 * derived from facts only this function sees: the execution-source header, and
 * the approval row it consumed. A route that recomputed it would be guessing.
 */
export type AssistantApprovalVerification = {
  approvalId: string | null;
  inputHash: string | null;
  executionSource: "manual" | "planner_agent_quick_link";
  authorship: AssistantActionAuthorship;
};

type AssistantActionApprovalRow = {
  id: string;
  workspace_id: string | null;
  user_id: string;
  action_kind: string;
  input_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string | null;
};

type AssistantApprovalSupabaseLike = {
  from(table: "assistant_action_approvals" | string): unknown;
};

export async function verifyAssistantActionApproval(params: {
  request: NextRequest;
  serviceSupabase: AssistantApprovalSupabaseLike;
  userId: string;
  workspaceId: string | null;
  action: AssistantApprovalAction;
}): Promise<AssistantApprovalVerification> {
  const executionSource = readAssistantExecutionSource(params.request);
  const inputHash = hashAssistantActionPayload(params.action);

  if (executionSource !== ASSISTANT_ACTION_EXECUTION_SOURCE) {
    return { approvalId: null, inputHash: null, executionSource, authorship: USER_AUTHORED };
  }

  const metadata = getActionMetadata(params.action.kind);
  const headerHash = params.request.headers.get("x-openplan-assistant-input-hash")?.trim() ?? null;
  if (metadata.approval !== "approval_required") {
    // Always record the server-computed hash — the client header is unverified
    // and must not be able to write a spoofed hash into the audit row.
    //
    // Authorship is still the agent's: a `safe` or `review` tier means nobody
    // was asked to approve, NOT that a person wrote it. Recording it as
    // user-authored here is exactly the impersonation this seam exists to end.
    return {
      approvalId: null,
      inputHash,
      executionSource,
      authorship: plannerAgentAuthored({ approvedByUserId: null, approvedAt: null }),
    };
  }

  if (headerHash !== inputHash) {
    throw new Error("Planner Agent approval hash mismatch.");
  }

  const approvalId = params.request.headers.get("x-openplan-assistant-approval-id")?.trim() ?? null;
  if (!approvalId) {
    throw new Error("Planner Agent approval evidence is missing.");
  }

  const approvalTable = params.serviceSupabase.from("assistant_action_approvals") as {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<{
          data: AssistantActionApprovalRow | null;
          error: { message?: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        is(column: string, value: unknown): {
          select(columns: string): PromiseLike<{
            data: Array<{ id: string }> | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };

  const { data, error } = await approvalTable
    .select("id, workspace_id, user_id, action_kind, input_hash, expires_at, consumed_at, created_at")
    .eq("id", approvalId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Planner Agent approval evidence was not found.");
  }

  if (
    data.user_id !== params.userId ||
    data.workspace_id !== params.workspaceId ||
    data.action_kind !== params.action.kind ||
    data.input_hash !== inputHash ||
    data.consumed_at ||
    Date.parse(data.expires_at) <= Date.now()
  ) {
    throw new Error("Planner Agent approval evidence is invalid or expired.");
  }

  // Single-use consume. `UPDATE ... WHERE consumed_at IS NULL` is atomic — only the
  // request that actually flips the row from null gets a row back. We MUST check
  // rows-affected: PostgREST returns no error for a zero-row update, so without this a
  // request that lost the race (its earlier read still saw consumed_at = null) would
  // return success and double-spend the approval on a consequential action.
  const { data: consumedRows, error: consumeError } = await approvalTable
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", approvalId)
    .is("consumed_at", null)
    .select("id");

  if (consumeError) {
    throw new Error("Planner Agent approval evidence could not be consumed.");
  }

  if (!consumedRows || consumedRows.length !== 1) {
    throw new Error("Planner Agent approval evidence was already consumed.");
  }

  return {
    approvalId,
    inputHash,
    executionSource,
    // The approver is `data.user_id`, which the check above proved equal to the
    // caller — read from the approval ROW rather than from the session, because
    // the row is the thing that recorded consent and the session is merely the
    // thing spending it.
    authorship: plannerAgentAuthored({
      approvedByUserId: data.user_id,
      approvedAt: data.created_at ?? null,
    }),
  };
}

export function newAssistantApprovalId(): string {
  return randomUUID();
}
