import { z } from "zod";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.iso.datetime({ offset: true });
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const requestSchema = z.object({ id, actorId: id, intentText: z.string().max(4096), intentSha256: hash, createdAt: date }).strict();
const cancellationSchema = z.object({ id, receiptText: z.string(), receiptSha256: hash, createdAt: date }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  request: requestSchema.nullable(), cancellation: cancellationSchema.nullable(), replayed: z.boolean().optional(),
}).strict();
const receiptSchema = z.object({ schemaVersion: z.literal(1), id, requestId: id, campaignId: id, workspaceId: id,
  actorId: id, reason: z.string().min(1).max(4000).refine(value => /\S/.test(value)),
  requestExisted: z.boolean(), cancelledAt: date }).strict();
export const synthesisGenerationRequestIntentSchema = z.object({
  schemaVersion: z.literal(1), sourceId: z.string().uuid(), sourceSha256: hash,
  connectionId: z.string().uuid(), configurationRevisionId: z.string().uuid(), configurationHash: hash,
  modelId: z.string().min(1).max(160).regex(/^\S+$/), taskByteLimit: z.number().int().min(4096).max(1_048_576),
}).strict();

export type SynthesisGenerationRequestScope = z.infer<typeof scopeSchema>;
export { scopeSchema as synthesisGenerationRequestScopeSchema, receiptSchema as synthesisGenerationCancellationReceiptSchema };

/** Parse scope and content only. Callers must separately verify both original text hashes. */
export function parseSynthesisGenerationRequestRecords(raw: unknown, rawScope: SynthesisGenerationRequestScope) {
  const scope = scopeSchema.parse(rawScope), state = stateSchema.parse(raw);
  if (state.campaignId !== scope.campaignId || state.workspaceId !== scope.workspaceId ||
    (!state.request && !state.cancellation)) throw new Error("Synthesis request scope differs");
  let intent: z.infer<typeof synthesisGenerationRequestIntentSchema> | null = null;
  if (state.request) {
    if (state.request.id !== scope.requestId ||
      new TextEncoder().encode(state.request.intentText).byteLength > 4096) throw new Error("Synthesis request bytes differ");
    intent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(state.request.intentText));
  }
  let cancellation: z.infer<typeof receiptSchema> | null = null;
  if (state.cancellation) {
    cancellation = receiptSchema.parse(JSON.parse(state.cancellation.receiptText));
    if (cancellation.id !== state.cancellation.id || cancellation.requestId !== scope.requestId ||
      cancellation.campaignId !== scope.campaignId || cancellation.workspaceId !== scope.workspaceId ||
      cancellation.requestExisted !== (state.request !== null) ||
      (state.request !== null && cancellation.actorId !== state.request.actorId)) throw new Error("Synthesis cancellation scope differs");
  }
  return { state, intent, cancellation };
}

