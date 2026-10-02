import { createHash } from "node:crypto";
import { z } from "zod";
import type { createSynthesisThematicPlan } from "./synthesis-thematic-continuation";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const natural = z.number().int().nonnegative().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().uuid();
export const synthesisThematicStagingStateSchema = z.object({ schemaVersion: z.literal(1), requestId: id, campaignId: id, workspaceId: id,
  headerText: z.string(), headerSha256: hash, nextIndex: natural, frameBytes: natural, tailSha256: hash,
  cancelled: z.boolean(), seal: z.object({ receiptText: z.string(), receiptSha256: hash }).strict().nullable() }).strict();
type Continuation = ReturnType<typeof createSynthesisThematicPlan>;

/** Wrap freshly reconstructed continuation content in a bounded native frame
 * chain. The final proposal slot is a reference, not an already computed task or
 * provider permission. A native seal retains it atomically after all frames.
 */
export function createSynthesisThematicStagingPlan(continuation: Continuation) {
  const body = continuation.header, request = continuation.content.request.state;
  const seedSha256 = digest(`synthesis-thematic-frames-v1:${body.requestId}:${continuation.headerSha256}:${body.inputManifestSha256}:${body.inputSealSha256}`);
  let tail = seedSha256, bytes = 0;
  const entries = continuation.content.frames.map(frame => {
    const previousSha256 = tail; bytes += frame.utf8Bytes; natural.parse(bytes);
    tail = digest(`${tail}:${frame.index}:${frame.sha256}:${frame.utf8Bytes}`);
    return { ...frame, previousSha256, cumulativeBytes: bytes, chainSha256: tail };
  });
  const header = { schemaVersion: 1, purpose: "private_synthesis_thematic_frame_plan", requestId: body.requestId,
    campaignId: request.campaignId, workspaceId: request.workspaceId, actorId: body.actorId,
    intentSha256: body.intentSha256, thematicRequestSha256: body.thematicRequestSha256, recipeId: body.recipeId, recipeSha256: body.recipeSha256,
    continuationHeaderSha256: continuation.headerSha256, contentManifestSha256: body.contentManifestSha256,
    inputManifestSha256: body.inputManifestSha256, inputSealSha256: body.inputSealSha256,
    frameByteLimit: continuation.content.manifest.frameByteLimit, taskByteLimit: body.taskByteLimit,
    frameCount: entries.length, taskCount: body.taskCount, frameBytes: bytes, tailSha256: tail };
  const headerText = JSON.stringify(header);
  return { header, headerText, headerSha256: digest(headerText), seedSha256, entries, continuation };
}
export type SynthesisThematicStagingPlan = ReturnType<typeof createSynthesisThematicStagingPlan>;

/** Verify retained scope, exact bytes, complete prefix and the final proposal
 * reference against reconstructed originals. Native custody remains distinct
 * from independent provider output and current execution authorization.
 */
export function verifySynthesisThematicStagingState(plan: SynthesisThematicStagingPlan, raw: unknown) {
  const state = synthesisThematicStagingStateSchema.parse(raw), header = plan.header;
  if (state.requestId !== header.requestId || state.campaignId !== header.campaignId || state.workspaceId !== header.workspaceId
    || state.headerText !== plan.headerText || state.headerSha256 !== plan.headerSha256 || state.nextIndex > plan.entries.length) {
    throw new Error("Retained thematic staging identity differs");
  }
  const last = plan.entries[state.nextIndex - 1];
  if (state.frameBytes !== (last?.cumulativeBytes ?? 0) || state.tailSha256 !== (last?.chainSha256 ?? plan.seedSha256)) {
    throw new Error("Retained thematic frame prefix differs");
  }
  if (state.seal) {
    if (state.nextIndex !== plan.entries.length || digest(state.seal.receiptText) !== state.seal.receiptSha256) {
      throw new Error("Thematic frame seal is incomplete or corrupt");
    }
    const receipt = z.object({ schemaVersion: z.literal(1), requestId: z.literal(header.requestId), headerSha256: z.literal(plan.headerSha256),
      frameCount: z.literal(header.frameCount), taskCount: z.literal(header.taskCount), frameBytes: z.literal(header.frameBytes), tailSha256: z.literal(header.tailSha256),
      proposalReferenceText: z.string(), proposalReferenceSha256: hash, sealedAt: z.string().datetime({ offset: true }) }).strict().parse(JSON.parse(state.seal.receiptText));
    if (digest(receipt.proposalReferenceText) !== receipt.proposalReferenceSha256) throw new Error("Thematic proposal reference checksum differs");
    z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_proposal_reference"), taskIndex: z.literal(header.frameCount),
      inputManifestSha256: z.literal(header.inputManifestSha256), inputSealSha256: z.literal(header.inputSealSha256),
      continuationHeaderSha256: z.literal(header.continuationHeaderSha256), contentManifestSha256: z.literal(header.contentManifestSha256),
      frameTailSha256: z.literal(header.tailSha256) }).strict().parse(JSON.parse(receipt.proposalReferenceText));
  }
  return state;
}

/** Count JSON transport escaping as well as the 128-frame page ceiling. */
export function synthesisThematicFrameBatch(plan: SynthesisThematicStagingPlan, start: number) {
  natural.max(plan.entries.length).parse(start);
  if (start === plan.entries.length) return null;
  const texts: string[] = []; let framesText = "[]";
  for (const frame of plan.entries.slice(start, start + 128)) {
    const candidate = JSON.stringify([...texts, frame.canonical]);
    if (Buffer.byteLength(candidate, "utf8") > 4_194_304) break;
    texts.push(frame.canonical); framesText = candidate;
  }
  if (!texts.length) throw new Error("Thematic frame exceeds the staging packet limit");
  return { start, previousSha256: plan.entries[start].previousSha256, framesText, nextIndex: start + texts.length };
}
