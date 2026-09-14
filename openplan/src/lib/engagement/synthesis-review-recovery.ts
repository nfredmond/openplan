import { z } from "zod";
import { synthesisReviewIntentSchema, type SynthesisReviewIntent } from "./synthesis-review";
import { synthesisReviewReceiptSchema } from "./synthesis-review-records";

const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const scopeFields = { userId: uuid, workspaceId: uuid, campaignId: uuid, sourceId: uuid, sourceSha256: digest };
export const reviewDraftSchema = z.object({
  reviewId: uuid, parentId: uuid, parentSha256: digest, parentNumber: z.number().int().positive(),
  kind: z.enum(["notes", "group_update", "group_add", "group_remove"]), groupId: z.string(),
  title: z.string(), notes: z.string(), label: z.string(), summary: z.string(),
  sentiment: z.enum(["not_assessed", "positive", "mixed", "neutral", "negative"]),
  members: z.array(z.string()), reason: z.string(),
}).strict();
export type ReviewDraft = z.infer<typeof reviewDraftSchema>;
const workingSchema = z.object({
  version: z.literal(1), ...scopeFields, activeReviewId: uuid.nullable(), draft: reviewDraftSchema.nullable(),
  pending: z.object({ intent: synthesisReviewIntentSchema, revisionNo: z.number().int().positive() }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  const intent = value.pending?.intent;
  if (intent && (intent.actorId !== value.userId || intent.workspaceId !== value.workspaceId
    || (intent.operation === "create" && (intent.sourceId !== value.sourceId || intent.sourceSha256 !== value.sourceSha256 || value.pending?.revisionNo !== 1)))) {
    ctx.addIssue({ code: "custom", message: "Review request belongs to another account or source" });
  }
  if (intent?.operation === "correct" && (!value.draft || intent.reviewId !== value.draft.reviewId || intent.expectedRevisionId !== value.draft.parentId
    || intent.expectedRevisionSha256 !== value.draft.parentSha256 || value.pending?.revisionNo !== value.draft.parentNumber + 1)) {
    ctx.addIssue({ code: "custom", message: "Review request differs from its retained parent" });
  }
});
export type ReviewWorkingCopy = z.infer<typeof workingSchema>;
export type ReviewClientScope = Pick<ReviewWorkingCopy, "userId" | "workspaceId" | "campaignId" | "sourceId" | "sourceSha256">;
export type ReviewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
const key = (scope: ReviewClientScope) => `openplan:synthesis-review:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:${scope.sourceId}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const matches = (value: ReviewWorkingCopy, scope: ReviewClientScope) => Object.keys(scopeFields).every(field => value[field as keyof ReviewClientScope] === scope[field as keyof ReviewClientScope]);
export const emptyReviewWorkingCopy = (scope: ReviewClientScope): ReviewWorkingCopy => ({ version: 1, ...scope, activeReviewId: null, draft: null, pending: null });

/** Recover incomplete text as text; command validation happens before the exact request is frozen. */
export function readReviewWorkingCopy(storage: ReviewStorage, scope: ReviewClientScope) {
  const raw = storage.getItem(key(scope));
  if (raw === null) return emptyReviewWorkingCopy(scope);
  const value = workingSchema.parse(JSON.parse(raw));
  if (!matches(value, scope)) throw new Error("Review recovery belongs to another source or session");
  return value;
}

/** Compare the previous copy before every edit and read it back before any transport. */
export function writeReviewWorkingCopy(storage: ReviewStorage, previous: ReviewWorkingCopy, next: ReviewWorkingCopy) {
  return writeCopy(storage, previous, next);
}

function writeCopy(storage: ReviewStorage, previous: ReviewWorkingCopy, next: ReviewWorkingCopy, confirmed = false) {
  const parsed = workingSchema.parse(next);
  if (!matches(parsed, previous) || !same(readReviewWorkingCopy(storage, previous), previous)) throw new Error("Review recovery changed in another tab. Reopen the saved copy before editing.");
  if (previous.pending && !(confirmed && next.pending === null) && !same(previous.pending, next.pending)) throw new Error("Keep the exact pending review request until it is confirmed or preserved");
  const raw = JSON.stringify(parsed);
  storage.setItem(key(previous), raw);
  if (storage.getItem(key(previous)) !== raw) throw new Error("The review edit could not be retained in this browser");
  return parsed;
}

/** Preserve exact recoverable bytes before moving an abandoned or unreadable local edit aside. */
export function preserveReviewWorkingCopy(storage: ReviewStorage, scope: ReviewClientScope, latest?: ReviewWorkingCopy) {
  const currentKey = key(scope), raw = storage.getItem(currentKey);
  if (latest && !matches(workingSchema.parse(latest), scope)) throw new Error("Latest recovery copy belongs to another source");
  const copies = new Set([raw, latest?.draft || latest?.pending ? JSON.stringify(latest) : null]);
  for (const copy of copies) {
    if (copy === null) continue;
    const archive = `${currentKey}:preserved:${crypto.randomUUID()}`;
    storage.setItem(archive, copy);
    if (storage.getItem(archive) !== copy || storage.getItem(currentKey) !== raw) throw new Error("The recovery copy could not be preserved");
  }
  storage.removeItem(currentKey);
  if (storage.getItem(currentKey) !== null) throw new Error("The preserved review copy could not be moved aside");
}

export function listPreservedReviewCopies(storage: ReviewStorage, scope: ReviewClientScope) {
  const prefix = `${key(scope)}:preserved:`;
  const copies: Array<{ key: string; raw: string; value: ReviewWorkingCopy | null }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw === null) continue;
    const parsed = (() => { try { return workingSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
    copies.push({ key: name, raw, value: parsed?.success && matches(parsed.data, scope) ? parsed.data : null });
  }
  return copies;
}

/** A correction's small exact command is frozen locally; the server computes full saved bytes. */
export function freezeReviewRequest(storage: ReviewStorage, working: ReviewWorkingCopy, intent: SynthesisReviewIntent, revisionNo: number) {
  if (working.pending) throw new Error("A review request is already pending");
  return writeReviewWorkingCopy(storage, working, { ...working, pending: { intent: synthesisReviewIntentSchema.parse(intent), revisionNo } });
}

export class ReviewSaveError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Confirmation remains true when browser cleanup fails, and an interrupted acknowledgement preserves the request. */
export async function sendReviewRequest(storage: ReviewStorage, working: ReviewWorkingCopy, transport: typeof fetch = fetch) {
  if (!working.pending || !same(readReviewWorkingCopy(storage, working), working)) throw new Error("The retained review request changed. Reopen it before retrying.");
  const retained = writeReviewWorkingCopy(storage, working, working), { intent, revisionNo } = retained.pending!;
  const response = await transport(`/api/engagement/campaigns/${working.campaignId}/synthesis/reviews`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": working.userId, "x-openplan-expected-workspace": working.workspaceId },
    body: JSON.stringify(intent), cache: "no-store",
  });
  if (!response.ok) throw new ReviewSaveError(response.status, response.status === 409 ? "The review changed or this request differs. Keep this request, inspect the current review, and preserve your correction before starting another." : "The save is unconfirmed. Keep the same review request and retry after checking access.");
  const receipt = synthesisReviewReceiptSchema.parse(await response.json());
  if (receipt.requestId !== intent.requestId || receipt.reviewId !== (intent.operation === "create" ? intent.requestId : intent.reviewId)
    || receipt.campaignId !== working.campaignId || receipt.workspaceId !== working.workspaceId || receipt.sourceId !== working.sourceId
    || receipt.sourceSha256 !== working.sourceSha256 || receipt.revisionNo !== revisionNo) throw new Error("The review receipt differs. Keep the request for recovery.");
  let cleanupError: string | null = null;
  let next = retained;
  try { next = writeCopy(storage, retained, { ...retained, activeReviewId: receipt.reviewId, draft: null, pending: null }, true); }
  catch { cleanupError = "Review saved. Browser cleanup failed; retrying the preserved request will reopen the same save."; }
  return { receipt, working: next, cleanupError };
}
