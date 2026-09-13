import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { translationGenerationAddressSchema, translationGenerationReadSchema, type TranslationGenerationRead } from "./translation-generation-request";
import { retainedTranslationSchema } from "./translation-history";

import { translationPublicationReferenceSchema, translationPublicationEvidenceSchema } from "./translation-publication-reference";
const id = z.string().uuid();
export { translationPublicationReferenceSchema } from "./translation-publication-reference";
export const translationPublicationIntentSchema = z.object({
  requestId: id, operation: z.literal("publish_generated"),
  locale: z.string().max(35).regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  reason: z.string().max(4000).refine(value => value.trim().length > 0 && [...value].length <= 2000 && value.isWellFormed() && !value.includes("\0")),
  entries: z.array(translationGenerationAddressSchema.extend({ generation: translationPublicationReferenceSchema }).strict()).min(1).max(200),
}).strict().superRefine((intent, context) => {
  const addresses = new Set<string>(), fields = new Set<string>();
  for (const [index, entry] of intent.entries.entries()) {
    const address = JSON.stringify([entry.entityType, entry.entityId, entry.field]);
    if (addresses.has(address) || fields.has(entry.generation.fieldId) || !entry.expectedSource.available || !entry.expectedSource.text?.trim()) {
      context.addIssue({ code: "custom", path: ["entries", index], message: "Each publication needs one distinct retained field and available source" });
    }
    addresses.add(address); fields.add(entry.generation.fieldId);
  }
});
export type TranslationPublicationIntent = z.infer<typeof translationPublicationIntentSchema>;
export const translationPublicationResultSchema = z.object({
  campaignId: id, requestId: id, operation: z.literal("publish_generated"), locale: z.string(), replayed: z.boolean(),
  entries: z.array(z.object({ entry: retainedTranslationSchema, revision: z.number().int().positive(), removed: z.literal(false),
    generation: translationPublicationEvidenceSchema,
  }).strict()).min(1).max(200),
}).strict();
export type TranslationPublicationResult = z.infer<typeof translationPublicationResultSchema>;

// Confirm the saved receipt against the retained output the staff member saw.
// Reads must come from the server's verified generation reader. This client-safe
// check protects acknowledgement/recovery; SQL owns authorization and writes.
export function readTranslationPublicationResult(raw: unknown, scope: { campaignId: string; workspaceId: string; publisherId: string },
  proposed: TranslationPublicationIntent, retained: TranslationGenerationRead[]): TranslationPublicationResult {
  const intent = translationPublicationIntentSchema.parse(proposed);
  const result = translationPublicationResultSchema.parse(raw);
  const requests = retained.map(value => translationGenerationReadSchema.parse(value));
  if (new Set(requests.map(request => request.requestId)).size !== requests.length) throw new Error("Publication reads repeat a request identity");
  if (result.campaignId !== scope.campaignId || result.requestId !== intent.requestId || result.locale !== intent.locale || result.entries.length !== intent.entries.length) {
    throw new Error("Publication receipt differs from the requested batch");
  }
  const seen = new Set<string>(), seenFields = new Set<string>();
  for (const saved of result.entries) {
    const row = saved.entry;
    const expected = intent.entries.find(entry => entry.entityType === row.entity_type && entry.entityId === row.entity_id && entry.field === row.field);
    if (!expected || seen.has(row.id) || seenFields.has(expected.generation.fieldId) || row.campaign_id !== scope.campaignId || row.workspace_id !== scope.workspaceId || row.locale !== intent.locale || row.created_by !== scope.publisherId) {
      throw new Error("Publication receipt contains an unexpected translation or publisher");
    }
    seen.add(row.id);
    const { generation: reference, ...expectedAddress } = expected;
    seenFields.add(reference.fieldId);
    const request = requests.find(request => request.requestId === reference.requestId);
    const field = request?.fields.find(field => field.id === reference.fieldId);
    if (!request || !field || request.campaignId !== scope.campaignId || request.workspaceId !== scope.workspaceId || request.locale !== intent.locale ||
      field.attemptId !== reference.attemptId || field.output?.deliveryDigest !== reference.deliveryDigest ||
      canonicalizeActionPayload(field.address) !== canonicalizeActionPayload(expectedAddress)) {
      throw new Error("Publication generation differs from the retained source and version");
    }
    if (field.state !== "completed" || field.output.status !== "completed" || field.output.acceptedState !== "completed") throw new Error("Publication output was not successfully completed");
    if (saved.revision !== (expected.expectedTranslation?.revision ?? 0) + 1 || (expected.expectedTranslation && row.id !== expected.expectedTranslation.id)) {
      throw new Error("Publication did not retain the requested revision");
    }
    if (row.source !== "machine" || row.machine_model !== field.output.model || row.translated_text !== field.output.text ||
      canonicalizeActionPayload(saved.generation) !== canonicalizeActionPayload({ ...reference, actorId: request.actorId, outputHash: field.output.outputHash })) {
      throw new Error("Publication changed retained words, model or generation identity");
    }
  }
  return result;
}
