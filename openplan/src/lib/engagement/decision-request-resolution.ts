import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { decisionLinkRowSchema, readDecisionLink } from "./decision-links";
import type { VerifiedDecisionLink } from "./decision-links";

export const DECISION_RESOLUTION_COPY_LIMIT = 16 * 1024 * 1024;
export const DECISION_RESOLUTION_BODY_LIMIT = 2 * DECISION_RESOLUTION_COPY_LIMIT + 8192;
const id = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const copyJson = z.string().max(DECISION_RESOLUTION_COPY_LIMIT).superRefine((value, context) => {
  try {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded !== "string" || JSON.stringify(decoded) !== value
      || new TextEncoder().encode(value).length > DECISION_RESOLUTION_COPY_LIMIT) throw new Error();
  } catch { context.addIssue({ code: "custom", message: "Retain the exact browser copy as a JSON-encoded string" }); }
});
export const decisionResolutionIntentSchema = z.object({
  resolutionId: id, requestId: id, copyJson,
  reason: z.string().max(4000).refine(value => value.trim().length > 0
    && [...value].length <= 2000 && value.isWellFormed() && !value.includes("\0")),
}).strict();
export type DecisionResolutionIntent = z.infer<typeof decisionResolutionIntentSchema>;
export const decisionResolutionScopeSchema = z.object({ campaignId: id, workspaceId: id, actorId: id }).strict();
export type DecisionResolutionScope = z.infer<typeof decisionResolutionScopeSchema>;
const payloadSchema = decisionResolutionIntentSchema.extend({ schema: z.literal(1), ...decisionResolutionScopeSchema.shape }).strict();
const outcomeSchema = z.object({
  schema: z.literal(1), resolutionId: id, requestId: id, ...decisionResolutionScopeSchema.shape,
  state: z.enum(["saved", "cancelled"]), link: decisionLinkRowSchema.nullable(),
  resolvedAt: z.string().datetime({ offset: true }),
}).strict();
export const decisionResolutionPacketSchema = z.object({
  payloadText: z.string().max(DECISION_RESOLUTION_BODY_LIMIT), payloadSha256: digest,
  resultText: z.string(), resultSha256: digest, replayed: z.boolean(),
}).strict();
export type DecisionResolutionPacket = z.infer<typeof decisionResolutionPacketSchema>;
const same = (left: unknown, right: unknown) => canonicalizeActionPayload(left) === canonicalizeActionPayload(right);

async function checkHash(text: string, expected: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const actual = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error("Decision recovery checksum differs");
}

/** Confirm exact original copy, current account, request and retained outcome before local cleanup. */
export async function readDecisionResolution(raw: unknown, rawScope: DecisionResolutionScope, rawIntent: DecisionResolutionIntent) {
  const scope = decisionResolutionScopeSchema.parse(rawScope), intent = decisionResolutionIntentSchema.parse(rawIntent);
  const packet = decisionResolutionPacketSchema.parse(raw);
  await checkHash(packet.payloadText, packet.payloadSha256);
  await checkHash(packet.resultText, packet.resultSha256);
  const payload = payloadSchema.parse(JSON.parse(packet.payloadText)), outcome = outcomeSchema.parse(JSON.parse(packet.resultText));
  if (!same(payload, { schema: 1, ...scope, ...intent })
    || !same({ campaignId: outcome.campaignId, workspaceId: outcome.workspaceId, actorId: outcome.actorId }, scope)
    || outcome.requestId !== intent.requestId || outcome.resolutionId !== intent.resolutionId) {
    throw new Error("Decision recovery differs from the retained request");
  }
  if ((outcome.state === "saved") !== (outcome.link !== null)) throw new Error("Decision recovery outcome is incomplete");
  let link: VerifiedDecisionLink | null = null;
  if (outcome.link !== null) {
    link = await readDecisionLink(outcome.link, scope);
    if (link.id !== intent.requestId || link.actor_id !== scope.actorId) throw new Error("Recovered decision belongs to a different request or account");
  }
  return { packet, payload, outcome, link };
}
export type VerifiedDecisionResolution = Awaited<ReturnType<typeof readDecisionResolution>>;
