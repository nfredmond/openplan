import { z } from "zod";

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reason = z.string().max(4000).refine(value => value.isWellFormed() && !value.includes("\0")
  && value.trim().length > 0 && [...value].length <= 2000, "Record a reason of at most 2000 characters.");
const scopeFields = { campaignId: uuid, workspaceId: uuid, reviewId: uuid, sourceId: uuid,
  sourceSha256: digest, preparationSha256: digest };
const revisionFields = { revisionId: uuid, revisionSha256: digest, revisionNo: positive };
const scopeSchema = z.object(scopeFields).strict();
const contextSchema = z.object({ ...scopeFields, ...revisionFields }).strict();
export type SynthesisApprovalScope = z.infer<typeof scopeSchema>;
export type SynthesisApprovalContext = z.infer<typeof contextSchema>;

export const synthesisApprovalIntentSchema = z.object({
  ...scopeFields, ...revisionFields, requestId: uuid, actorId: uuid,
  operation: z.enum(["approve", "withdraw"]), reason,
  predecessorId: uuid.nullable(), predecessorSha256: digest.nullable(),
}).strict().superRefine((intent, ctx) => {
  if ((intent.predecessorId === null) !== (intent.predecessorSha256 === null)
    || intent.predecessorId === intent.requestId || (intent.operation === "withdraw" && intent.predecessorId === null)) {
    ctx.addIssue({ code: "custom", message: "Name the exact previous approval event." });
  }
});
export type SynthesisApprovalIntent = z.infer<typeof synthesisApprovalIntentSchema>;

const eventSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal("internal_staff_synthesis"),
  eventNo: positive, createdAt: z.string().datetime({ offset: true }), intent: synthesisApprovalIntentSchema,
}).strict();
export const synthesisApprovalPacketSchema = z.object({ eventText: z.string(), eventSha256: digest }).strict();
export type SynthesisApprovalPacket = z.infer<typeof synthesisApprovalPacketSchema>;
export type VerifiedSynthesisApproval = z.infer<typeof eventSchema> & SynthesisApprovalPacket;
const sameIntent = (left: SynthesisApprovalIntent, right: SynthesisApprovalIntent) =>
  JSON.stringify(synthesisApprovalIntentSchema.parse(left)) === JSON.stringify(synthesisApprovalIntentSchema.parse(right));

function checkScope(value: SynthesisApprovalScope, expected: SynthesisApprovalScope) {
  if (value.campaignId !== expected.campaignId || value.workspaceId !== expected.workspaceId || value.reviewId !== expected.reviewId
    || value.sourceId !== expected.sourceId || value.sourceSha256 !== expected.sourceSha256 || value.preparationSha256 !== expected.preparationSha256) {
    throw new Error("Approval source or review scope differs");
  }
}
function sameRevision(left: SynthesisApprovalContext, right: SynthesisApprovalContext) {
  return left.revisionId === right.revisionId && left.revisionSha256 === right.revisionSha256 && left.revisionNo === right.revisionNo;
}

/** Verify retained bytes in both server readers and browser acknowledgement recovery. */
export async function readSynthesisApprovalEvent(raw: unknown, scope: SynthesisApprovalScope): Promise<VerifiedSynthesisApproval> {
  const packet = synthesisApprovalPacketSchema.parse(raw);
  if (!packet.eventText.isWellFormed() || packet.eventText.includes("\0")) throw new Error("Invalid approval event text");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(packet.eventText));
  const actual = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
  if (actual !== packet.eventSha256) throw new Error("Approval event checksum differs");
  const event = eventSchema.parse(JSON.parse(packet.eventText));
  checkScope(event.intent, scopeSchema.parse(scope));
  return { ...packet, ...event };
}

/** This checks intent only. The writer must repeat the head comparison under the review's correction lock. */
export function checkSynthesisApprovalIntent(raw: unknown, current: SynthesisApprovalContext, previous: VerifiedSynthesisApproval | null) {
  const intent = synthesisApprovalIntentSchema.parse(raw);
  checkScope(intent, contextSchema.parse(current));
  if (previous) checkScope(previous.intent, current);
  if (intent.predecessorId !== (previous?.intent.requestId ?? null) || intent.predecessorSha256 !== (previous?.eventSha256 ?? null)) {
    throw new Error("Approval history has changed");
  }
  if (intent.operation === "approve") {
    if (!sameRevision(intent, current)) throw new Error("Review has a newer or different revision");
    if (previous && intent.revisionNo < previous.intent.revisionNo) throw new Error("Approval history returns to an older revision");
    if (previous?.intent.operation === "approve" && sameRevision(previous.intent, intent)) throw new Error("This exact revision is already approved");
  } else if (!previous || previous.intent.operation !== "approve" || !sameRevision(intent, previous.intent)) {
    throw new Error("Withdrawal must name the exact preceding approval");
  }
  return intent;
}

