import { z } from "zod";
import { readSynthesisApprovalReceipt, synthesisApprovalIntentSchema, type SynthesisApprovalIntent } from "./synthesis-approval";

const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const scopeFields = { userId: uuid, workspaceId: uuid, campaignId: uuid, sourceId: uuid, sourceSha256: digest, reviewId: uuid, preparationSha256: digest };
const draftSchema = z.object({ revisionId: uuid, revisionNo: z.number().int().positive(), revisionSha256: digest,
  operation: z.enum(["approve", "withdraw"]), reason: z.string() }).strict();
export type ApprovalDraft = z.infer<typeof draftSchema>;
const workingSchema = z.object({ version: z.literal(1), ...scopeFields,
  draft: draftSchema.nullable(), pending: synthesisApprovalIntentSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const intent = value.pending;
  if (!intent) return;
  if (intent.actorId !== value.userId || intent.workspaceId !== value.workspaceId || intent.campaignId !== value.campaignId
    || intent.sourceId !== value.sourceId || intent.sourceSha256 !== value.sourceSha256 || intent.reviewId !== value.reviewId
    || intent.preparationSha256 !== value.preparationSha256) ctx.addIssue({ code: "custom", message: "Approval request belongs to another account or retained review" });
  const draft = value.draft;
  if (!draft || intent.revisionId !== draft.revisionId || intent.revisionNo !== draft.revisionNo || intent.revisionSha256 !== draft.revisionSha256
    || intent.operation !== draft.operation || intent.reason !== draft.reason) ctx.addIssue({ code: "custom", message: "Approval request differs from the retained reason or revision" });
});
export type ApprovalWorkingCopy = z.infer<typeof workingSchema>;
export type ApprovalClientScope = Pick<ApprovalWorkingCopy, keyof typeof scopeFields>;
export type ApprovalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
const key = (scope: ApprovalClientScope) => `openplan:synthesis-approval:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:${scope.sourceId}:${scope.reviewId}`;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const matches = (value: ApprovalWorkingCopy, scope: ApprovalClientScope) => Object.keys(scopeFields).every(field => value[field as keyof ApprovalClientScope] === scope[field as keyof ApprovalClientScope]);
export const emptyApprovalWorkingCopy = (scope: ApprovalClientScope): ApprovalWorkingCopy => ({ version: 1, ...scope, draft: null, pending: null });

/** Incomplete reason text is recoverable; validate the complete command only when freezing it. */
export function readApprovalWorkingCopy(storage: ApprovalStorage, scope: ApprovalClientScope) {
  const raw = storage.getItem(key(scope));
  if (raw === null) return emptyApprovalWorkingCopy(scope);
  const value = workingSchema.parse(JSON.parse(raw));
  if (!matches(value, scope)) throw new Error("Approval recovery belongs to another source, review or session");
  return value;
}

/** Compare the earlier copy before each edit and confirm the exact bytes were retained. */
export function writeApprovalWorkingCopy(storage: ApprovalStorage, previous: ApprovalWorkingCopy, next: ApprovalWorkingCopy) {
  return writeCopy(storage, previous, next);
}
function writeCopy(storage: ApprovalStorage, previous: ApprovalWorkingCopy, next: ApprovalWorkingCopy, confirmed = false) {
  const parsed = workingSchema.parse(next);
  if (!matches(parsed, previous) || !same(readApprovalWorkingCopy(storage, previous), previous)) throw new Error("Approval recovery changed in another tab. Reopen its saved copy before editing.");
  if (previous.pending && !(confirmed && next.pending === null) && !same(previous.pending, next.pending)) throw new Error("Keep the exact pending approval request until confirmed or preserved");
  const raw = JSON.stringify(parsed);
  storage.setItem(key(previous), raw);
  if (storage.getItem(key(previous)) !== raw) throw new Error("The approval edit could not be retained in this browser");
  return parsed;
}

/** Retain both unreadable stored bytes and the latest on-screen text before moving an edit aside. */
export function preserveApprovalWorkingCopy(storage: ApprovalStorage, scope: ApprovalClientScope, latest?: ApprovalWorkingCopy) {
  const currentKey = key(scope), raw = storage.getItem(currentKey);
  if (latest && !matches(workingSchema.parse(latest), scope)) throw new Error("Latest approval copy belongs to another retained review");
  const copies = new Set([raw, latest?.draft || latest?.pending ? JSON.stringify(latest) : null]);
  for (const copy of copies) {
    if (copy === null) continue;
    const archive = `${currentKey}:preserved:${crypto.randomUUID()}`;
    storage.setItem(archive, copy);
    if (storage.getItem(archive) !== copy || storage.getItem(currentKey) !== raw) throw new Error("The approval recovery copy could not be preserved");
  }
  storage.removeItem(currentKey);
  if (storage.getItem(currentKey) !== null) throw new Error("The preserved approval copy could not be moved aside");
}
export function listPreservedApprovalCopies(storage: ApprovalStorage, scope: ApprovalClientScope) {
  const prefix = `${key(scope)}:preserved:`, copies: Array<{ key: string; raw: string; value: ApprovalWorkingCopy | null }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw === null) continue;
    const parsed = (() => { try { return workingSchema.safeParse(JSON.parse(raw)); } catch { return null; } })();
    copies.push({ key: name, raw, value: parsed?.success && matches(parsed.data, scope) ? parsed.data : null });
  }
  return copies;
}

/** Freeze one fully bound command before any network attempt; retries reuse its exact request ID. */
export function freezeApprovalRequest(storage: ApprovalStorage, working: ApprovalWorkingCopy, intent: SynthesisApprovalIntent) {
  if (working.pending) throw new Error("An approval request is already pending");
  return writeApprovalWorkingCopy(storage, working, { ...working, pending: synthesisApprovalIntentSchema.parse(intent) });
}
export class ApprovalSaveError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Verify the server's exact receipt before clearing a pending command; cleanup failure does not undo a confirmed save. */
export async function sendApprovalRequest(storage: ApprovalStorage, working: ApprovalWorkingCopy, transport: typeof fetch = fetch) {
  if (!working.pending || !same(readApprovalWorkingCopy(storage, working), working)) throw new Error("The retained approval request changed. Reopen it before retrying.");
  const retained = writeApprovalWorkingCopy(storage, working, working), intent = retained.pending!;
  const response = await transport(`/api/engagement/campaigns/${working.campaignId}/synthesis/approvals`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": working.userId, "x-openplan-expected-workspace": working.workspaceId },
    body: JSON.stringify(intent), cache: "no-store",
  });
  if (!response.ok) throw new ApprovalSaveError(response.status, response.status === 409
    ? "The approval or review changed. Keep this request, inspect the exact version, and preserve your reason before starting another."
    : "The approval is unconfirmed. Keep the same request and retry after checking access.");
  const receipt = await readSynthesisApprovalReceipt(await response.json(), intent);
  let next = retained, cleanupError: string | null = null;
  try { next = writeCopy(storage, retained, { ...retained, draft: null, pending: null }, true); }
  catch { cleanupError = "Approval saved. Browser cleanup failed; retrying the retained request will recover the same save."; }
  return { receipt, working: next, cleanupError };
}
