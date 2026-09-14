import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import type { TranslationStorage } from "./pending-translation";
import { pendingGenerationKey, pendingGenerationSchema, type GenerationEditorScope } from "./translation-generation-editor";
import { readTranslationGenerationResolution, translationGenerationResolutionIntentSchema, translationGenerationResolutionPacketSchema,
  type TranslationGenerationResolutionPacket } from "./translation-generation-resolution";

const uuid = z.string().uuid();
const scopeSchema = z.object({ userId: uuid, workspaceId: uuid, campaignId: uuid });
export const resolutionPendingPrefix = (scope: GenerationEditorScope) => `openplan:translation-resolution:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:`;
export const resolutionArchivePrefix = (scope: GenerationEditorScope) => `openplan:translation-resolution-archive:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:`;
const generationPrefix = (scope: GenerationEditorScope) => `openplan:translation-generation:${scope.userId}:${scope.campaignId}:`;

/** Only application-owned recovery keys can identify the request being resolved. */
export function resolutionRequestId(key: string, scope: GenerationEditorScope) {
  scopeSchema.parse(scope);
  if (key.startsWith(generationPrefix(scope))) return uuid.parse(key.slice(generationPrefix(scope).length));
  if (key.startsWith(resolutionPendingPrefix(scope))) {
    const parts = key.slice(resolutionPendingPrefix(scope).length).split(":");
    if (parts.length !== 2) throw new Error("Resolution recovery key differs");
    uuid.parse(parts[1]); return uuid.parse(parts[0]);
  }
  throw new Error("Recovery copy belongs to another scope");
}
export const pendingResolutionSchema = scopeSchema.extend({ version: z.literal(1), createdAt: z.string().datetime({ offset: true }),
  sourceKey: z.string(), intents: z.array(translationGenerationResolutionIntentSchema).min(1).max(2),
}).strict().superRefine((value, context) => {
  try {
    const requestId = resolutionRequestId(value.sourceKey, value);
    if (value.intents.some(intent => intent.requestId !== requestId) || new Set(value.intents.map(intent => intent.resolutionId)).size !== value.intents.length
      || new Set(value.intents.map(intent => intent.copyJson)).size !== value.intents.length) throw new Error();
  } catch { context.addIssue({ code: "custom", message: "Recovery bundle does not match its original scope and request" }); }
});
export type PendingResolution = z.infer<typeof pendingResolutionSchema>;
export const pendingResolutionKey = (value: PendingResolution) => resolutionPendingPrefix(value) + value.intents[0].requestId + ":" + value.intents[0].resolutionId;
export const resolutionArchiveKey = (value: PendingResolution) => resolutionArchivePrefix(value) + value.intents[0].requestId + ":" + value.intents[0].resolutionId;
const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);
export function resolutionHasCopy(value: PendingResolution, raw: string) {
  return value.intents.some(intent => {
    const copy = JSON.parse(intent.copyJson) as string;
    if (copy === raw) return true;
    try { return same(JSON.parse(copy), JSON.parse(raw)); } catch { return false; }
  });
}

