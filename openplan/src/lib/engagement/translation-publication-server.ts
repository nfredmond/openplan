import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { translationPublicationIntentSchema, readTranslationPublicationResult, type TranslationPublicationIntent, type TranslationPublicationResult } from "./translation-publication";
import { loadTranslationGenerationRequest } from "./translation-generation-read";
import type { TranslationGenerationRead } from "./translation-generation-request";
import { translationWriteFailureForCode, type TranslationWriteFailure } from "./translation-write";

// Publish once through the caller's transaction, then verify the acknowledgement
// against immutable generation evidence. A lost read or response leaves the same
// request unconfirmed; it never causes another write or provider dispatch.
export async function publishRetainedTranslations(client: Pick<SupabaseClient, "rpc">,
  scope: { campaignId: string; workspaceId: string; publisherId: string }, proposed: TranslationPublicationIntent): Promise<
  { result: TranslationPublicationResult; error: null } | { result: null; error: TranslationWriteFailure }
> {
  const parsed = translationPublicationIntentSchema.safeParse(proposed);
  if (!parsed.success) return { result: null, error: translationWriteFailureForCode("22023") };
  try {
    const intent = parsed.data;
    const deadline = AbortSignal.timeout(20000);
    const reply = await client.rpc("write_engagement_translations", {
      p_campaign: scope.campaignId, p_request: intent.requestId, p_operation: intent.operation,
      p_locale: intent.locale, p_reason: intent.reason, p_entries: intent.entries,
    }).abortSignal(deadline);
    if (reply.error) return { result: null, error: translationWriteFailureForCode(reply.error.code) };
    const ids = [...new Set(intent.entries.map(entry => entry.generation.requestId))];
    const retained: TranslationGenerationRead[] = [];
    for (let offset = 0; offset < ids.length; offset += 8) {
      deadline.throwIfAborted();
      retained.push(...await Promise.all(ids.slice(offset, offset + 8).map(requestId =>
        loadTranslationGenerationRequest(client, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId }, deadline))));
    }
    deadline.throwIfAborted();
    const result = readTranslationPublicationResult(reply.data, scope, intent, retained);
    for (const saved of result.entries) {
      const expected = intent.entries.find(entry => entry.entityType === saved.entry.entity_type && entry.entityId === saved.entry.entity_id && entry.field === saved.entry.field)!;
      if (saved.entry.source_text_hash !== createHash("sha256").update(expected.expectedSource.text!.trim(), "utf8").digest("hex")) {
        throw new Error("Publication source checksum differs from the retained source");
      }
    }
    return { result, error: null };
  } catch {
    // The write may have committed, even if access was lost during evidence
    // reads. Only a transaction refusal above proves the write was refused.
    return { result: null, error: translationWriteFailureForCode() };
  }
}
