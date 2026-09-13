import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TranslationQueueError } from "./translation-generation-queue";
import { decodeTranslationGenerationDelivery, translationGenerationDeliverySchema } from "./translation-generation-delivery";
import { translationGenerationPacketSchema } from "./translation-generation";
import { translationGenerationAddressSchema, translationGenerationReadSchema, translationGenerationStateSchema, translationGenerationTerminalSchema, type TranslationGenerationRead } from "./translation-generation-request";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), stamp = z.string().datetime({ offset: true });
const rawSchema = z.object({ schema: z.literal(1), requestId: id, campaignId: id, workspaceId: id, actorId: id,
  locale: z.string(), createdAt: stamp, count: z.number().int().min(1).max(25),
  credential: z.object({ id, configurationHash: hash, model: z.string(), source: z.enum(["workspace", "env"]) }).strict(),
  fields: z.array(z.object({ id, address: translationGenerationAddressSchema, packetCanonical: z.string().max(200000), packetHash: hash,
    state: translationGenerationStateSchema, attemptId: id.nullable(), reservationId: id.nullable(), leaseExpiresAt: stamp.nullable(), failureCode: z.string().nullable(),
    output: translationGenerationDeliverySchema.extend({ acceptedState: translationGenerationTerminalSchema }).strict().nullable(),
  }).strict()).min(1).max(25),
}).strict();
function invalid(): never { throw new Error("translation_generation_read_invalid"); }

// The scalar SQL read is permission-scoped and count-complete. Check each
// original packet and retained delivery before exposing words to the staff UI.
export function readTranslationGenerationRequest(raw: unknown, scope: { requestId: string; campaignId: string; workspaceId: string }): TranslationGenerationRead {
  const saved = rawSchema.parse(raw);
  if (saved.requestId !== scope.requestId || saved.campaignId !== scope.campaignId || saved.workspaceId !== scope.workspaceId || saved.count !== saved.fields.length ||
    new Set(saved.fields.map(f => f.id)).size !== saved.fields.length || new Set(saved.fields.map(f => JSON.stringify([f.address.entityType,f.address.entityId,f.address.field]))).size !== saved.fields.length) invalid();
  const fields = saved.fields.map(field => {
    const packet = translationGenerationPacketSchema.parse(JSON.parse(field.packetCanonical));
    if (JSON.stringify(packet) !== field.packetCanonical || createHash("sha256").update(field.packetCanonical).digest("hex") !== field.packetHash ||
      packet.workspaceId !== saved.workspaceId || packet.campaignId !== saved.campaignId || packet.fieldId !== field.id ||
      packet.targetLanguage !== saved.locale || packet.sourceText !== field.address.expectedSource.text || !field.address.expectedSource.available) invalid();
    const claimed = field.attemptId !== null;
    if ((claimed ? field.reservationId === null || field.leaseExpiresAt === null : field.reservationId !== null || field.leaseExpiresAt !== null) ||
      (claimed && field.state === "queued") || (!claimed && !["queued", "failed", "cancelled"].includes(field.state))) invalid();
    let output: TranslationGenerationRead["fields"][number]["output"] = null;
    if (field.output) {
      if (!claimed || field.output.acceptedState !== field.state ||
        (["completed", "incomplete"].includes(field.state) && field.output.status !== field.state)) invalid();
      const { acceptedState, ...delivery } = field.output;
      const generated = decodeTranslationGenerationDelivery(delivery);
      const expected = { workspaceId: saved.workspaceId, campaignId: saved.campaignId, requestId: saved.requestId, fieldId: field.id,
        attemptId: field.attemptId, reservationId: field.reservationId, credentialId: saved.credential.id, configurationHash: saved.credential.configurationHash,
        packetHash: field.packetHash, leaseExpiresAt: field.leaseExpiresAt };
      const actual = Object.fromEntries(Object.keys(expected).map(key => [key, generated.receipt[key as keyof typeof generated.receipt]]));
      // SQL timestamps may use a different equivalent UTC spelling.
      if (Date.parse(generated.receipt.leaseExpiresAt) !== Date.parse(field.leaseExpiresAt!)) invalid();
      actual.leaseExpiresAt = field.leaseExpiresAt;
      if (!isDeepStrictEqual(actual, expected) || generated.receipt.model !== saved.credential.model || generated.receipt.credentialSource !== saved.credential.source ||
        generated.receipt.targetLanguage !== saved.locale || generated.receipt.sourceHash !== createHash("sha256").update(packet.sourceText).digest("hex")) invalid();
      output = { status: generated.status, text: generated.output, model: generated.receipt.model, sourceHash: generated.receipt.sourceHash,
        outputHash: generated.receipt.outputHash, deliveryDigest: delivery.digest, acceptedState };
    } else if (field.state === "completed" || field.state === "incomplete") invalid();
    return { id: field.id, address: field.address, state: field.state, attemptId: field.attemptId, failureCode: field.failureCode, output };
  });
  return translationGenerationReadSchema.parse({ requestId: saved.requestId, campaignId: saved.campaignId, workspaceId: saved.workspaceId,
    actorId: saved.actorId, locale: saved.locale, createdAt: saved.createdAt, fields });
}

export async function loadTranslationGenerationRequest(client: Pick<SupabaseClient, "rpc">, scope: { requestId: string; campaignId: string; workspaceId: string }) {
  const response = await client.rpc("read_translation_generation_request", { p_campaign: scope.campaignId, p_request: scope.requestId }).abortSignal(AbortSignal.timeout(10000));
  if (response.error) throw new TranslationQueueError(response.error.code === "42501" ? "forbidden" : "unavailable", response.error.code === "42501" ? 403 : 503);
  return readTranslationGenerationRequest(response.data, scope);
}
