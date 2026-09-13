import { z } from "zod";
import { closeLoopEntrySchema } from "./close-loop";
import { createResponseSchema, updateResponseSchema, removeResponseSchema } from "./response-write";

export const pendingResponseSchema = z.object({
  version: z.literal(1),
  userId: z.string().min(1), campaignId: z.string().uuid(),
  origin: z.enum(["manual", "suggestion", "entry"]),
  phase: z.enum(["unconfirmed", "conflict", "rejected", "missing"]),
  intent: z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("create"), body: createResponseSchema }).strict(),
    z.object({ operation: z.literal("update"), entryId: z.string().uuid(), body: updateResponseSchema }).strict(),
    z.object({ operation: z.literal("remove"), entryId: z.string().uuid(), body: removeResponseSchema }).strict(),
  ]),
  before: closeLoopEntrySchema.nullable(),
}).strict().refine(pending => pending.intent.operation === "create" ? pending.before === null
  : pending.before?.id === pending.intent.entryId && pending.before.campaign_id === pending.campaignId
    && pending.before.updated_at === pending.intent.body.expectedUpdatedAt, "Pending response does not match its saved baseline");
export type PendingResponse = z.infer<typeof pendingResponseSchema>;
export type ResponseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function pendingResponseKey(userId: string, campaignId: string) {
  return `openplan:response-write:${encodeURIComponent(userId)}:${encodeURIComponent(campaignId)}`;
}

/** Retain the exact validated request before transport, and verify that this tab can read it back. */
export function retainPendingResponse(storage: ResponseStorage, value: PendingResponse): PendingResponse {
  const pending = pendingResponseSchema.parse(value);
  const key = pendingResponseKey(pending.userId, pending.campaignId);
  const serialized = JSON.stringify(pending);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Pending response was not retained");
  return pending;
}

export function readPendingResponse(storage: ResponseStorage, userId: string, campaignId: string): PendingResponse | null {
  const raw = storage.getItem(pendingResponseKey(userId, campaignId));
  if (raw === null) return null;
  const pending = pendingResponseSchema.parse(JSON.parse(raw));
  if (pending.userId !== userId || pending.campaignId !== campaignId) throw new Error("Pending response belongs to another session");
  return pending;
}

/** Do not clear a different pending intent if another writer has replaced this tab's record. */
export function clearPendingResponse(storage: ResponseStorage, pending: PendingResponse) {
  const current = readPendingResponse(storage, pending.userId, pending.campaignId);
  if (current && current.intent.body.requestId !== pending.intent.body.requestId) throw new Error("Another response request is pending");
  const key = pendingResponseKey(pending.userId, pending.campaignId);
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Pending response was not cleared");
}

/** Move unreadable bytes aside only after a second scoped copy can be read back; never discard a valid pending request. */
export function preserveUnreadableResponse(storage: ResponseStorage, userId: string, campaignId: string): string | null {
  const key = pendingResponseKey(userId, campaignId);
  const raw = storage.getItem(key);
  if (raw === null) return null;
  let readable = false;
  try { readable = readPendingResponse(storage, userId, campaignId) !== null; } catch { /* Preserve the unreadable bytes below. */ }
  if (readable) throw new Error("The request is readable; retry recovery instead");
  const archiveKey = `${key}:unreadable:${crypto.randomUUID()}`;
  storage.setItem(archiveKey, raw);
  if (storage.getItem(archiveKey) !== raw) throw new Error("Recovery copy was not retained");
  if (storage.getItem(key) !== raw) throw new Error("The active recovery record changed");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("The active recovery record could not be cleared");
  return archiveKey;
}
