import { z } from "zod";
import { synthesisSourceIntentSchema, synthesisSourceReceiptSchema } from "./synthesis-sources";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SynthesisClientScope = { userId: string; workspaceId: string; campaignId: string };
const pendingSchema = z.object({
  version: z.literal(1), userId: z.string().uuid(), workspaceId: z.string().uuid(), campaignId: z.string().uuid(),
  intent: synthesisSourceIntentSchema,
}).strict().refine(value => value.userId === value.intent.actorId && value.workspaceId === value.intent.workspaceId, "Source request belongs to another account or workspace");
export type PendingSynthesisSource = z.infer<typeof pendingSchema>;
const key = (scope: SynthesisClientScope) => `openplan:synthesis-source:${scope.userId}:${scope.workspaceId}:${scope.campaignId}`;

export function readPendingSynthesisSource(storage: StorageLike, scope: SynthesisClientScope): PendingSynthesisSource | null {
  const raw = storage.getItem(key(scope));
  if (raw === null) return null;
  const value = pendingSchema.parse(JSON.parse(raw));
  if (value.userId !== scope.userId || value.workspaceId !== scope.workspaceId || value.campaignId !== scope.campaignId) throw new Error("Source request belongs to another session");
  return value;
}

/** Preserve and read back the exact selection before sending it; never replace another pending request. */
export function retainPendingSynthesisSource(storage: StorageLike, pending: PendingSynthesisSource) {
  const value = pendingSchema.parse(pending);
  const existing = readPendingSynthesisSource(storage, value);
  if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error("Another source request is pending");
  const raw = JSON.stringify(value);
  storage.setItem(key(value), raw);
  if (storage.getItem(key(value)) !== raw) throw new Error("Source request could not be retained for retry");
  return value;
}

export function clearPendingSynthesisSource(storage: StorageLike, pending: PendingSynthesisSource) {
  const current = readPendingSynthesisSource(storage, pending);
  if (current && JSON.stringify(current) !== JSON.stringify(pending)) throw new Error("Another source request is pending");
  storage.removeItem(key(pending));
  if (storage.getItem(key(pending)) !== null) throw new Error("Source request could not be cleared");
}

/** Keep an unreadable or abandoned request in this scoped browser archive before allowing a fresh selection. */
export function archivePendingSynthesisSource(storage: StorageLike, scope: SynthesisClientScope) {
  const activeKey = key(scope), raw = storage.getItem(activeKey);
  if (raw === null) return;
  const archive = `${activeKey}:preserved:${crypto.randomUUID()}`;
  storage.setItem(archive, raw);
  if (storage.getItem(archive) !== raw || storage.getItem(activeKey) !== raw) throw new Error("Source request recovery copy was not retained");
  storage.removeItem(activeKey);
  if (storage.getItem(activeKey) !== null) throw new Error("Source request could not be moved aside");
}

/** A failed acknowledgement retains the request. Cleanup failure cannot undo a confirmed save. */
export async function sendPendingSynthesisSource(storage: StorageLike, pending: PendingSynthesisSource, transport: typeof fetch = fetch) {
  const current = readPendingSynthesisSource(storage, pending);
  if (!current || JSON.stringify(current) !== JSON.stringify(pending)) throw new Error("The saved request changed in another tab. Reload before retrying.");
  retainPendingSynthesisSource(storage, pending);
  const response = await transport(`/api/engagement/campaigns/${pending.campaignId}/synthesis/sources`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.intent), cache: "no-store",
  });
  if (!response.ok) throw new Error("The save is unconfirmed. Keep this request and retry after checking campaign access.");
  const receipt = synthesisSourceReceiptSchema.parse(await response.json());
  if (receipt.requestId !== pending.intent.requestId || receipt.campaignId !== pending.campaignId || receipt.workspaceId !== pending.workspaceId) throw new Error("The save receipt differs from this request. Keep the request for recovery.");
  let cleanupError: string | null = null;
  try { clearPendingSynthesisSource(storage, pending); }
  catch { cleanupError = "Source saved. The browser recovery copy could not be cleared; retrying it will reopen the same save."; }
  return { receipt, cleanupError };
}
