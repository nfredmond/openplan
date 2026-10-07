import { createHash } from "node:crypto";

export const thematicUiId = (n: number) => `c7760000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const thematicUiHash = (value: string) => createHash("sha256").update(value).digest("hex");
const id = thematicUiId, hash = thematicUiHash;
export function thematicChoiceUiFixture() {
  const scope = { campaignId: id(1), workspaceId: id(2), sourceId: id(3), sourceSha256: hash("source"), requestId: id(4), actorId: id(5), requestIntentSha256: hash("intent") };
  const parent = { parentRequestId: id(6), parentActorId: id(7), parentIntentSha256: hash("parent"), sourceId: scope.sourceId,
    sourceSha256: scope.sourceSha256, throughSequence: 4, segmentResultsManifestSha256: hash("segments") };
  const entries = Array.from({ length: 26 }, (_, i) => ({ recordId: `item:${id(100 + i)}`, kind: "item", label: `Synthetic contribution ${i + 1}`,
    excerpt: `Synthetic original ${i + 1}`, excerptTruncated: false }));
  const entry = { requestId: id(8), actorId: id(9), intentSha256: hash("context-intent"), createdAt: "2026-10-07T08:00:00.123456Z",
    stage: "context", parentRequestId: parent.parentRequestId, cancelled: false };
  function command(targetRecordId = entries[0].recordId) {
    const choiceText = JSON.stringify({ schemaVersion: 1, targetRecordId, contextRequestId: entry.requestId, selectionSequence: 13,
      historyManifestSha256: hash("history"), finalCaptureSha256: hash("capture"), finalResultSha256: hash("result") });
    return { requestId: scope.requestId, targetRecordId, contextRequestId: entry.requestId, throughSequence: 13,
      expected: { requestIntentSha256: scope.requestIntentSha256, thematicSha256: hash("thematic"), choiceText } };
  }
  const choice = (targetRecordId = entries[0].recordId) => ({ schemaVersion: 1 as const, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    requestId: scope.requestId, targetRecordId, choiceText: command(targetRecordId).expected.choiceText,
    choiceSha256: hash(command(targetRecordId).expected.choiceText), createdBy: scope.actorId, createdAt: entry.createdAt, replayed: false });
  const contributionPage = (offset = 0, selected = true) => ({ schemaVersion: 1, ...scope, thematicSha256: hash("thematic"),
    page: { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, parent, cancelled: false, interpretation: "not_assessed",
      offset, pageSize: 25, total: 26, nextOffset: offset === 0 ? 25 : null, entries: entries.slice(offset, offset + 25) },
    choices: entries.slice(offset, offset + 25).map(row => selected ? choice(row.recordId) : null) });
  const contextPage = { schemaVersion: 1, ...scope, thematicSha256: hash("thematic"), targetRecordId: entries[0].recordId, parentRequestId: parent.parentRequestId,
    history: { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
      pageSize: 25, entries: [entry], nextCursor: null as null | { id: string; createdAt: string } }, eligibleRequestIds: [entry.requestId] };
  const progress = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
    requestId: entry.requestId, actorId: entry.actorId, requestIntentSha256: entry.intentSha256, stage: "context", checkedAt: entry.createdAt,
    cancelled: false, status: "frames_complete", interpretation: "machine_unreviewed", selectionSequence: 13, manifestSha256: hash("history"),
    taskCount: 1, counts: [{ disposition: "verified", count: 1 }] };
  const noteText = "SYNTHETIC context wording, not a reviewed finding.";
  const outputExcerpt = JSON.stringify({ status: "complete", coveredPartIds: [hash("part")], notes: [{ id: 0, text: noteText,
    citations: [{ partId: hash("part"), quote: "SYNTHETIC original contribution" }], relatedNoteIds: [] }], uncertainties: ["SYNTHETIC uncertainty"] });
  const preview = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: scope.actorId,
    command: command(), choiceSha256: choice().choiceSha256, cancelled: false, outputText: outputExcerpt, outputExcerpt, outputExcerptTruncated: false,
    outputBytes: Buffer.byteLength(outputExcerpt), outputSha256: hash(outputExcerpt), interpretation: "machine_unreviewed" };
  const recoveryScope = { userId: scope.actorId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, requestId: scope.requestId, targetRecordId: entries[0].recordId };
  return { scope, parent, entries, entry, command, choice, contributionPage, contextPage, progress, preview, recoveryScope, noteText };
}
