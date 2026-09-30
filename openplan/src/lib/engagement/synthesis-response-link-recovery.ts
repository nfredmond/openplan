import { z } from "zod";
import { readSynthesisResponseLinkAcknowledgement, synthesisResponseLinkIntentSchema, type SynthesisResponseLinkIntent } from "./synthesis-response-link";

const uuid = z.string().uuid();
const scopeFields = { userId: uuid, workspaceId: uuid, campaignId: uuid, reviewId: uuid };
const draftSchema = z.object({ responseId: uuid, groupId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), reason: z.string() }).strict();
export type ResponseLinkDraft = z.infer<typeof draftSchema>;
const workingSchema = z.object({ version: z.literal(1), ...scopeFields,
  draft: draftSchema.nullable(), pending: synthesisResponseLinkIntentSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const intent = value.pending;
  if (!intent) return;
  if (intent.actorId !== value.userId || intent.workspaceId !== value.workspaceId || intent.campaignId !== value.campaignId
    || intent.reviewId !== value.reviewId) ctx.addIssue({ code: "custom", message: "Response link request belongs to another account or retained review" });
  const draft = value.draft;
  if (!draft || intent.responseId !== draft.responseId || intent.groupId !== draft.groupId || intent.reason !== draft.reason) {
    ctx.addIssue({ code: "custom", message: "Response link request differs from the retained response, group or reason" });
  }
});
export type ResponseLinkWorkingCopy = z.infer<typeof workingSchema>;
export type ResponseLinkClientScope = Pick<ResponseLinkWorkingCopy, keyof typeof scopeFields>;
export type ResponseLinkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
const key = (scope: ResponseLinkClientScope) => `openplan:synthesis-response-link:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:${scope.reviewId}`;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const matches = (value: ResponseLinkWorkingCopy, scope: ResponseLinkClientScope) => Object.keys(scopeFields).every(field => value[field as keyof ResponseLinkClientScope] === scope[field as keyof ResponseLinkClientScope]);
export const emptyResponseLinkWorkingCopy = (scope: ResponseLinkClientScope): ResponseLinkWorkingCopy => ({ version: 1, ...scope, draft: null, pending: null });

/** Incomplete reason text is recoverable; private source packets stay out of browser storage. */
export function readResponseLinkWorkingCopy(storage: ResponseLinkStorage, scope: ResponseLinkClientScope) {
  const raw = storage.getItem(key(scope));
  if (raw === null) return emptyResponseLinkWorkingCopy(scope);
  const value = workingSchema.parse(JSON.parse(raw));
  if (!matches(value, scope)) throw new Error("ResponseLink recovery belongs to another review or session");
  return value;
}

/** Compare the earlier copy before each edit and confirm the exact bytes were retained. */
export function writeResponseLinkWorkingCopy(storage: ResponseLinkStorage, previous: ResponseLinkWorkingCopy, next: ResponseLinkWorkingCopy) {
  return writeCopy(storage, previous, next);
}
function writeCopy(storage: ResponseLinkStorage, previous: ResponseLinkWorkingCopy, next: ResponseLinkWorkingCopy, confirmed = false) {
  const parsed = workingSchema.parse(next);
  if (!matches(parsed, previous) || !same(readResponseLinkWorkingCopy(storage, previous), previous)) throw new Error("ResponseLink recovery changed in another tab. Reopen its saved copy before editing.");
  if (previous.pending && !(confirmed && next.pending === null) && !same(previous.pending, next.pending)) throw new Error("Keep the exact pending response link request until confirmed or preserved");
  const raw = JSON.stringify(parsed);
  storage.setItem(key(previous), raw);
  if (storage.getItem(key(previous)) !== raw) throw new Error("The response link edit could not be retained in this browser");
  return parsed;
}

/** Retain both unreadable stored bytes and the latest on-screen text before moving an edit aside. */
export function preserveResponseLinkWorkingCopy(storage: ResponseLinkStorage, scope: ResponseLinkClientScope, latest?: ResponseLinkWorkingCopy) {
  const currentKey = key(scope), raw = storage.getItem(currentKey);
  if (latest && !matches(workingSchema.parse(latest), scope)) throw new Error("Latest response link copy belongs to another retained review");
  const copies = new Set([raw, latest?.draft || latest?.pending ? JSON.stringify(latest) : null]);
  for (const copy of copies) {
    if (copy === null) continue;
    const archive = `${currentKey}:preserved:${crypto.randomUUID()}`;
    storage.setItem(archive, copy);
    if (storage.getItem(archive) !== copy || storage.getItem(currentKey) !== raw) throw new Error("The response link recovery copy could not be preserved");
  }
  storage.removeItem(currentKey);
  if (storage.getItem(currentKey) !== null) throw new Error("The preserved response link copy could not be moved aside");
}
export function listPreservedResponseLinkCopies(storage: ResponseLinkStorage, scope: ResponseLinkClientScope) {
  const prefix = `${key(scope)}:preserved:`, copies: Array<{ key: string; raw: string; value: ResponseLinkWorkingCopy | null }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw === null) continue;
    const parsed = (() => { try { return workingSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
    copies.push({ key: name, raw, value: parsed?.success && matches(parsed.data, scope) ? parsed.data : null });
  }
  return copies;
}

/** Freeze one fully bound command before any network attempt; retries reuse its exact request ID. */
export function freezeResponseLinkRequest(storage: ResponseLinkStorage, working: ResponseLinkWorkingCopy, intent: SynthesisResponseLinkIntent) {
  if (working.pending) throw new Error("A response link request is already pending");
  return writeResponseLinkWorkingCopy(storage, working, { ...working, pending: synthesisResponseLinkIntentSchema.parse(intent) });
}
export class ResponseLinkSaveError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Verify the server's exact receipt before clearing a pending command; cleanup failure does not undo a confirmed save. */
export async function sendResponseLinkRequest(storage: ResponseLinkStorage, working: ResponseLinkWorkingCopy, transport: typeof fetch = fetch) {
  if (!working.pending || !same(readResponseLinkWorkingCopy(storage, working), working)) throw new Error("The retained response link request changed. Reopen it before retrying.");
  const retained = writeResponseLinkWorkingCopy(storage, working, working), intent = retained.pending!;
  const response = await transport(`/api/engagement/campaigns/${working.campaignId}/synthesis/response-links`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": working.userId, "x-openplan-expected-workspace": working.workspaceId },
    body: JSON.stringify(intent), cache: "no-store",
  });
  if (!response.ok) throw new ResponseLinkSaveError(response.status, response.status === 409
    ? "The response link or review changed. Keep this request, inspect the exact version, and preserve your reason before starting another."
    : "The response link is unconfirmed. Keep the same request and retry after checking access.");
  const receipt = await readSynthesisResponseLinkAcknowledgement(await response.json(), intent);
  let next = retained, cleanupError: string | null = null;
  try { next = writeCopy(storage, retained, { ...retained, draft: null, pending: null }, true); }
  catch { cleanupError = "Response link saved. Browser cleanup failed; retrying the retained request will recover the same save."; }
  return { receipt, working: next, cleanupError };
}
