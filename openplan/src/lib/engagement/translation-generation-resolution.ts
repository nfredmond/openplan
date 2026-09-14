import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { translationGenerationStateSchema, translationGenerationTerminalSchema } from "./translation-generation-request";

export const GENERATION_RESOLUTION_COPY_LIMIT = 16 * 1024 * 1024;
export const GENERATION_RESOLUTION_BODY_LIMIT = 2 * GENERATION_RESOLUTION_COPY_LIMIT + 8192;
const id = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const encodedCopy = z.string().max(GENERATION_RESOLUTION_COPY_LIMIT).superRefine((value, context) => {
  try {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded !== "string" || JSON.stringify(decoded) !== value || new TextEncoder().encode(value).length > GENERATION_RESOLUTION_COPY_LIMIT) throw new Error();
  } catch { context.addIssue({ code: "custom", message: "Preserve the exact browser copy as a JSON-encoded string" }); }
});
export const translationGenerationResolutionIntentSchema = z.object({
  resolutionId: id, requestId: id, copyJson: encodedCopy,
  reason: z.string().min(1).max(4000).refine(value => value.trim().length > 0 && value.isWellFormed() && !value.includes("\0")),
}).strict();
export type TranslationGenerationResolutionIntent = z.infer<typeof translationGenerationResolutionIntentSchema>;
export const translationGenerationResolutionScopeSchema = z.object({ campaignId: id, workspaceId: id, actorId: id }).strict();
export type TranslationGenerationResolutionScope = z.infer<typeof translationGenerationResolutionScopeSchema>;
const payloadSchema = translationGenerationResolutionIntentSchema.extend({ schema: z.literal(1), ...translationGenerationResolutionScopeSchema.shape }).strict();
const resultSchema = z.object({ schema: z.literal(1), resolutionId: id, requestId: id, ...translationGenerationResolutionScopeSchema.shape,
  requestExisted: z.boolean(), resolvedAt: z.string().datetime({ offset: true }),
  fields: z.array(z.object({ fieldId: id, previousState: translationGenerationStateSchema, state: translationGenerationTerminalSchema,
    attemptId: id.nullable(), outputRetained: z.boolean() }).strict()).max(25),
}).strict().superRefine((result, context) => {
  if (result.requestExisted !== (result.fields.length > 0) || new Set(result.fields.map(field => field.fieldId)).size !== result.fields.length) {
    context.addIssue({ code: "custom", message: "Resolution field inventory is incomplete" });
  }
  for (const field of result.fields) {
    const expected = field.previousState === "queued" || field.previousState === "reserved" ? "cancelled"
      : field.previousState === "running" ? "interrupted" : field.previousState;
    if (field.state !== expected || (field.previousState === "queued" && field.attemptId !== null)
      || (["reserved", "running", "completed", "incomplete"].includes(field.previousState) && field.attemptId === null)
      || (["completed", "incomplete"].includes(field.previousState) && !field.outputRetained)) {
      context.addIssue({ code: "custom", message: "Resolution changed or lost an existing generation outcome" });
    }
  }
});
export const translationGenerationResolutionPacketSchema = z.object({
  payloadText: z.string().max(GENERATION_RESOLUTION_BODY_LIMIT), payloadSha256: digest,
  resultText: z.string().max(65536), resultSha256: digest, replayed: z.boolean(),
}).strict();
export type TranslationGenerationResolutionPacket = z.infer<typeof translationGenerationResolutionPacketSchema>;

/** Bind a verified server receipt to the original resolution and exact browser bytes. */
export function readTranslationGenerationResolution(raw: unknown, rawScope: TranslationGenerationResolutionScope, rawIntent: TranslationGenerationResolutionIntent) {
  const packet = translationGenerationResolutionPacketSchema.parse(raw);
  const scope = translationGenerationResolutionScopeSchema.parse(rawScope), intent = translationGenerationResolutionIntentSchema.parse(rawIntent);
  const payload = payloadSchema.parse(JSON.parse(packet.payloadText)), result = resultSchema.parse(JSON.parse(packet.resultText));
  if (canonicalizeActionPayload(payload) !== canonicalizeActionPayload({ schema: 1, ...scope, ...intent })
    || canonicalizeActionPayload({ campaignId: result.campaignId, workspaceId: result.workspaceId, actorId: result.actorId }) !== canonicalizeActionPayload(scope)
    || result.resolutionId !== intent.resolutionId || result.requestId !== intent.requestId) throw new Error("Resolution receipt differs from the retained request");
  return { packet, payload, result };
}
export type TranslationGenerationResolution = ReturnType<typeof readTranslationGenerationResolution>;
