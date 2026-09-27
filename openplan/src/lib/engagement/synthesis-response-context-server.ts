import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { closeLoopEntrySchema } from "./close-loop";
import { responseHistoryMetadataSchema } from "./response-history";
import { readSynthesisApprovalEvent, synthesisApprovalPacketSchema } from "./synthesis-approval";
import { prepareSynthesisSource } from "./synthesis-preparation";
import { verifySynthesisReviewContent } from "./synthesis-review";
import { verifySynthesisSource } from "./synthesis-sources-server";

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const scopeSchema = z.object({ campaignId: uuid, workspaceId: uuid, reviewId: uuid, responseId: uuid }).strict();
export type SynthesisResponseContextScope = z.infer<typeof scopeSchema>;
const packetSchema = z.object({ contextText: z.string(), contextSha256: digest }).strict();
const contextSchema = z.object({
  schemaVersion: z.literal(1), visibility: z.literal("private"), purpose: z.literal("reviewed_synthesis_response"),
  ...scopeSchema.shape,
  sourceId: uuid, sourceSha256: digest, source: z.unknown(),
  preparationText: z.string(), preparationSha256: digest,
  revision: z.object({ id: uuid, number: positive, contentText: z.string(), contentSha256: digest }).strict(),
  approval: synthesisApprovalPacketSchema,
  groupId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  responseHistory: responseHistoryMetadataSchema.extend({ recordText: z.string() }).strict(),
}).strict();

function checkHash(text: string, expected: string, name: string) {
  if (!text.isWellFormed() || text.includes("\0")) throw new Error(`${name} contains invalid text`);
  if (createHash("sha256").update(text, "utf8").digest("hex") !== expected) throw new Error(`${name} checksum differs`);
}

/**
 * Read complete private evidence independently of current source availability.
 * Hashes prove byte identity, not authority. The writer must verify saved review
 * lineage, current approval and response heads, and staff access in its transaction.
 * Current withdrawal or removal never rewrites an already retained context.
 */
export async function readSynthesisResponseContext(raw: unknown, expected: SynthesisResponseContextScope) {
  const scope = scopeSchema.parse(expected), packet = packetSchema.parse(raw);
  checkHash(packet.contextText, packet.contextSha256, "Synthesis response context");
  const context = contextSchema.parse(JSON.parse(packet.contextText));
  if (context.campaignId !== scope.campaignId || context.workspaceId !== scope.workspaceId
    || context.reviewId !== scope.reviewId || context.responseId !== scope.responseId) {
    throw new Error("Synthesis response context scope differs");
  }
  const source = verifySynthesisSource(context.source, {
    campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: context.sourceId,
  });
  checkHash(source.snapshotText, source.snapshotSha256, "Retained source");
  if (source.snapshotSha256 !== context.sourceSha256) throw new Error("Synthesis response source identity differs");
  checkHash(context.preparationText, context.preparationSha256, "Retained preparation");
  const preparation = prepareSynthesisSource(source.snapshot, source.snapshotSha256);
  if (!isDeepStrictEqual(JSON.parse(context.preparationText), preparation)) throw new Error("Synthesis response preparation differs from source");
  checkHash(context.revision.contentText, context.revision.contentSha256, "Retained review");
  const content = verifySynthesisReviewContent(JSON.parse(context.revision.contentText), source.snapshot, source.snapshotSha256);
  const approval = await readSynthesisApprovalEvent(context.approval, {
    campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId,
    sourceId: context.sourceId, sourceSha256: context.sourceSha256, preparationSha256: context.preparationSha256,
  });
  if (approval.intent.operation !== "approve" || approval.intent.revisionId !== context.revision.id
    || approval.intent.revisionNo !== context.revision.number || approval.intent.revisionSha256 !== context.revision.contentSha256) {
    throw new Error("Synthesis response requires the exact retained approval");
  }
  const group = content.groups.find(row => row.id === context.groupId);
  if (!group) throw new Error("Synthesis response group is unavailable");
  const history = context.responseHistory;
  if (history.campaign_id !== scope.campaignId || history.response_id !== scope.responseId || history.event === "removed") {
    throw new Error("Synthesis response history scope or event differs");
  }
  checkHash(history.recordText, history.record_sha256, "Retained response");
  const response = closeLoopEntrySchema.passthrough().parse(JSON.parse(history.recordText));
  if (response.id !== scope.responseId || response.campaign_id !== scope.campaignId) throw new Error("Synthesis response record scope differs");
  return { packet, context, source, preparation, content, approval, group, response };
}
