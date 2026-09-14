import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { decisionLinkIntentSchema, readDecisionContext, readDecisionLinkReceipt } from "./decision-links";
import type { DecisionLinkScope } from "./decision-links";

export type DecisionEditorScope = DecisionLinkScope & { actorId: string };
export type DecisionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const pendingSchema = z.object({
  version: z.literal(1), campaignId: z.string().uuid(), workspaceId: z.string().uuid(), actorId: z.string().uuid(),
  intent: decisionLinkIntentSchema,
  context: z.object({ contextText: z.string(), contextSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  phase: z.enum(["unconfirmed", "conflict", "invalid", "missing"]),
}).strict();
export type PendingDecisionLink = z.infer<typeof pendingSchema>;
const prefix = (scope: DecisionEditorScope) => `openplan:decision-link:${scope.actorId}:${scope.workspaceId}:${scope.campaignId}:`;
export const pendingDecisionKey = (pending: PendingDecisionLink) => prefix(pending) + pending.intent.requestId;
const immutable = (value: PendingDecisionLink) => ({ ...value, phase: "unconfirmed" });
const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);

async function verified(raw: unknown, scope: DecisionEditorScope): Promise<PendingDecisionLink> {
  const pending = pendingSchema.parse(raw);
  if (pending.actorId !== scope.actorId || pending.workspaceId !== scope.workspaceId || pending.campaignId !== scope.campaignId) throw new Error("Local request belongs to a different account or campaign");
  await readDecisionContext(pending.context, { ...scope, responseId: pending.intent.responseId, decisionId: pending.intent.decisionId });
  if (pending.intent.operation !== "withdraw" && pending.intent.expectedContextSha256 !== pending.context.contextSha256) throw new Error("Local source version differs");
  return pending;
}

/** Freeze source context and explanation before transport; another request never shares its key. */
export async function retainPendingDecision(storage: DecisionStorage, raw: PendingDecisionLink, updating = false) {
  const pending = await verified(raw, raw), key = pendingDecisionKey(pending), old = storage.getItem(key);
  if (updating && old === null) throw new Error("The local request changed in another tab");
  if (old !== null && !same(immutable(await verified(JSON.parse(old), pending)), immutable(pending))) throw new Error("A different request already owns this recovery key");
  if (storage.getItem(key) !== old) throw new Error("The local request changed in another tab");
  const text = JSON.stringify(pending);
  storage.setItem(key, text);
  if (storage.getItem(key) !== text) throw new Error("The local explanation could not be retained");
  return pending;
}

/** Unreadable bytes remain visible and untouched, separately from valid recoverable requests. */
export async function readPendingDecisions(storage: DecisionStorage, scope: DecisionEditorScope) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null && key.startsWith(prefix(scope)));
  const pending: PendingDecisionLink[] = [], unreadable: Array<{ key: string; raw: string }> = [];
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      const value = await verified(JSON.parse(raw), scope);
      if (key !== pendingDecisionKey(value)) throw new Error("Recovery key differs");
      pending.push(value);
    } catch { unreadable.push({ key, raw }); }
  }
  return { pending, unreadable };
}

/** Clear only the matching request after its complete, actor-bound server receipt verifies. */
export async function finishPendingDecision(storage: DecisionStorage, pending: PendingDecisionLink, receipt: unknown) {
  const { link } = await readDecisionLinkReceipt(receipt, pending, pending.intent);
  if (link.context_text !== pending.context.contextText || link.context_sha256 !== pending.context.contextSha256) throw new Error("The receipt has different retained sources; the local copy was kept");
  const key = pendingDecisionKey(pending), raw = storage.getItem(key);
  if (raw !== null && !same(immutable(await verified(JSON.parse(raw), pending)), immutable(pending))) throw new Error("The local recovery copy changed; it was kept");
  if (storage.getItem(key) !== raw) throw new Error("The local recovery copy changed; it was kept");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("The confirmed request is saved; local recovery cleanup needs another attempt");
}

/** One transport attempt follows durable local retention; only an exact receipt clears it. */
export async function sendPendingDecision(storage: DecisionStorage, pending: PendingDecisionLink, transport: typeof fetch = fetch) {
  await retainPendingDecision(storage, { ...pending, phase: "unconfirmed" }, true);
  try {
    const response = await transport(`/api/engagement/campaigns/${pending.campaignId}/decision-links`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": pending.actorId, "x-openplan-expected-workspace": pending.workspaceId },
      body: JSON.stringify(pending.intent),
    });
    const body: unknown = await response.json();
    if (response.ok) {
      await finishPendingDecision(storage, pending, body);
      return { confirmed: true, message: "Decision link saved. Its original sources and explanation are retained." };
    }
    const refusal = z.object({ kind: z.enum(["invalid", "missing", "conflict"]) }).safeParse(body);
    if (refusal.success && response.status === { invalid: 400, missing: 404, conflict: 409 }[refusal.data.kind]) {
      await retainPendingDecision(storage, { ...pending, phase: refusal.data.kind }, true);
      return { confirmed: false, message: "This request was refused. Its original explanation is retained below. Review current sources before a new request." };
    }
  } catch { /* Keep the same request after transport, receipt or cleanup failure. */ }
  return { confirmed: false, message: "The save is unconfirmed. Keep this request and retry it; OpenPlan will check for its original receipt." };
}
