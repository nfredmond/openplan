import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { verifySynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { verifySynthesisThematicInputProof } from "./synthesis-thematic-inputs-server";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const metadataSchema = z.object({ targetRecordId: target, proofText: z.string(), proofSha256: hash,
  outputSha256: hash, outputBytes: natural.min(1).max(4_194_304) }).strict();
const sealSchema = z.object({ manifestText: z.string(), manifestSha256: hash, receiptText: z.string(), receiptSha256: hash }).strict();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
type Scope = z.infer<typeof scopeSchema>;

/** Check bounded metadata without substituting invented raw output. Actual
 * output bytes and original context must be replayed before task execution.
 */
export function verifySynthesisThematicInputMetadata(raw: unknown, rawScope: Scope) {
  const scope = scopeSchema.parse(rawScope), metadata = metadataSchema.parse(raw);
  const proof = verifySynthesisThematicInputProof(metadata.proofText, { ...scope, targetRecordId: metadata.targetRecordId });
  if (digest(metadata.proofText) !== metadata.proofSha256 || proof.outputSha256 !== metadata.outputSha256) {
    throw new Error("Thematic input metadata differs from its proof");
  }
  return { metadata, proof };
}

/** Compute exact complete-source custody in a fixed ASCII identifier order.
 * The native seal recomputes membership and this chain from its own originals.
 * This is not semantic replay, a thematic recipe or execution authorization.
 */
export function createSynthesisThematicInputManifest(rawRequest: unknown, rawScope: Scope, rawSource: unknown, rawEntries: readonly unknown[]) {
  const scope = scopeSchema.parse(rawScope), request = verifySynthesisThematicRequest(rawRequest, scope);
  const source = verifySynthesisSource(rawSource, { ...scope, requestId: request.intent.sourceId });
  if (source.snapshotSha256 !== request.intent.sourceSha256) throw new Error("Thematic manifest source differs from request");
  const expected = [...source.snapshot.items.map(row => `item:${row.id}`), ...source.snapshot.answers.map(row => `answer:${row.id}`)].sort();
  if (!expected.length) throw new Error("An empty source requires no thematic model work");
  const entries = rawEntries.map(row => verifySynthesisThematicInputMetadata(row, scope))
    .sort((a, b) => a.metadata.targetRecordId < b.metadata.targetRecordId ? -1 : a.metadata.targetRecordId > b.metadata.targetRecordId ? 1 : 0);
  if (!isDeepStrictEqual(entries.map(row => row.metadata.targetRecordId), expected)
    || new Set(entries.map(row => row.proof.contextRequestId)).size !== entries.length) {
    throw new Error("Thematic input membership is incomplete or differs from the complete source");
  }
  const seedSha256 = digest(`synthesis-thematic-inputs-v1:${scope.requestId}:${scope.campaignId}:${scope.workspaceId}:${request.state.request.actorId}:${request.state.request.intentSha256}:${request.state.thematic.thematicSha256}:${source.requestId}:${source.snapshotSha256}`);
  let tailSha256 = seedSha256, outputBytes = 0;
  for (const { metadata, proof } of entries) {
    if (proof.actorId !== request.state.request.actorId || proof.intentSha256 !== request.state.request.intentSha256
      || proof.thematicSha256 !== request.state.thematic.thematicSha256 || proof.sourceId !== source.requestId || proof.sourceSha256 !== source.snapshotSha256) {
      throw new Error("Thematic input proof differs from the manifest request");
    }
    outputBytes += metadata.outputBytes; natural.parse(outputBytes);
    tailSha256 = digest(`${tailSha256}:${metadata.targetRecordId}:${metadata.proofSha256}:${metadata.outputSha256}:${metadata.outputBytes}`);
  }
  const manifest = { schemaVersion: 1, purpose: "private_synthesis_thematic_input_manifest", ...scope,
    actorId: request.state.request.actorId, intentSha256: request.state.request.intentSha256,
    thematicSha256: request.state.thematic.thematicSha256, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
    inputCount: entries.length, outputBytes, seedSha256, tailSha256 };
  const manifestText = JSON.stringify(manifest);
  return { manifest, manifestText, manifestSha256: digest(manifestText), entries };
}
export type SynthesisThematicInputManifest = ReturnType<typeof createSynthesisThematicInputManifest>;

/** Compare the exact stored manifest and receipt with independently recomputed
 * complete-source custody. A self-hashed but different manifest is refused.
 */
export function verifySynthesisThematicInputSeal(raw: unknown, plan: SynthesisThematicInputManifest) {
  const seal = sealSchema.parse(raw);
  if (seal.manifestText !== plan.manifestText || seal.manifestSha256 !== plan.manifestSha256
    || Buffer.byteLength(seal.manifestText, "utf8") > 8192 || Buffer.byteLength(seal.receiptText, "utf8") > 8192
    || digest(seal.manifestText) !== seal.manifestSha256 || digest(seal.receiptText) !== seal.receiptSha256) {
    throw new Error("Thematic input seal differs from reconstructed custody");
  }
  const receipt = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_input_seal"),
    requestId: z.literal(plan.manifest.requestId), manifestSha256: z.literal(plan.manifestSha256),
    sealedAt: z.string().datetime({ offset: true }) }).strict().parse(JSON.parse(seal.receiptText));
  return { ...seal, receipt };
}
