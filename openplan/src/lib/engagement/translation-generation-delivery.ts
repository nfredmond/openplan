import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { translationGenerationBindingSchema } from "./translation-generation";
import { TRANSLATION_LANGUAGES } from "./translation-languages";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const safeReceiptSchema = translationGenerationBindingSchema.extend({
  schemaVersion: z.literal(1), provider: z.literal("anthropic"),
  model: z.string().min(1).max(160).regex(/^[^\s\u0000-\u001f\u007f]+$/),
  credentialSource: z.enum(["workspace", "env"]), recipeVersion: z.literal(1),
  targetLanguage: z.enum(TRANSLATION_LANGUAGES), sourceHash: hash, outputHash: hash,
  finishReason: z.enum(["stop", "length", "content-filter", "tool-calls", "error", "other", "unknown"]).nullable(),
  inputTokens: count, outputTokens: count,
}).strict();
const providerMetadataSchema = z.object({ responseId: z.string().nullable(), reportedModel: z.string().nullable() }).strict();
const resultSchema = z.object({
  status: z.enum(["completed", "incomplete"]), output: z.string(),
  receipt: safeReceiptSchema.extend(providerMetadataSchema.shape).strict(),
}).strict();
export type TranslationGenerationResult = z.infer<typeof resultSchema>;
export const translationGenerationDeliverySchema = z.object({
  status: z.enum(["completed", "incomplete"]), outputJson: z.string(), bindingCanonical: z.string(),
  providerMetadataJson: z.string(), digest: hash,
}).strict();
export type TranslationGenerationDelivery = z.infer<typeof translationGenerationDeliverySchema>;

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function deliveryDigest(value: Omit<TranslationGenerationDelivery, "digest">): string {
  return sha256([value.status, value.outputJson, value.bindingCanonical, value.providerMetadataJson].join("\n"));
}

// JSON-string serialization preserves JS code units including NUL and lone
// surrogates. PostgreSQL TEXT can retain those escapes; JSONB cannot. Only safe
// bound receipt fields are parsed as JSONB. Provider-supplied strings stay in a
// separate opaque JSON record and are reconstructed by this same codec.
export function encodeTranslationGenerationDelivery(raw: unknown): TranslationGenerationDelivery {
  const result = resultSchema.parse(raw);
  if (sha256(result.output) !== result.receipt.outputHash) throw new Error("translation_output_hash_mismatch");
  const complete = result.receipt.finishReason === "stop" && result.output.trim().length > 0 &&
    result.output.isWellFormed() && !result.output.includes("\0") && [...result.output].length <= 8000;
  if ((result.status === "completed") !== complete) throw new Error("translation_completion_mismatch");
  const { responseId, reportedModel, ...binding } = result.receipt;
  const value = { status: result.status, outputJson: JSON.stringify(result.output), bindingCanonical: canonicalizeActionPayload(binding),
    providerMetadataJson: canonicalizeActionPayload({ responseId, reportedModel }) };
  if ([value.outputJson, value.bindingCanonical, value.providerMetadataJson].some(text => text.includes("\n") || !text.isWellFormed()) ||
    Buffer.byteLength(value.outputJson + value.bindingCanonical + value.providerMetadataJson, "utf8") > 200000) throw new Error("translation_delivery_too_large");
  return { ...value, digest: deliveryDigest(value) };
}

// Verify the journal/server round trip before retiring a private completion.
// Re-encoding also refuses alternate JSON encodings or changes to completeness.
export function decodeTranslationGenerationDelivery(raw: unknown): TranslationGenerationResult {
  const saved = translationGenerationDeliverySchema.parse(raw);
  if (deliveryDigest(saved) !== saved.digest) throw new Error("translation_delivery_digest_mismatch");
  const binding = safeReceiptSchema.parse(JSON.parse(saved.bindingCanonical));
  const metadata = providerMetadataSchema.parse(JSON.parse(saved.providerMetadataJson));
  const result = resultSchema.parse({ status: saved.status, output: JSON.parse(saved.outputJson), receipt: { ...binding, ...metadata } });
  if (canonicalizeActionPayload(encodeTranslationGenerationDelivery(result)) !== canonicalizeActionPayload(saved)) throw new Error("translation_delivery_encoding_mismatch");
  return result;
}
