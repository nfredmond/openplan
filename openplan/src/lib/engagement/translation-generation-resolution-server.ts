import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TranslationQueueError } from "./translation-generation-queue";
import { readTranslationGenerationResolution, translationGenerationResolutionIntentSchema, translationGenerationResolutionPacketSchema, translationGenerationResolutionScopeSchema,
  type TranslationGenerationResolutionIntent, type TranslationGenerationResolutionScope } from "./translation-generation-resolution";

/** Check stored bytes as well as identity before confirming a resolution. */
export function verifyTranslationGenerationResolution(raw: unknown, scope: TranslationGenerationResolutionScope, intent: TranslationGenerationResolutionIntent) {
  const packet = translationGenerationResolutionPacketSchema.parse(raw);
  if (createHash("sha256").update(packet.payloadText).digest("hex") !== packet.payloadSha256
    || createHash("sha256").update(packet.resultText).digest("hex") !== packet.resultSha256) throw new Error("Resolution receipt checksum differs");
  return readTranslationGenerationResolution(packet, scope, intent);
}

export async function resolveTranslationGenerationRequest(client: Pick<SupabaseClient, "rpc">, rawScope: TranslationGenerationResolutionScope, raw: TranslationGenerationResolutionIntent) {
  const scope = translationGenerationResolutionScopeSchema.parse(rawScope);
  const intent = translationGenerationResolutionIntentSchema.parse(raw);
  const response = await client.rpc("resolve_translation_generation_request", { p_resolution: intent.resolutionId, p_request: intent.requestId,
    p_campaign: scope.campaignId, p_copy_json: intent.copyJson, p_reason: intent.reason }).abortSignal(AbortSignal.timeout(10000));
  if (response.error) {
    const code = response.error.code;
    throw new TranslationQueueError(code === "42501" ? "forbidden" : ["PT409", "23505"].includes(code) ? "conflict" : ["22023", "22P02"].includes(code) ? "invalid" : "unavailable",
      code === "42501" ? 403 : ["PT409", "23505"].includes(code) ? 409 : ["22023", "22P02"].includes(code) ? 400 : 503);
  }
  return verifyTranslationGenerationResolution(response.data, scope, intent).packet;
}
