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
  replacement: z.discriminatedUnion('state', [
    z.object({ state: z.literal('available'), checkpointId: recoveryIdentitySchema,
      checkpointSha256: z.string().regex(/^[a-f0-9]{64}$/), engineKey: z.enum(['aequilibrae', 'behavioral_demand']) }).strict(),
    z.object({ state: z.literal('unavailable'), reason: z.string().min(1) }).strict(),
  ]).optional(),
}).strict();

export const recoveryDecisionSchema = z.object({
  requestId: recoveryIdentitySchema, decision: z.literal("abandon_execution"),
  expectedState: recoveryExpectedStateSchema.refine((state) => state.status === "queued" || state.status === "running"),
  reason: z.string().min(1).max(2000).refine((reason) => reason.trim().length > 0),
  evidence: z.record(z.string(), z.unknown()),
}).strict();

export type RecoveryDecision = z.infer<typeof recoveryDecisionSchema>;

/** Keep or close a run enrolled before recovery tracking. Neither choice changes the run. */
export const historicalRunDecisionSchema = z.object({
  requestId: recoveryIdentitySchema, decision: z.enum(["keep_as_record", "close_for_fresh_run"]),
  expectedState: recoveryExpectedStateSchema,
  reason: z.string().min(1).max(2000).refine((reason) => reason.trim().length > 0),
}).strict();

export type HistoricalRunDecision = z.infer<typeof historicalRunDecisionSchema>;
export const populationReplacementDecisionSchema = z.object({
  requestId: recoveryIdentitySchema, decision: z.literal('create_population_replacement'),
  expectedState: recoveryExpectedStateSchema.refine((state) => state.status === 'failed' || state.status === 'cancelled'),
  checkpointId: recoveryIdentitySchema, checkpointSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1).max(2000).refine((value) => value.trim().length > 0),
  acknowledgedNewRun: z.literal(true),
}).strict();
export type PopulationReplacementDecision = z.infer<typeof populationReplacementDecisionSchema>;
export const savedRecoveryDecisionSchema = z.discriminatedUnion('decision', [recoveryDecisionSchema, populationReplacementDecisionSchema]);
export const recoveryRequestSchema = z.discriminatedUnion("decision", [recoveryDecisionSchema, historicalRunDecisionSchema, populationReplacementDecisionSchema]);

export function replacementRpcArguments(decision: PopulationReplacementDecision, workspaceId: string, runId: string, actorId: string) {
  return { p_request_id: decision.requestId, p_workspace_id: workspaceId, p_run_id: runId, p_actor_id: actorId,
    p_expected_state: decision.expectedState, p_checkpoint_id: decision.checkpointId,
    p_checkpoint_sha256: decision.checkpointSha256, p_reason: decision.reason, p_acknowledged_new_run: decision.acknowledgedNewRun };
}

export function replacementReceipt(value: unknown, args: ReturnType<typeof replacementRpcArguments>) {
  const parsed = z.object({ schema: z.literal('openplan.population-replacement.v1'), request_id: recoveryIdentitySchema,
    request_payload: z.unknown(), outcome: z.literal('replacement_created'), replacement_run_id: recoveryIdentitySchema,
    engine_key: z.enum(['aequilibrae', 'behavioral_demand']), old_run_changed: z.literal(false), model_resumed: z.literal(false),
  }).strict().safeParse(value);
  const expected = { workspace_id: args.p_workspace_id, run_id: args.p_run_id, actor_id: args.p_actor_id,
    expected_state: args.p_expected_state, checkpoint_id: args.p_checkpoint_id, checkpoint_sha256: args.p_checkpoint_sha256,
    reason: args.p_reason, acknowledged_new_run: true };
  // Replacement fault anchor: a creation receipt cannot rebind the failed run.
  return parsed.success && parsed.data.request_id === args.p_request_id && parsed.data.replacement_run_id !== args.p_run_id &&
    canonicalizeActionPayload(parsed.data.request_payload) === canonicalizeActionPayload(expected) ? parsed.data : null;
}

export function matchesSavedRecoveryReceipt(value: unknown, decision: z.infer<typeof savedRecoveryDecisionSchema>, workspaceId: string, runId: string, actorId: string) {
  return decision.decision === 'create_population_replacement'
    ? replacementReceipt(value, replacementRpcArguments(decision, workspaceId, runId, actorId)) !== null
    : matchesRecoveryReceipt(value, recoveryRpcArguments(decision, workspaceId, runId, actorId));
}

const historicalOutcomes = { keep_as_record: "kept_as_record", close_for_fresh_run: "closed_for_fresh_run" } as const;

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

/** The authenticated route supplies actor and workspace; body fields cannot override them. */
export function historicalDecisionRpcArguments(decision: HistoricalRunDecision, workspaceId: string, runId: string, actorId: string) {
  return { p_request_id: decision.requestId, p_workspace_id: workspaceId, p_run_id: runId, p_actor_id: actorId,
    p_expected_state: decision.expectedState, p_outcome: historicalOutcomes[decision.decision], p_reason: decision.reason };
}

/** A receipt confirms only the recorded choice; it never reports a changed run or resumed work. */
export function matchesHistoricalDecisionReceipt(value: unknown, args: ReturnType<typeof historicalDecisionRpcArguments>): boolean {
  const expected = {
    request_id: args.p_request_id, workspace_id: args.p_workspace_id, run_id: args.p_run_id, actor_id: args.p_actor_id,
    outcome: args.p_outcome, run_status: args.p_expected_state.status, run_record_changed: false,
    process_termination_verified: false, continuation_authorized: false, model_resumed: false,
    request_payload: { workspace_id: args.p_workspace_id, run_id: args.p_run_id, actor_id: args.p_actor_id,
      expected_state: args.p_expected_state, outcome: args.p_outcome, reason: args.p_reason },
  };
  return canonicalizeActionPayload(value) === canonicalizeActionPayload(expected);
}