const historySchema = z.object({
  ...scopeFields, headId: uuid.nullable(), headSha256: digest.nullable(),
  eventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), entries: z.array(synthesisApprovalPacketSchema),
}).strict();
export type VerifiedSynthesisApprovalHistory = { scope: SynthesisApprovalScope; entries: VerifiedSynthesisApproval[]; head: VerifiedSynthesisApproval | null };

/** Consume a complete chronological history; a page or a missing predecessor is never an empty approval state. */
export async function readSynthesisApprovalHistory(raw: unknown, scope: SynthesisApprovalScope): Promise<VerifiedSynthesisApprovalHistory> {
  const history = historySchema.parse(raw);
  checkScope(history, scopeSchema.parse(scope));
  if (history.eventCount !== history.entries.length) throw new Error("Approval history is incomplete");
  const entries: VerifiedSynthesisApproval[] = [], ids = new Set<string>();
  const revisionsById = new Map<string, SynthesisApprovalContext>(), revisionsByNumber = new Map<number, SynthesisApprovalContext>();
  let previous: VerifiedSynthesisApproval | null = null;
  for (const packet of history.entries) {
    const event = await readSynthesisApprovalEvent(packet, scope);
    if (ids.has(event.intent.requestId) || event.eventNo !== entries.length + 1) throw new Error("Approval history order differs");
    const byId = revisionsById.get(event.intent.revisionId), byNumber = revisionsByNumber.get(event.intent.revisionNo);
    if ((byId && !sameRevision(byId, event.intent)) || (byNumber && !sameRevision(byNumber, event.intent))) {
      throw new Error("Approval history revision identity differs");
    }
    checkSynthesisApprovalIntent(event.intent, {
      ...scope, revisionId: event.intent.revisionId, revisionSha256: event.intent.revisionSha256, revisionNo: event.intent.revisionNo,
    }, previous);
    revisionsById.set(event.intent.revisionId, event.intent); revisionsByNumber.set(event.intent.revisionNo, event.intent);
    ids.add(event.intent.requestId); entries.push(event); previous = event;
  }
  if (history.headId !== (previous?.intent.requestId ?? null) || history.headSha256 !== (previous?.eventSha256 ?? null)) {
    throw new Error("Approval history head differs");
  }
  return { scope: scopeSchema.parse(scope), entries, head: previous };
}

/** A correction never inherits approval. Historical approval remains attached to its own exact version. */
export function synthesisApprovalForRevision(history: VerifiedSynthesisApprovalHistory, revision: SynthesisApprovalContext) {
  checkScope(contextSchema.parse(revision), history.scope);
  const event = history.entries.findLast(row => row.intent.revisionId === revision.revisionId) ?? null;
  if (event && !sameRevision(event.intent, revision)) throw new Error("Approval revision checksum or number differs");
  return { state: event ? event.intent.operation === "approve" ? "approved" as const : "withdrawn" as const : "unapproved" as const, event };
}

/** Compare exact authenticated intent before accepting either a new receipt or an old lost-acknowledgement replay. */
export async function readSynthesisApprovalReceipt(raw: unknown, expected: SynthesisApprovalIntent) {
  const intent = synthesisApprovalIntentSchema.parse(expected);
  const receipt = z.object({ event: synthesisApprovalPacketSchema, replayed: z.boolean() }).strict().parse(raw);
  const event = await readSynthesisApprovalEvent(receipt.event, {
    campaignId: intent.campaignId, workspaceId: intent.workspaceId, reviewId: intent.reviewId,
    sourceId: intent.sourceId, sourceSha256: intent.sourceSha256, preparationSha256: intent.preparationSha256,
  });
  if (!sameIntent(event.intent, intent)) throw new Error("Approval receipt does not match the exact request");
  return { event, replayed: receipt.replayed };
}
