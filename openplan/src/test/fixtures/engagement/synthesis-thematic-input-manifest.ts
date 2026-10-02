import { sourceActor, sourceDate, sourceHash as hash, savedSource, makeSourceSnapshot } from "./synthesis-source";
import { createSynthesisThematicInputManifest } from "@/lib/engagement/synthesis-thematic-input-manifest";

/** Synthetic custody descriptors only. This fixture does not claim original
 * provider execution; the preparation and native HTTP suites cover that path.
 */
export function thematicInputManifestFixture(snapshot = makeSourceSnapshot(301)) {
  const source = savedSource(snapshot), requestId = "f3000000-0000-4000-8000-000000000001";
  const scope = { campaignId: source.campaignId, workspaceId: source.workspaceId, requestId };
  const intentText = JSON.stringify({ schemaVersion: 1, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
    connectionId: "f3000000-0000-4000-8000-000000000002", configurationRevisionId: "f3000000-0000-4000-8000-000000000003",
    configurationHash: hash("SYNTHETIC configuration"), modelId: "synthetic-custody-only", taskByteLimit: 4096 });
  const parentRequestId = "f3000000-0000-4000-8000-000000000004";
  const thematicText = JSON.stringify({ schemaVersion: 1, parentRequestId, selectionSequence: 1,
    segmentResultsManifestSha256: hash("SYNTHETIC parent"), contextManifestSha256: hash("SYNTHETIC context"), frameByteLimit: 4096 });
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, request: { id: requestId, actorId: sourceActor,
    intentText, intentSha256: hash(intentText), createdAt: sourceDate },
    thematic: { parentRequestId, thematicText, thematicSha256: hash(thematicText), createdAt: sourceDate }, cancellation: null as unknown };
  const targets = [...snapshot.items.map(row => `item:${row.id}`), ...snapshot.answers.map(row => `answer:${row.id}`)].sort();
  const entries = targets.map((targetRecordId, index) => {
    const outputText = JSON.stringify({ notes: ["SYNTHETIC machine note 中文 é " + index], uncertainties: ["Not a model accuracy observation"] });
    const proofText = JSON.stringify({ schemaVersion: 1, purpose: "private_synthesis_thematic_input", ...scope, targetRecordId,
      actorId: sourceActor, intentSha256: request.request.intentSha256, thematicSha256: request.thematic.thematicSha256,
      sourceId: source.requestId, sourceSha256: source.snapshotSha256, choiceSha256: hash(`choice:${targetRecordId}`),
      contextRequestId: `f4000000-0000-4000-8000-${String(index).padStart(12, "0")}`, contextRequestSha256: hash(`context:${targetRecordId}`),
      historyManifestSha256: hash(`history:${targetRecordId}`), finalCaptureSha256: hash(`capture:${targetRecordId}`),
      finalResultSha256: hash(`result:${targetRecordId}`), outputSha256: hash(outputText) });
    return { targetRecordId, proofText, proofSha256: hash(proofText), outputSha256: hash(outputText), outputBytes: Buffer.byteLength(outputText) };
  });
  const build = () => createSynthesisThematicInputManifest(request, scope, source, entries);
  const makeSeal = (plan = build()) => {
    const receiptText = JSON.stringify({ schemaVersion: 1, purpose: "private_synthesis_thematic_input_seal", requestId,
      manifestSha256: plan.manifestSha256, sealedAt: sourceDate });
    return { manifestText: plan.manifestText, manifestSha256: plan.manifestSha256, receiptText, receiptSha256: hash(receiptText) };
  };
  return { source, snapshot, scope, request, targets, entries, build, makeSeal };
}
