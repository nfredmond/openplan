import { describe, expect, it } from "vitest";
import { createSynthesisThematicProposal, SynthesisThematicOutputError } from "@/lib/engagement/synthesis-thematic-proposal";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

/** Synthetic trusted-input descriptors exercise output conversion, not native
 * history authentication. No provider or staff action runs in these tests.
 */
function fixture(count = 1) {
  const snapshot = makeSourceSnapshot(count), saved = savedSource(snapshot), taskSha256 = sourceHash("SYNTHETIC thematic task");
  const sourceIds = [...snapshot.items.map(row => `item:${row.id}`), ...snapshot.answers.map(row => `answer:${row.id}`)];
  const input = { manifestSha256: sourceHash("SYNTHETIC input"), sourceId: saved.requestId, sourceSha256: saved.snapshotSha256,
    contexts: sourceIds.map((sourceId, index) => ({ sourceId, contextRequestId: `e0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      selectionSequence: 1, historyManifestSha256: sourceHash(`history ${index}`), finalCaptureSha256: sourceHash(`capture ${index}`),
      finalResultSha256: sourceHash(`result ${index}`), notes: [{ id: 0, text: `SYNTHETIC concern ${index} 保留 😀` }],
      uncertainties: [`SYNTHETIC unknown ${index}`, "\ud800", "original\0uncertainty"] })) };
  const member = (id: string) => ({ sourceId: id, rationale: "SYNTHETIC proposed relationship",
    citations: [{ noteId: 0, quote: "保留 😀" }] });
  const output = { status: "complete", title: "SYNTHETIC machine proposal", notes: "SYNTHETIC unreviewed interpretation",
    groups: [{ id: "theme-a", label: "SYNTHETIC issue", summary: "SYNTHETIC interpretation", sentiment: "not_assessed", members: sourceIds.map(member) }],
    unassigned: [] as Array<{ sourceId: string; reason: string; citations: Array<{ noteId: number; quote: string }> }>, uncertainties: ["SYNTHETIC unresolved theme"] };
  function run(outputText = JSON.stringify(output), patch: Record<string, unknown> = {}) {
    return createSynthesisThematicProposal(saved, sourceScope, input, taskSha256, { taskSha256, outputText, finishReason: "stop", ...patch });
  }
  return { snapshot, saved, input, sourceIds, output, member, run, taskSha256 };
}

describe("machine thematic proposal conversion", () => {
  it("preserves all 302 mixed contributions, exact output bytes and uncertainty without creating staff authorship", () => {
    const f = fixture(301), before = JSON.stringify(f.input);
    f.output.notes = "SYNTHETIC texte 日本語 😀 ".repeat(200) + "FINAL NOTE TAIL";
    const original = JSON.stringify(f.output, null, 2), result = f.run(original);
    expect(result.outputText).toBe(original); expect(result.content.outputSha256).toBe(sourceHash(original));
    expect(result.content).toMatchObject({ status: "machine_unreviewed", inputManifestSha256: f.input.manifestSha256,
      taskSha256: f.taskSha256, sourceId: f.saved.requestId, sourceSha256: f.saved.snapshotSha256,
      assignedSourceCount: 302, overlappingSourceCount: 0, unassignedSourceIds: [], notes: f.output.notes });
    expect(result.content.groups[0].sourceIds).toEqual([...f.sourceIds].sort());
    expect(result.content.contextEvidence).toEqual([...f.input.contexts].sort((a, b) => a.sourceId < b.sourceId ? -1 : 1));
    expect(result.content.thematicUncertainties).toEqual(f.output.uncertainties);
    expect(result.content).not.toHaveProperty("actorId"); expect(result.content).not.toHaveProperty("approval");
    expect(result.canonical).toBe(JSON.stringify(result.content)); expect(result.sha256).toBe(sourceHash(result.canonical));
    expect(JSON.stringify(f.input)).toBe(before);
  });
  it("counts unique contributions with overlap and retains a reason for unassigned evidence", () => {
    const f = fixture(2), excluded = f.sourceIds[2];
    f.output.groups[0].members.pop();
    f.output.groups.push({ ...f.output.groups[0], id: "minority", members: [f.member(f.sourceIds[0])] });
    f.output.unassigned.push({ sourceId: excluded, reason: "SYNTHETIC ambiguous answer", citations: [] });
    const { content } = f.run();
    expect(content).toMatchObject({ assignedSourceCount: 2, overlappingSourceCount: 1, unassignedSourceIds: [excluded], unassigned: f.output.unassigned });
    expect(content.groups[1].members).toEqual(f.output.groups[1].members);
    expect(content.contextEvidence).toHaveLength(3);
  });
  it("allows survey-only evidence with no contextual note to remain explicitly unassigned", () => {
    const f = fixture(0); f.input.contexts[0].notes = []; f.output.groups = [];
    f.output.unassigned.push({ sourceId: f.sourceIds[0], reason: "SYNTHETIC no interpretable context", citations: [] });
    expect(f.run().content).toMatchObject({ assignedSourceCount: 0, groups: [], unassignedSourceIds: f.sourceIds });
  });
  it("refuses source substitution", () => {
    const f = fixture(); f.input.sourceSha256 = "0".repeat(64);
    expect(() => f.run()).toThrow("Thematic input source differs");
  });
  it("refuses missing context even when the model explicitly leaves that source unassigned", () => {
    const f = fixture(); f.input.contexts.pop(); f.output.groups[0].members.pop();
    f.output.unassigned.push({ sourceId: f.sourceIds[1], reason: "SYNTHETIC missing input", citations: [] });
    expect(() => f.run()).toThrow("one context per selected contribution");
  });
  it("refuses repeated, unknown or reused context bindings", () => {
    const f = fixture(); f.input.contexts.push({ ...structuredClone(f.input.contexts[0]), contextRequestId: sourceScope.requestId });
    expect(() => f.run()).toThrow("one context per selected contribution"); f.input.contexts.pop();
    f.input.contexts[1].contextRequestId = f.input.contexts[0].contextRequestId;
    expect(() => f.run()).toThrow("one context per selected contribution");
    f.input.contexts[1].sourceId = `item:${sourceScope.requestId}`;
    expect(() => f.run()).toThrow("one context per selected contribution");
  });
  it("refuses out-of-order context note IDs", () => {
    const f = fixture(); f.input.contexts[0].notes[0].id = 1;
    expect(() => f.run()).toThrow("context note identifiers differ");
  });
  it("refuses an empty-source model proposal", () => {
    const f = fixture(0); f.snapshot.answers = []; f.snapshot.counts.answers = 0;
    const saved = savedSource(f.snapshot); f.input.sourceSha256 = saved.snapshotSha256; f.input.contexts = [];
    expect(() => createSynthesisThematicProposal(saved, sourceScope, f.input, f.taskSha256,
      { taskSha256: f.taskSha256, outputText: JSON.stringify({ ...f.output, groups: [] }), finishReason: "stop" })).toThrow("requires no model proposal");
  });
  it.each([{ taskSha256: "0".repeat(64) }, { finishReason: "length" }, { finishReason: null }])("refuses another task or unfinished provider output %j", patch => {
    expect(() => fixture().run(undefined, patch)).toThrow("truncated or belongs to another task");
  });
  it("refuses retained output above the byte ceiling without clipping", () => {
    const f = fixture(); f.output.notes = "😀".repeat(1_048_576);
    expect(() => f.run()).toThrow("exceeds retention limit");
  });
  it("classifies malformed JSON as an output failure", () => {
    expect(() => fixture().run("{" )).toThrow(SynthesisThematicOutputError);
    expect(() => fixture().run("{" )).toThrow("not valid JSON");
  });
  it.each([
    { status: "incomplete" }, { assignedSourceCount: 999 }, { notes: "bad\0text" }, { notes: "\ud800" },
    { title: " " }, { approval: { status: "approved" } },
  ])("refuses incomplete, unsafe or self-promoted output %j", patch => {
    const f = fixture(); expect(() => f.run(JSON.stringify({ ...f.output, ...patch }))).toThrow("output schema differs");
  });
  it("refuses unknown contributions", () => {
    const f = fixture(); f.output.groups[0].members.push(f.member(`item:${sourceScope.requestId}`));
    expect(() => f.run()).toThrow("unknown contribution");
  });
  it("refuses an unknown unassigned contribution even without citations", () => {
    const f = fixture(); f.output.unassigned.push({ sourceId: `item:${sourceScope.requestId}`, reason: "SYNTHETIC unavailable", citations: [] });
    expect(() => f.run()).toThrow("unknown contribution");
  });
  it("refuses omitted contributions", () => {
    const f = fixture(); f.output.groups[0].members.pop();
    expect(() => f.run()).toThrow("omits a selected contribution");
  });
  it("refuses duplicate groups", () => {
    const f = fixture(); f.output.groups.push(structuredClone(f.output.groups[0]));
    expect(() => f.run()).toThrow("repeats a group identifier");
  });
  it("refuses duplicate members within a group", () => {
    const f = fixture(); f.output.groups[0].members.push(f.member(f.sourceIds[0]));
    expect(() => f.run()).toThrow("group repeats a contribution");
  });
  it("refuses assigned-unassigned and duplicate-unassigned conflicts", () => {
    const f = fixture(); f.output.unassigned.push({ sourceId: f.sourceIds[0], reason: "SYNTHETIC unclear", citations: [] });
    expect(() => f.run()).toThrow("unassigned membership conflicts");
    f.output.groups[0].members.shift(); f.output.unassigned.push(structuredClone(f.output.unassigned[0]));
    expect(() => f.run()).toThrow("unassigned membership conflicts");
  });
  it("refuses repeated citations", () => {
    const f = fixture(), references = f.output.groups[0].members[0].citations;
    references.push(structuredClone(references[0]));
    expect(() => f.run()).toThrow("repeats a citation");
  });
  it.each([{ noteId: 99, quote: "保留 😀" }, { noteId: 0, quote: "SYNTHETIC invented quotation" },
    { noteId: 0, quote: "SYNTHETIC concern 1" }])("refuses missing, fabricated or cross-contribution citations %j", reference => {
    const f = fixture(); f.output.groups[0].members[0].citations = [reference];
    expect(() => f.run()).toThrow("not retained context evidence");
  });
  it("requires nonempty groups, reasons and citations for assigned interpretations", () => {
    const f = fixture(); f.output.groups[0].members[0].citations = [];
    expect(() => f.run()).toThrow("output schema differs");
    f.output.groups[0].members = []; expect(() => f.run()).toThrow("output schema differs");
    f.output.groups = []; f.output.unassigned = f.sourceIds.map(sourceId => ({ sourceId, reason: " ", citations: [] }));
    expect(() => f.run()).toThrow("output schema differs");
  });
});
