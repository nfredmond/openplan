import { z } from "zod";

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const synthesisResponseLinkScopeSchema = z.object({
  campaignId: uuid, workspaceId: uuid, reviewId: uuid, responseId: uuid,
  groupId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
}).strict();
export type SynthesisResponseLinkScope = z.infer<typeof synthesisResponseLinkScopeSchema>;
export const synthesisResponseLinkIntentSchema = synthesisResponseLinkScopeSchema.extend({
  requestId: uuid, actorId: uuid, operation: z.enum(["link", "refresh", "withdraw"]),
  reason: z.string().max(4000).refine(value => value.isWellFormed() && !value.includes("\0")
    && value.trim().length > 0 && [...value].length <= 2000),
  predecessorId: uuid.nullable(), predecessorSha256: digest.nullable(), expectedContextSha256: digest.nullable(),
}).superRefine((value, ctx) => {
  if ((value.operation === "link") !== (value.predecessorId === null)
    || (value.predecessorId === null) !== (value.predecessorSha256 === null)
    || value.predecessorId === value.requestId
    || (value.operation === "withdraw") !== (value.expectedContextSha256 === null)) {
    ctx.addIssue({ code: "custom", message: "Name the exact preceding link and context." });
  }
});
export type SynthesisResponseLinkIntent = z.infer<typeof synthesisResponseLinkIntentSchema>;
export const synthesisResponseLinkPacketSchema = z.object({ eventText: z.string(), eventSha256: digest }).strict();
export const synthesisResponseLinkEventSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_response_link"),
  eventNo: positive, createdAt: z.string().datetime({ offset: true }), intent: synthesisResponseLinkIntentSchema,
  context: z.object({ contextText: z.string(), contextSha256: digest }).strict(),
}).strict();

const receiptSchema = z.object({ event: synthesisResponseLinkPacketSchema, replayed: z.boolean() }).strict();
const contextScopeSchema = synthesisResponseLinkScopeSchema.extend({
  schemaVersion: z.literal(1), visibility: z.literal("private"), purpose: z.literal("reviewed_synthesis_response"),
}).passthrough();

async function verifyHash(text: string, expected: string) {
  if (!text.isWellFormed() || text.includes("\0")) throw new Error("Invalid synthesis response text");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const actual = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error("Synthesis response checksum differs");
}

/** Browser acknowledgement verifies bytes and exact intent; the server verifies full source evidence and authority. */
export async function readSynthesisResponseLinkAcknowledgement(raw: unknown, expected: SynthesisResponseLinkIntent) {
  const intent = synthesisResponseLinkIntentSchema.parse(expected), receipt = receiptSchema.parse(raw);
  await verifyHash(receipt.event.eventText, receipt.event.eventSha256);
  const event = synthesisResponseLinkEventSchema.parse(JSON.parse(receipt.event.eventText));
  if (JSON.stringify(event.intent) !== JSON.stringify(intent)) throw new Error("Synthesis response acknowledgement belongs to another command");
  if ((event.eventNo === 1) !== (intent.operation === "link")) throw new Error("Synthesis response event sequence differs");
  await verifyHash(event.context.contextText, event.context.contextSha256);
  const context = contextScopeSchema.parse(JSON.parse(event.context.contextText));
  if (context.campaignId !== intent.campaignId || context.workspaceId !== intent.workspaceId
    || context.reviewId !== intent.reviewId || context.responseId !== intent.responseId || context.groupId !== intent.groupId) {
    throw new Error("Synthesis response context scope differs");
  }
  if (intent.operation !== "withdraw" && event.context.contextSha256 !== intent.expectedContextSha256) {
    throw new Error("Synthesis response context differs from the retained command");
  }
  return { event: { ...receipt.event, ...event }, replayed: receipt.replayed };
}
