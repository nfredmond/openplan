import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { readSynthesisResponseContext } from "./synthesis-response-context-server";

import {
  synthesisResponseLinkScopeSchema as scopeSchema, synthesisResponseLinkPacketSchema as packetSchema,
  synthesisResponseLinkEventSchema as eventSchema, synthesisResponseLinkIntentSchema,
  type SynthesisResponseLinkIntent, type SynthesisResponseLinkScope,
} from "./synthesis-response-link";
export { synthesisResponseLinkIntentSchema, type SynthesisResponseLinkIntent, type SynthesisResponseLinkScope } from "./synthesis-response-link";

const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);

/** A verified retained record may belong to another command; corruption remains a separate failure. */
export class SynthesisResponseLinkConflictError extends Error {}

function checkScope(actual: SynthesisResponseLinkScope, expected: SynthesisResponseLinkScope) {
  if (actual.campaignId !== expected.campaignId || actual.workspaceId !== expected.workspaceId
    || actual.reviewId !== expected.reviewId || actual.responseId !== expected.responseId || actual.groupId !== expected.groupId) {
    throw new SynthesisResponseLinkConflictError("Synthesis response link scope differs");
  }
}

/** Verify retained private bytes independently of current access, availability or approval. */
export async function readSynthesisResponseLinkEvent(raw: unknown, expected: SynthesisResponseLinkScope) {
  const scope = scopeSchema.parse(expected), packet = packetSchema.parse(raw);
  if (!packet.eventText.isWellFormed() || packet.eventText.includes("\0")) throw new Error("Invalid synthesis response event text");
  if (createHash("sha256").update(packet.eventText, "utf8").digest("hex") !== packet.eventSha256) {
    throw new Error("Synthesis response event checksum differs");
  }
  const event = eventSchema.parse(JSON.parse(packet.eventText));
  if ((event.eventNo === 1) !== (event.intent.operation === "link")) throw new Error("Synthesis response event sequence differs");
  const { campaignId, workspaceId, reviewId, responseId, groupId } = event.intent;
  const evidence = await readSynthesisResponseContext(event.context, { campaignId, workspaceId, reviewId, responseId });
  if (evidence.context.groupId !== groupId) throw new Error("Synthesis response context group differs");
  if (event.intent.operation !== "withdraw" && event.intent.expectedContextSha256 !== event.context.contextSha256) {
    throw new Error("Synthesis response intended context differs");
  }
  checkScope(event.intent, scope);
  return { ...packet, ...event, evidence };
}
type VerifiedEvent = Awaited<ReturnType<typeof readSynthesisResponseLinkEvent>>;
const historySchema = scopeSchema.extend({
  headId: uuid.nullable(), headSha256: digest.nullable(), eventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  entries: z.array(packetSchema),
});

/** Require a complete predecessor chain; withdrawal retains its preceding context byte for byte. */
export async function readSynthesisResponseLinkHistory(raw: unknown, expected: SynthesisResponseLinkScope) {
  const scope = scopeSchema.parse(expected), history = historySchema.parse(raw);
  checkScope(history, scope);
  if (history.eventCount !== history.entries.length) throw new Error("Synthesis response history is incomplete");
  const entries: VerifiedEvent[] = [], ids = new Set<string>(), records = new Map<string, unknown>();
  let previous: VerifiedEvent | null = null;
  for (const packet of history.entries) {
    const event = await readSynthesisResponseLinkEvent(packet, scope), intent = event.intent;
    if (ids.has(intent.requestId) || event.eventNo !== entries.length + 1) throw new Error("Synthesis response history order differs");
    if (intent.predecessorId !== (previous?.intent.requestId ?? null)
      || intent.predecessorSha256 !== (previous?.eventSha256 ?? null)) throw new Error("Synthesis response predecessor differs");
    if (intent.operation === "withdraw" && (!previous || previous.intent.operation === "withdraw"
      || event.context.contextText !== previous.context.contextText || event.context.contextSha256 !== previous.context.contextSha256)) {
      throw new Error("Synthesis response withdrawal context differs");
    }
    if (previous && intent.operation === "refresh" && previous.intent.operation !== "withdraw"
      && isDeepStrictEqual(event.evidence.context, previous.evidence.context)) throw new Error("Synthesis response refresh changes nothing");
    if (previous) {
      const before = previous.evidence.context, after = event.evidence.context;
      if (after.sourceId !== before.sourceId || after.sourceSha256 !== before.sourceSha256
        || after.preparationSha256 !== before.preparationSha256) throw new Error("Synthesis response review source differs");
      if (after.revision.number < before.revision.number || after.responseHistory.revision < before.responseHistory.revision
        || event.evidence.approval.eventNo < previous.evidence.approval.eventNo) throw new Error("Synthesis response context returns to an older version");
      if ((after.revision.number === before.revision.number && !isDeepStrictEqual(after.revision, before.revision))
        || (after.responseHistory.revision === before.responseHistory.revision && !isDeepStrictEqual(after.responseHistory, before.responseHistory))
        || (event.evidence.approval.eventNo === previous.evidence.approval.eventNo && !isDeepStrictEqual(after.approval, before.approval))) {
        throw new Error("Synthesis response context version identity differs");
      }
    }
    const context = event.evidence.context;
    for (const [key, value] of [
      [`review:${context.revision.id}`, context.revision],
      [`response:${context.responseHistory.id}`, context.responseHistory],
      [`approval:${event.evidence.approval.intent.requestId}`, context.approval],
    ] as const) {
      const prior = records.get(key);
      if (prior !== undefined && !isDeepStrictEqual(prior, value)) throw new Error("Synthesis response immutable context record identity differs");
      records.set(key, value);
    }
    ids.add(intent.requestId); entries.push(event); previous = event;
  }
  if (history.headId !== (previous?.intent.requestId ?? null) || history.headSha256 !== (previous?.eventSha256 ?? null)) {
    throw new Error("Synthesis response history head differs");
  }
  return { scope, entries, head: previous };
}

/** Exact command acknowledgement does not imply the retained link is still current or public. */
export async function readSynthesisResponseLinkReceipt(raw: unknown, expected: SynthesisResponseLinkIntent) {
  const intent = synthesisResponseLinkIntentSchema.parse(expected);
  const receipt = z.object({ event: packetSchema, replayed: z.boolean() }).strict().parse(raw);
  const { campaignId, workspaceId, reviewId, responseId, groupId } = intent;
  const event = await readSynthesisResponseLinkEvent(receipt.event, { campaignId, workspaceId, reviewId, responseId, groupId });
  if (!isDeepStrictEqual(event.intent, intent)) throw new SynthesisResponseLinkConflictError("Synthesis response receipt differs from the exact command");
  return { event, replayed: receipt.replayed };
}
