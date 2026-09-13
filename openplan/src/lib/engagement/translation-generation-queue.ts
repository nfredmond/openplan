import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { prepareWorkspaceTranslationSelection } from "@/lib/integrations/workspace-keys";
import { TranslationCredentialError } from "@/lib/integrations/translation-credentials";
import { translationGenerationPacketCanonical } from "./translation-generation";
import { translationGenerationRequestAckSchema, translationGenerationRequestSchema, type TranslationGenerationRequest } from "./translation-generation-request";

type Service = ReturnType<typeof createServiceRoleClient>;
const scopeSchema = z.object({ workspaceId: z.string().uuid(), campaignId: z.string().uuid(), actorId: z.string().uuid() }).strict();
export type TranslationGenerationScope = z.infer<typeof scopeSchema>;
export const TRANSLATION_GENERATION_REPLAY_COLUMNS = "id,workspace_id,campaign_id,actor_id,locale,intent";
const replaySchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), campaign_id: z.string().uuid(), actor_id: z.string().uuid(),
  locale: z.string(), intent: z.unknown() }).strict();
export class TranslationQueueError extends Error {
  constructor(public readonly kind: "conflict" | "forbidden" | "invalid" | "unavailable" | "credential_unavailable", public readonly status: number) {
    super(kind);
  }
}
function rpcError(error: { code?: string } | null) {
  if (!error) return;
  if (["PT409", "23505"].includes(error.code ?? "")) throw new TranslationQueueError("conflict", 409);
  if (error.code === "42501") throw new TranslationQueueError("forbidden", 403);
  if (["22023", "22P02"].includes(error.code ?? "")) throw new TranslationQueueError("invalid", 400);
  throw new TranslationQueueError("unavailable", 503);
}

// A retained creation receipt is checked before key preparation. Source/key edits
// after an acknowledged or unacknowledged creation cannot turn its retry into a
// new paid request. SQL repeats permission, intent and current-version checks.
export async function queueTranslationGeneration(service: Service, rawScope: TranslationGenerationScope, raw: TranslationGenerationRequest) {
  const scope = scopeSchema.parse(rawScope);
  const body = translationGenerationRequestSchema.parse(raw);
  const fields = body.fields.map(field => ({ ...field, packetCanonical: translationGenerationPacketCanonical({ schemaVersion: 1,
    workspaceId: scope.workspaceId, campaignId: scope.campaignId, fieldId: field.id,
    sourceText: field.address.expectedSource.text!, targetLanguage: body.locale }) }));
  const intent = { requestId: body.requestId, actorId: scope.actorId, campaignId: scope.campaignId, locale: body.locale, fields };
  const response = await service.from("engagement_translation_generation_requests").select(TRANSLATION_GENERATION_REPLAY_COLUMNS)
    .eq("id", body.requestId).eq("workspace_id", scope.workspaceId).eq("campaign_id", scope.campaignId).eq("actor_id", scope.actorId)
    .abortSignal(AbortSignal.timeout(10000)).maybeSingle();
  rpcError(response.error);
  let selection: Awaited<ReturnType<typeof prepareWorkspaceTranslationSelection>> | null = null;
  if (response.data !== null) {
    const saved = replaySchema.parse(response.data);
    if (saved.id !== body.requestId || saved.workspace_id !== scope.workspaceId || saved.campaign_id !== scope.campaignId ||
      saved.actor_id !== scope.actorId || saved.locale !== body.locale || !isDeepStrictEqual(saved.intent, intent)) throw new TranslationQueueError("conflict", 409);
  } else {
    try {
      selection = await prepareWorkspaceTranslationSelection({ workspaceId: scope.workspaceId, requestId: body.requestId,
        credentialId: randomUUID(), modelId: process.env.OPENPLAN_ENGAGEMENT_TRANSLATION_MODEL?.trim() || "claude-haiku-4-5-20251001",
        client: service, signal: AbortSignal.timeout(10000) });
    } catch (error) {
      if (error instanceof TranslationCredentialError) throw new TranslationQueueError("credential_unavailable", 503);
      throw error;
    }
  }
  const created = await service.rpc("create_translation_generation_request", { p_request: body.requestId, p_actor: scope.actorId,
    p_campaign: scope.campaignId, p_locale: body.locale, p_fields: fields,
    p_credential: selection?.credential ?? null, p_selected_hash: selection?.selectedKeyCiphertextHash ?? null }).abortSignal(AbortSignal.timeout(10000));
  rpcError(created.error);
  const ack = translationGenerationRequestAckSchema.parse(created.data);
  if (ack.requestId !== body.requestId || (response.data !== null && ack.created)) throw new TranslationQueueError("unavailable", 503);
  return ack;
}