/** Freeze both surviving versions before any resolution is dispatched. */
export function preparePendingResolution(storage: TranslationStorage, scope: GenerationEditorScope, key: string, reason: string, pageCopy?: string) {
  const requestId = resolutionRequestId(key, scope), raw = storage.getItem(key);
  if (raw === null) throw new Error("Original recovery copy is unavailable");
  const parsed = (() => { try { return pendingGenerationSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
  if (parsed?.success && (parsed.data.workspaceId !== scope.workspaceId || pendingGenerationKey(parsed.data) !== key)) throw new Error("Original recovery scope differs");
  const copies = [raw];
  if (pageCopy !== undefined && !resolutionHasCopy({ intents: [{ copyJson: JSON.stringify(raw) }] } as PendingResolution, pageCopy)) copies.push(pageCopy);
  return pendingResolutionSchema.parse({ version: 1, ...scope, sourceKey: key, createdAt: new Date().toISOString(),
    intents: copies.map(copy => ({ requestId, resolutionId: crypto.randomUUID(), copyJson: JSON.stringify(copy), reason })) });
}

export function retainPendingResolution(storage: TranslationStorage, proposed: PendingResolution) {
  const value = pendingResolutionSchema.parse(proposed), key = pendingResolutionKey(value), old = storage.getItem(key);
  if (old !== null && !same(pendingResolutionSchema.parse(JSON.parse(old)), value)) throw new Error("A different recovery bundle is already retained");
  const raw = JSON.stringify(value); storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Resolution request was not retained");
  return value;
}
export function readResolutionRecovery(storage: TranslationStorage, scope: GenerationEditorScope) {
  const pending: PendingResolution[] = [], unreadable: string[] = [], archives: Array<{ key: string; raw: string }> = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null);
  for (const key of keys) {
    if (key.startsWith(resolutionArchivePrefix(scope))) { const raw = storage.getItem(key); if (raw !== null) archives.push({ key, raw }); continue; }
    if (!key.startsWith(resolutionPendingPrefix(scope))) continue;
    try {
      const raw = storage.getItem(key); if (raw === null) continue;
      const value = pendingResolutionSchema.parse(JSON.parse(raw));
      if (pendingResolutionKey(value) !== key || !same({ userId: value.userId, workspaceId: value.workspaceId, campaignId: value.campaignId }, scope)) throw new Error();
      pending.push(value);
    } catch { unreadable.push(key); }
  }
  return { pending, unreadable, archives };
}

/** Verify exact receipt bytes using the browser's cryptographic implementation. */
export async function verifyBrowserResolution(raw: unknown, value: PendingResolution, index: number) {
  const packet = translationGenerationResolutionPacketSchema.parse(raw);
  const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
  if (await sha(packet.payloadText) !== packet.payloadSha256 || await sha(packet.resultText) !== packet.resultSha256) throw new Error("Resolution checksum differs");
  return readTranslationGenerationResolution(packet, { campaignId: value.campaignId, workspaceId: value.workspaceId, actorId: value.userId }, value.intents[index]);
}

/** Archive verified receipts before retiring matching source or pending bytes. */
export async function archiveResolvedGeneration(storage: TranslationStorage, rawValue: PendingResolution, packets: TranslationGenerationResolutionPacket[], assertCurrent: () => void) {
  const value = pendingResolutionSchema.parse(rawValue);
  if (packets.length !== value.intents.length) throw new Error("Resolution receipt inventory differs");
  for (let index = 0; index < packets.length; index++) await verifyBrowserResolution(packets[index], value, index);
  assertCurrent();
  const key = pendingResolutionKey(value), pending = storage.getItem(key);
  if (pending === null || !same(pendingResolutionSchema.parse(JSON.parse(pending)), value)) throw new Error("Retained resolution request changed");
  const archive = resolutionArchiveKey(value), old = storage.getItem(archive);
  // Replayed is transport metadata; archive identity uses the original receipt bytes.
  const archiveRaw = JSON.stringify({ version: 1, request: value, receipts: packets.map(packet => ({ ...packet, replayed: false })) });
  if (old !== null && old !== archiveRaw) throw new Error("An earlier resolution archive differs");
  storage.setItem(archive, archiveRaw);
  if (storage.getItem(archive) !== archiveRaw || storage.getItem(key) !== pending) throw new Error("Resolution archive readback differs");
  assertCurrent();
  const currentSource = storage.getItem(value.sourceKey);
  if (currentSource !== null && value.intents.some(intent => JSON.parse(intent.copyJson) === currentSource)) {
    storage.removeItem(value.sourceKey);
    if (storage.getItem(value.sourceKey) !== null) throw new Error("Original recovery copy could not be retired");
  }
  if (storage.getItem(key) !== pending) throw new Error("Retained resolution request changed before retirement");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Resolution request could not be retired");
  return { archive, sourceChanged: currentSource !== null && !value.intents.some(intent => JSON.parse(intent.copyJson) === currentSource) };
}
