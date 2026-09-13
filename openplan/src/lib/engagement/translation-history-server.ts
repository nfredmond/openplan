import { createHash } from "node:crypto";
import { translationPublicationIntentSchema, readTranslationPublicationResult } from "./translation-publication";
import { loadTranslationGenerationRequest } from "./translation-generation-read";
import type { TranslationGenerationRead } from "./translation-generation-request";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { confirmPendingTranslation, pendingTranslationSchema } from "./pending-translation";
import { readTranslationWriteResult, translationWriteIntentSchema } from "./translation-write";
import { retainedTranslationSchema, translationHistoryMetadataSchema, type TranslationHistoryEntry } from "./translation-history";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({ request_id: z.string().uuid(), actor_id: z.string().uuid(),
  payload_text: z.string(), payload_sha256: digest, result_text: z.string(), result_sha256: digest,
}).strict();
const payloadSchema = z.object({ schema: z.literal(1), campaignId: z.string().uuid(), actorId: z.string().uuid() }).passthrough();
const snapshotSchema = z.object({
  schema: z.literal(2),
  receiptCount: z.number().int().nonnegative(), receipts: z.array(receiptSchema),
  campaignId: z.string().uuid(),
  count: z.number().int().nonnegative(),
  entries: translationHistoryMetadataSchema.extend({ record_text: z.string() }).array(),
});

/** Verify the exact stored bytes and complete sequence before returning private copies. */
export async function loadTranslationHistory(client: Pick<SupabaseClient, "rpc">, campaignId: string, workspaceId: string): Promise<{
  rows: TranslationHistoryEntry[]; error: { message: string } | null;
}> {
  try {
    const result = await client.rpc("read_engagement_translation_history", { p_campaign: campaignId });
    if (result.error) throw new Error("History read failed");
    const snapshot = snapshotSchema.parse(result.data);
    if (snapshot.campaignId !== campaignId || snapshot.count !== snapshot.entries.length) throw new Error("Incomplete history");
    const ids = new Set<string>();
    const latest = new Map<string, TranslationHistoryEntry>();
    const rows: TranslationHistoryEntry[] = snapshot.entries.map(({ record_text, ...entry }) => {
      const previous = latest.get(entry.translation_id);
      if (entry.campaign_id !== campaignId || ids.has(entry.id)
        || entry.revision !== (previous?.revision ?? 0) + 1
        || previous?.event === "removed") throw new Error("Invalid history sequence");
      if (createHash("sha256").update(record_text, "utf8").digest("hex") !== entry.record_sha256) throw new Error("History checksum mismatch");
      const record = retainedTranslationSchema.parse(JSON.parse(record_text));
      if (record.id !== entry.translation_id || record.campaign_id !== campaignId || record.workspace_id !== workspaceId) throw new Error("Invalid retained translation scope");
      if (entry.revision === 1 ? !["created", "legacy_baseline"].includes(entry.event) : ["created", "legacy_baseline"].includes(entry.event)) throw new Error("Invalid history baseline");
      if (entry.event === "legacy_baseline" && entry.actor_id !== null) throw new Error("Invented baseline actor");
      if (previous && ["entity_type", "entity_id", "field", "locale"].some(key => {
        const field = key as "entity_type" | "entity_id" | "field" | "locale";
        return previous.record[field] !== record[field];
      })) throw new Error("Translation address changed");
      const row = { ...entry, record, change: null };
      ids.add(entry.id);
      latest.set(entry.translation_id, row);
      return row;
    });
    if (snapshot.receiptCount !== snapshot.receipts.length) throw new Error("Incomplete command receipts");
    const receipts = new Map<string, Awaited<ReturnType<typeof readReceipt>>>();
    const generations = new Map<string, Promise<TranslationGenerationRead>>();
    const generation = (requestId: string) => {
      let read = generations.get(requestId);
      if (!read) { read = loadTranslationGenerationRequest(client, { campaignId, workspaceId, requestId }); generations.set(requestId, read); }
      return read;
    };
    for (const raw of snapshot.receipts) {
      if (receipts.has(raw.request_id)) throw new Error("Duplicate command receipt");
      receipts.set(raw.request_id, await readReceipt(raw, campaignId, workspaceId, generation));
    }
    const versions = new Map(rows.map(row => [`${row.translation_id}:${row.revision}`, row]));
    for (const receipt of receipts.values()) {
      if (receipt.kind !== "publication") continue;
      for (const saved of receipt.result.entries) {
        if (versions.get(`${saved.entry.id}:${saved.revision}`)?.write_request_id !== receipt.intent.requestId) {
          throw new Error("Publication receipt is missing a retained history revision");
        }
      }
    }
    const used = new Set<string>();
    for (const row of rows) {
      if (row.write_request_id === null) continue;
      const receipt = receipts.get(row.write_request_id);
      if (!receipt || receipt.actorId !== row.actor_id || row.event === "legacy_baseline") throw new Error("Missing or unrelated history receipt");
      const requested = receipt.intent.entries.find(entry => entry.entityType === row.record.entity_type && entry.entityId === row.record.entity_id && entry.field === row.record.field);
      const result = receipt.result.entries.find(entry => entry.entry.id === row.translation_id);
      if (!requested || !result || result.revision !== row.revision || !isDeepStrictEqual(retainedTranslationSchema.parse(result.entry), row.record)) throw new Error("Receipt differs from retained history");
      const previous = versions.get(`${row.translation_id}:${row.revision - 1}`);
      const event = receipt.intent.operation === "withdraw" ? "removed" : !previous ? "created"
        : previous.record.source === "machine" && row.record.source === "operator" && previous.record.translated_text === row.record.translated_text ? "accepted" : "corrected";
      if (row.event !== event) throw new Error("Receipt operation differs from history event");
      if (receipt.kind === "manual") {
        const pending = pendingTranslationSchema.parse({ version: 1, userId: receipt.actorId, workspaceId, campaignId,
          createdAt: row.recorded_at, phase: "unconfirmed", before: [previous ? { entry: previous.record, revision: previous.revision } : null],
          intent: { ...receipt.intent, entries: [requested] } });
        confirmPendingTranslation({ ...receipt.result, entries: [result] }, pending);
      }
      if (receipt.intent.operation !== "withdraw" && row.record.source_text_hash !== createHash("sha256").update(requested.expectedSource.text!.trim(), "utf8").digest("hex")) throw new Error("Retained source checksum differs from checked source");
      row.change = { requestId: receipt.intent.requestId, operation: receipt.intent.operation, reason: receipt.intent.reason,
        source: requested.expectedSource, expectedTranslation: requested.expectedTranslation,
        payloadSha256: receipt.payloadSha256, resultSha256: receipt.resultSha256,
        ...(receipt.kind === "publication" && "generation" in result ? { generation: result.generation } : {}) };
      used.add(row.write_request_id);
    }
    if (used.size !== receipts.size) throw new Error("Unrelated receipts in history snapshot");
    return { rows, error: null };
  } catch {
    return { rows: [], error: { message: "Translation history could not be read and verified completely. Try again." } };
  }
}

