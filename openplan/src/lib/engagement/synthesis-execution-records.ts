import { z } from "zod";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().safe();

// Shared with the durable workers. Expired original grants remain inspectable
// and replayable; native claims separately decide whether new work may start.
export const synthesisWorkerAuthorizationIntentSchema = z.object({ schemaVersion: z.literal(1), headerSha256: hash,
  maxAttempts: z.number().int().positive().safe(), maxOutputTokens: z.number().int().min(1).max(65536),
  responseByteLimit: z.number().int().min(4096).max(4194304), expiresAt: z.string().datetime({ offset: true }),
  chargesAcknowledged: z.literal(true), retryTaskIndex: natural.nullable(), retryOfAttemptId: id.nullable(),
}).strict();

export const synthesisExecutionScopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id,
  actorId: id, sourceId: id, sourceSha256: hash, requestIntentSha256: hash,
  stage: z.enum(["segment", "context", "thematic"]),
}).strict();
export type SynthesisExecutionScope = z.infer<typeof synthesisExecutionScopeSchema>;

export const synthesisExecutionCommandSchema = z.object({ authorizationId: id, intentText: z.string().max(4096) }).strict();
const receiptSchema = z.object({ schemaVersion: z.literal(1), id, requestId: id,
  intentText: z.string().max(4096), intentSha256: hash }).strict();

/** Parse the exact saved authorization. This neither verifies its checksum nor
 * establishes current access, provider prices, dispatch or accepted analysis.
 */
export function parseSynthesisExecutionReceipt(raw: unknown, rawCommand: z.infer<typeof synthesisExecutionCommandSchema>, requestId: string) {
  const command = synthesisExecutionCommandSchema.parse(rawCommand), receipt = receiptSchema.parse(raw);
  id.parse(requestId);
  if (receipt.id !== command.authorizationId || receipt.requestId !== requestId || receipt.intentText !== command.intentText ||
    new TextEncoder().encode(receipt.intentText).byteLength > 4096) throw new Error("Synthesis execution receipt differs");
  const intent = synthesisWorkerAuthorizationIntentSchema.parse(JSON.parse(receipt.intentText));
  if ((intent.retryTaskIndex === null) !== (intent.retryOfAttemptId === null) ||
    (intent.retryTaskIndex !== null && intent.maxAttempts !== 1)) throw new Error("Synthesis retry authority differs");
  return { receipt, intent };
}
