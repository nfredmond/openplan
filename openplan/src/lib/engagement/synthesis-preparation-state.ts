import { z } from "zod";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.iso.datetime({ offset: true });
const attempt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const stage = z.enum(["segment", "context", "thematic"]);
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const stateSchema = scopeSchema.extend({ schemaVersion: z.literal(1), actorId: id, intentSha256: hash,
  stage, status: z.enum(["queued", "running", "failed", "cancelled", "prepared"]), attempts: attempt,
  leaseUntil: date.nullable(), failureCode: z.enum(["access_unavailable", "input_unavailable", "preparation_failed"]).nullable(),
  sealSha256: hash.nullable(), cancelled: z.boolean(), createdAt: date, updatedAt: date, replayed: z.boolean().optional(),
}).strict();
export type SynthesisPreparationScope = z.infer<typeof scopeSchema>;
export type SynthesisPreparationState = z.infer<typeof stateSchema>;

/** Validate staff-visible state. A saved seal reports preparation, not execution authority. */
export function verifySynthesisPreparation(raw: unknown, rawScope: SynthesisPreparationScope) {
  const scope = scopeSchema.parse(rawScope);
  if (raw === null) return null;
  const state = stateSchema.parse(raw);
  if (state.campaignId !== scope.campaignId || state.workspaceId !== scope.workspaceId || state.requestId !== scope.requestId) {
    throw new Error("Preparation scope differs");
  }
  if ((state.status === "running") !== (state.leaseUntil !== null) ||
    (state.status === "failed") !== (state.failureCode !== null) ||
    (state.status === "prepared") !== (state.sealSha256 !== null) ||
    (["running", "prepared"].includes(state.status) && state.attempts === 0) ||
    (state.status === "cancelled" && !state.cancelled)) throw new Error("Preparation state differs");
  return state;
}