/** Verify stored receipt bytes before extracting source words or associating a change. */
async function readReceipt(raw: z.infer<typeof receiptSchema>, campaignId: string, workspaceId: string, generation: (requestId: string) => Promise<TranslationGenerationRead>) {
  if (createHash("sha256").update(raw.payload_text, "utf8").digest("hex") !== raw.payload_sha256
    || createHash("sha256").update(raw.result_text, "utf8").digest("hex") !== raw.result_sha256) throw new Error("Command receipt checksum mismatch");
  const { schema: _schema, campaignId: recordedCampaign, actorId, ...body } = payloadSchema.parse(JSON.parse(raw.payload_text));
  if (body.operation === "publish_generated") {
    const intent = translationPublicationIntentSchema.parse(body);
    if (recordedCampaign !== campaignId || actorId !== raw.actor_id || intent.requestId !== raw.request_id) throw new Error("Command receipt scope mismatch");
    const retained: TranslationGenerationRead[] = [];
    // Bound concurrent database reads within a receipt; immutable requests are
    // cached across the complete history so repeated publications reuse evidence.
    const requestIds = [...new Set(intent.entries.map(entry => entry.generation.requestId))];
    for (let start = 0; start < requestIds.length; start += 8) retained.push(...await Promise.all(requestIds.slice(start, start + 8).map(generation)));
    const result = readTranslationPublicationResult(JSON.parse(raw.result_text), { campaignId, workspaceId, publisherId: actorId }, intent, retained);
    if (result.replayed) throw new Error("Stored receipt is not the original result");
    return { kind: "publication" as const, actorId, intent, result, payloadSha256: raw.payload_sha256, resultSha256: raw.result_sha256 };
  }
  const intent = translationWriteIntentSchema.parse(body);
  if (recordedCampaign !== campaignId || actorId !== raw.actor_id || intent.requestId !== raw.request_id) throw new Error("Command receipt scope mismatch");
  const result = readTranslationWriteResult(JSON.parse(raw.result_text), { campaignId, workspaceId }, intent);
  if (result.replayed) throw new Error("Stored receipt is not the original result");
  return { kind: "manual" as const, actorId, intent, result, payloadSha256: raw.payload_sha256, resultSha256: raw.result_sha256 };
}
