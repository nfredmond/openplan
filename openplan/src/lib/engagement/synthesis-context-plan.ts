import { createHash } from "node:crypto";
import { z } from "zod";
import { createSynthesisContextPlan } from "./synthesis-context-continuation";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const natural = z.number().int().nonnegative().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const stateSchema = z.object({ schemaVersion: z.literal(1), requestId: z.string().uuid(),
  headerText: z.string(), headerSha256: hash, nextIndex: natural, frameBytes: natural, tailSha256: hash,
  cancelled: z.boolean(), seal: z.object({ receiptText: z.string(), receiptSha256: hash }).strict().nullable() }).strict();

/** Wrap the reconstructed continuation plan with a native staging chain. Frame
 * bytes are immutable inputs, not the later task containing preceding output.
 * The separate envelope preserves the pure continuation header and its hash.
 */
export function createSynthesisContextStagingPlan(...args: Parameters<typeof createSynthesisContextPlan>) {
  const continuation = createSynthesisContextPlan(...args), body = continuation.header;
  const seedSha256 = digest(`synthesis-context-frames-v1:${body.requestId}:${continuation.headerSha256}:${body.contextRequestSha256}`);
  let tail = seedSha256, bytes = 0;
  const entries = continuation.content.frames.map(frame => {
    const previousSha256 = tail;
    bytes += frame.utf8Bytes;
    natural.parse(bytes);
    tail = digest(`${tail}:${frame.index}:${frame.sha256}:${frame.utf8Bytes}`);
    return { ...frame, previousSha256, cumulativeBytes: bytes, chainSha256: tail };
  });
  const header = { schemaVersion: 1, purpose: "private_synthesis_context_frame_plan", requestId: body.requestId,
    actorId: body.actorId, intentSha256: body.intentSha256, contextRequestSha256: body.contextRequestSha256,
    recipeId: body.recipeId, recipeSha256: body.recipeSha256, continuationHeaderSha256: continuation.headerSha256,
    contentManifestSha256: body.contentManifestSha256, contextManifestSha256: continuation.content.contextManifestSha256,
    targetRecordId: body.targetRecordId, frameByteLimit: continuation.content.frameByteLimit,
    frameCount: entries.length, frameBytes: bytes, tailSha256: tail };
  const headerText = JSON.stringify(header);
  return { header, headerText, headerSha256: digest(headerText), seedSha256, entries, continuation };
}
export type SynthesisContextStagingPlan = ReturnType<typeof createSynthesisContextStagingPlan>;

/** Compare the entire retained prefix and seal to reconstructed original frames. */
export function verifySynthesisContextPlanState(plan: SynthesisContextStagingPlan, raw: unknown) {
  const state = stateSchema.parse(raw);
  if (state.requestId !== plan.header.requestId || state.headerText !== plan.headerText ||
    state.headerSha256 !== plan.headerSha256 || state.nextIndex > plan.entries.length) throw new Error("Retained context plan identity differs");
  const last = plan.entries[state.nextIndex - 1];
  if (state.frameBytes !== (last?.cumulativeBytes ?? 0) || state.tailSha256 !== (last?.chainSha256 ?? plan.seedSha256)) {
    throw new Error("Retained context frame prefix differs");
  }
  if (state.seal) {
    if (state.nextIndex !== plan.entries.length || digest(state.seal.receiptText) !== state.seal.receiptSha256) throw new Error("Context frame seal is incomplete or corrupt");
    z.object({ schemaVersion: z.literal(1), requestId: z.literal(plan.header.requestId), headerSha256: z.literal(plan.headerSha256),
      frameCount: z.literal(plan.header.frameCount), frameBytes: z.literal(plan.header.frameBytes), tailSha256: z.literal(plan.header.tailSha256),
      sealedAt: z.string().datetime({ offset: true }) }).strict().parse(JSON.parse(state.seal.receiptText));
  }
  return state;
}

/** Bound the encoded transport packet, including JSON string escaping. */
export function synthesisContextFrameBatch(plan: SynthesisContextStagingPlan, start: number) {
  natural.max(plan.entries.length).parse(start);
  if (start === plan.entries.length) return null;
  const texts: string[] = [];
  let framesText = "[]";
  for (const frame of plan.entries.slice(start, start + 128)) {
    const candidate = JSON.stringify([...texts, frame.canonical]);
    if (Buffer.byteLength(candidate, "utf8") > 4_194_304) break;
    texts.push(frame.canonical); framesText = candidate;
  }
  if (!texts.length) throw new Error("Context frame exceeds the staging packet limit");
  return { start, previousSha256: plan.entries[start].previousSha256, framesText, nextIndex: start + texts.length };
}
