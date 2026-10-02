import { thematicInputManifestFixture } from "./synthesis-thematic-input-manifest";
import { makeSourceSnapshot, sourceHash as hash } from "./synthesis-source";
import { verifySynthesisThematicRequest } from "@/lib/engagement/synthesis-thematic-requests-server";
import { verifySynthesisThematicInputSeal } from "@/lib/engagement/synthesis-thematic-input-manifest";
import { createSynthesisThematicContinuation } from "@/lib/engagement/synthesis-thematic-continuation";
import type { SynthesisThematicPreparedInputs, SynthesisThematicPart } from "@/lib/engagement/synthesis-thematic-content";

/** Synthetic trusted custody for pure protocol tests. Original history and
 * current native permissions are exercised through the separate reader fixture.
 */
export function thematicContinuationFixture(count = 1, taskByteLimit = 1_048_576, sourceTextTransform = (text: string) => text) {
  const snapshot = makeSourceSnapshot(count);
  if (snapshot.items[0]) snapshot.items[0].body = 'SYNTHETIC "é 中文 😀" \\ text '.repeat(180) + 'FINAL ORIGINAL TAIL';
  const f = thematicInputManifestFixture(snapshot);
  f.source.snapshotText = sourceTextTransform(f.source.snapshotText); f.source.snapshotSha256 = hash(f.source.snapshotText);
  f.request.request.intentText = JSON.stringify({ ...JSON.parse(f.request.request.intentText), sourceSha256: f.source.snapshotSha256, taskByteLimit });
  f.request.request.intentSha256 = hash(f.request.request.intentText);
  const originals = f.entries.map((entry, index) => {
    const outputText = JSON.stringify({ status: "complete", coveredPartIds: [hash(`part${index}`)], notes: [{ id: 0,
      text: `SYNTHETIC concern ${index} é 中文 😀`, citations: [{ partId: hash(`part${index}`), quote: "SYNTHETIC" }], relatedNoteIds: [] }],
      uncertainties: ["SYNTHETIC original uncertainty", "\ud800", "NUL\0 preserved"] }, null, 2);
    entry.proofText = JSON.stringify({ ...JSON.parse(entry.proofText), sourceSha256: f.source.snapshotSha256, intentSha256: f.request.request.intentSha256, outputSha256: hash(outputText) });
    entry.proofSha256 = hash(entry.proofText); entry.outputSha256 = hash(outputText); entry.outputBytes = Buffer.byteLength(outputText);
    return { targetRecordId: entry.targetRecordId, proofText: entry.proofText, outputText };
  });
  const plan = f.build(), seal = verifySynthesisThematicInputSeal(f.makeSeal(plan), plan);
  const input = { manifestSha256: plan.manifestSha256, sourceId: f.source.requestId, sourceSha256: f.source.snapshotSha256,
    contexts: plan.entries.map(({ metadata, proof }, i) => { const output = JSON.parse(originals[i].outputText);
      return { sourceId: metadata.targetRecordId, contextRequestId: proof.contextRequestId, selectionSequence: 1,
        historyManifestSha256: proof.historyManifestSha256, finalCaptureSha256: proof.finalCaptureSha256, finalResultSha256: proof.finalResultSha256,
        notes: output.notes.map((note: { id: number; text: string }) => ({ id: note.id, text: note.text })), uncertainties: output.uncertainties }; }) };
  const prepared: SynthesisThematicPreparedInputs = { request: verifySynthesisThematicRequest(f.request, f.scope), source: f.source, plan, seal, input, originals };
  const create = (retained: readonly unknown[] = []) => createSynthesisThematicContinuation(prepared, retained);
  return { ...f, prepared, create };
}

export function thematicSyntheticResponse(task: Extract<ReturnType<ReturnType<typeof createSynthesisThematicContinuation>["next"]>, { status: "ready" }>) {
  const body = JSON.parse(task.task.canonical).input;
  const previous = body.previous ? JSON.parse(body.previous.outputText) : { notes: [], uncertainties: [] };
  if (task.stage === "proposal") return { status: "complete", title: "SYNTHETIC proposed themes", notes: "Unreviewed",
    groups: [{ id: "theme", label: "SYNTHETIC issue", summary: "SYNTHETIC interpretation", sentiment: "not_assessed",
      members: body.contexts.map((context: { sourceId: string }) => ({ sourceId: context.sourceId, rationale: "SYNTHETIC relationship",
        citations: [{ noteId: 0, quote: "é 中文 😀" }] })) }], unassigned: [], uncertainties: previous.uncertainties };
  const parts = body.frame.parts as SynthesisThematicPart[], cited = parts.find(part => "text" in part && part.text.length);
  const notes = previous.notes.length || !cited || !("text" in cited) ? previous.notes : [{ id: 0, text: "SYNTHETIC frame interpretation",
    citations: [{ partId: cited.id, quote: Array.from(cited.text)[0] }], relatedNoteIds: [] }];
  return { status: "complete", coveredPartIds: parts.map(part => part.id), notes,
    uncertainties: previous.uncertainties.length ? previous.uncertainties : ["SYNTHETIC minority position remains uncertain"] };
}
