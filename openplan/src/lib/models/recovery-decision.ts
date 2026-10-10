import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";

export const recoveryIdentitySchema = z.string().uuid().refine((value) => value === value.toLowerCase());
const status = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export const recoveryExpectedStateSchema = z.object({
  run_id: recoveryIdentitySchema, workspace_id: recoveryIdentitySchema, model_id: recoveryIdentitySchema,
  status, updated_at: z.string().datetime({ offset: true }), attempt_managed: z.boolean(),
  stages: z.array(z.object({
    id: recoveryIdentitySchema, status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "skipped"]),
    updated_at: z.string().datetime({ offset: true }), active_attempt_id: recoveryIdentitySchema.nullable(), attempt_managed: z.boolean(),
  }).strict()).min(1),
}).strict().refine((value) => new Set(value.stages.map((stage) => stage.id)).size === value.stages.length);

export const recoveryInspectionSchema = z.object({
  expected_state: recoveryExpectedStateSchema,
  process_termination_verified: z.literal(false), continuation_authorized: z.literal(false), model_resumed: z.literal(false),
}).strict();

export const recoveryDecisionSchema = z.object({
  requestId: recoveryIdentitySchema, decision: z.literal("abandon_execution"),
  expectedState: recoveryExpectedStateSchema.refine((state) => state.status === "queued" || state.status === "running"),
  reason: z.string().min(1).max(2000).refine((reason) => reason.trim().length > 0),
  evidence: z.record(z.string(), z.unknown()),
}).strict();

export type RecoveryDecision = z.infer<typeof recoveryDecisionSchema>;

/** The authenticated route supplies actor and workspace; body fields cannot override them. */
export function recoveryRpcArguments(decision: RecoveryDecision, workspaceId: string, runId: string, actorId: string) {
  return { p_request_id: decision.requestId, p_workspace_id: workspaceId, p_run_id: runId, p_actor_id: actorId,
    p_expected_state: decision.expectedState, p_reason: decision.reason, p_evidence: decision.evidence };
}

export function matchesRecoveryReceipt(value: unknown, args: ReturnType<typeof recoveryRpcArguments>): boolean {
  const expected = {
    request_id: args.p_request_id, workspace_id: args.p_workspace_id, run_id: args.p_run_id, actor_id: args.p_actor_id,
    outcome: "execution_abandoned", run_status: "cancelled", process_termination_verified: false,
    continuation_authorized: false, model_resumed: false, reported_evidence_verified: false,
    request_payload: { workspace_id: args.p_workspace_id, run_id: args.p_run_id, actor_id: args.p_actor_id,
      expected_state: args.p_expected_state, reason: args.p_reason, reported_evidence: args.p_evidence },
  };
  return canonicalizeActionPayload(value) === canonicalizeActionPayload(expected);
}
