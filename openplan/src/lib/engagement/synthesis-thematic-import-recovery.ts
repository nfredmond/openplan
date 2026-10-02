import { z } from "zod";
import { synthesisReviewIntentSchema, synthesisThematicImportReferenceSchema } from "./synthesis-review";
import { synthesisReviewReceiptSchema } from "./synthesis-review-records";
import { ReviewSaveError, type ReviewStorage } from "./synthesis-review-recovery";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeFields = { userId: id, workspaceId: id, campaignId: id, sourceId: id, sourceSha256: hash,
  reviewId: id, preparationSha256: hash };
const draftSchema = z.object({ parentId: id, parentSha256: hash, parentNumber: z.number().int().positive().safe(),
  proposal: synthesisThematicImportReferenceSchema, reason: z.string() }).strict();
const importIntent = synthesisReviewIntentSchema.transform((intent, ctx) => {
  if (intent.operation !== "import_thematic") {
    ctx.addIssue({ code: "custom", message: "Import recovery requires a thematic import command" });
    return z.NEVER;
  }
  return intent;
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const workingSchema = z.object({ version: z.literal(1), ...scopeFields, draft: draftSchema.nullable(),
  pending: z.object({ intent: importIntent, revisionNo: z.number().int().positive().safe() }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if (!value.pending) return;
  const { intent, revisionNo } = value.pending, draft = value.draft;
  if (intent.actorId !== value.userId || intent.workspaceId !== value.workspaceId || intent.reviewId !== value.reviewId
    || !draft || intent.expectedRevisionId !== draft.parentId || intent.expectedRevisionSha256 !== draft.parentSha256
    || revisionNo !== draft.parentNumber + 1 || intent.reason !== draft.reason || !same(intent.proposal, draft.proposal)) {
    ctx.addIssue({ code: "custom", message: "The import command differs from its retained review, parent or proposal" });
  }
});
export type ThematicImportWorkingCopy = z.infer<typeof workingSchema>;
/** Inspection memory holds identifiers only; every remount must reauthorize and reload private evidence. */
export type ThematicImportMemory = { current: ThematicImportWorkingCopy | null; inspection?: { open: boolean; requestId: string | null } };
export type ThematicImportScope = Pick<ThematicImportWorkingCopy, keyof typeof scopeFields>;
export type ThematicImportDraft = z.infer<typeof draftSchema>;
const key = (scope: ThematicImportScope) => `openplan:synthesis-thematic-import:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:${scope.sourceId}:${scope.reviewId}`;
const matches = (value: ThematicImportWorkingCopy, scope: ThematicImportScope) => Object.keys(scopeFields).every(field => value[field as keyof ThematicImportScope] === scope[field as keyof ThematicImportScope]);
export const emptyThematicImportCopy = (scope: ThematicImportScope): ThematicImportWorkingCopy => ({ version: 1, ...scope, draft: null, pending: null });

/** Keep the selected immutable proposal and unfinished reason across navigation. */
export function readThematicImportCopy(storage: ReviewStorage, scope: ThematicImportScope) {
  const raw = storage.getItem(key(scope));
  if (raw === null) return emptyThematicImportCopy(scope);
  const value = workingSchema.parse(JSON.parse(raw));
  if (!matches(value, scope)) throw new Error("Import recovery belongs to another source, review or account");
  return value;
}

/** A pending command cannot change until its receipt is confirmed or its bytes are preserved. */
export function writeThematicImportCopy(storage: ReviewStorage, previous: ThematicImportWorkingCopy, next: ThematicImportWorkingCopy) {
  return writeCopy(storage, previous, next);
}
function writeCopy(storage: ReviewStorage, previous: ThematicImportWorkingCopy, next: ThematicImportWorkingCopy, confirmed = false) {
  const parsed = workingSchema.parse(next);
  if (!matches(parsed, previous) || !same(readThematicImportCopy(storage, previous), previous)) throw new Error("Import recovery changed in another tab. Reopen its saved copy.");
  if (previous.pending && !(confirmed && next.pending === null) && !same(previous.pending, next.pending)) throw new Error("Keep the exact pending import request until confirmed or preserved");
  const raw = JSON.stringify(parsed);
  storage.setItem(key(previous), raw);
  if (storage.getItem(key(previous)) !== raw) throw new Error("The import edit could not be retained in this browser");
  return parsed;
}

export function freezeThematicImport(storage: ReviewStorage, working: ThematicImportWorkingCopy, requestId: string) {
  if (working.pending || !working.draft) throw new Error("Select a proposal and retain its parent before preparing another import");
  const draft = working.draft;
  const intent = importIntent.parse({ operation: "import_thematic", requestId, actorId: working.userId,
    workspaceId: working.workspaceId, reviewId: working.reviewId, expectedRevisionId: draft.parentId,
    expectedRevisionSha256: draft.parentSha256, reason: draft.reason, proposal: draft.proposal });
  return writeCopy(storage, working, { ...working, pending: { intent, revisionNo: draft.parentNumber + 1 } });
}

/** Exact retries recover a saved import without generating another proposal or approval. */
export async function sendThematicImport(storage: ReviewStorage, working: ThematicImportWorkingCopy, transport: typeof fetch = fetch) {
  if (!working.pending || !same(readThematicImportCopy(storage, working), working)) throw new Error("The retained import request changed. Reopen it before retrying.");
  const retained = writeThematicImportCopy(storage, working, working), { intent, revisionNo } = retained.pending!;
  const response = await transport(`/api/engagement/campaigns/${working.campaignId}/synthesis/reviews`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": working.userId,
      "x-openplan-expected-workspace": working.workspaceId }, body: JSON.stringify(intent), cache: "no-store",
  });
  if (!response.ok) throw new ReviewSaveError(response.status, response.status === 409
    ? "The review or selected proposal changed. Preserve this request and inspect the current review before preparing another import."
    : "The import is unconfirmed. Keep the same request and retry after checking access.");
  const receipt = synthesisReviewReceiptSchema.parse(await response.json());
  if (receipt.requestId !== intent.requestId || receipt.reviewId !== working.reviewId || receipt.campaignId !== working.campaignId
    || receipt.workspaceId !== working.workspaceId || receipt.sourceId !== working.sourceId || receipt.sourceSha256 !== working.sourceSha256
    || receipt.preparationSha256 !== working.preparationSha256 || receipt.revisionNo !== revisionNo) {
    throw new Error("The import receipt differs. Keep the exact request for recovery.");
  }
  let next = retained, cleanupError: string | null = null;
  try { next = writeCopy(storage, retained, { ...retained, draft: null, pending: null }, true); }
  catch { cleanupError = "Import saved. Browser cleanup failed; retry the preserved request to reopen the same revision."; }
  return { receipt, working: next, cleanupError };
}

/** Preserve unreadable originals as well as newer edits before clearing the active slot. */
export function preserveThematicImportCopy(storage: ReviewStorage, scope: ThematicImportScope, latest?: ThematicImportWorkingCopy) {
  const activeKey = key(scope), raw = storage.getItem(activeKey);
  if (latest && !matches(workingSchema.parse(latest), scope)) throw new Error("Latest import recovery belongs to another source or account");
  for (const copy of new Set([raw, latest?.draft || latest?.pending ? JSON.stringify(latest) : null])) {
    if (copy === null) continue;
    const archive = `${activeKey}:preserved:${crypto.randomUUID()}`;
    storage.setItem(archive, copy);
    if (storage.getItem(archive) !== copy || storage.getItem(activeKey) !== raw) throw new Error("Import recovery could not be preserved");
  }
  storage.removeItem(activeKey);
  if (storage.getItem(activeKey) !== null) throw new Error("Preserved import recovery could not be moved aside");
}

export function listPreservedThematicImports(storage: ReviewStorage, scope: ThematicImportScope) {
  const prefix = `${key(scope)}:preserved:`, copies: Array<{ key: string; raw: string; value: ThematicImportWorkingCopy | null }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw === null) continue;
    const parsed = (() => { try { return workingSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
    copies.push({ key: name, raw, value: parsed?.success && matches(parsed.data, scope) ? parsed.data : null });
  }
  return copies;
}
