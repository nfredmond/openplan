import { describe, expect, it } from "vitest";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords, type SynthesisGenerationField } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks, type SynthesisGenerationTaskInput } from "@/lib/engagement/synthesis-generation-tasks";
import { assembleSynthesisGenerationResults, createSynthesisGenerationResult, type SynthesisGenerationCapture } from "@/lib/engagement/synthesis-generation-results";
import { createSynthesisGenerationContext } from "@/lib/engagement/synthesis-generation-context";
import { createSynthesisGenerationContextContent, verifySynthesisGenerationContextContent } from "@/lib/engagement/synthesis-generation-context-content";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

function fixture(snapshot = makeSourceSnapshot(1), changeSaved?: (saved: ReturnType<typeof savedSource>) => void,
  changeCapture?: (capture: SynthesisGenerationCapture, index: number) => void) {
  const saved = savedSource(snapshot); changeSaved?.(saved);
  const input = createSynthesisGenerationInput(saved, sourceScope), records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
  const job = { jobId: "a0000000-0000-4000-8000-000000000010", planSha256: plan.manifestSha256,
    configurationRevisionId: "a0000000-0000-4000-8000-000000000011", configurationHash: "b".repeat(64),
    provider: "api_connection" as const, modelId: "synthetic-content" };
  const selections = records.contributionIds.length ? plan.tasks.map((task, index) => ({ taskSha256: task.sha256,
    attemptId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}` })) : [];
  const results = selections.map((selection, index) => {
    const binding = { ...job, ...selection }, { input } = JSON.parse(plan.tasks[index].canonical) as { input: SynthesisGenerationTaskInput };
    const cited = input.parts.find(part => "text" in part && part.text.length);
    const observations = cited && "text" in cited ? [
      { text: `SYNTHETIC position ${index}`, citations: [{ partId: cited.id, quote: cited.text.slice(0, 1) }] },
      { text: `SYNTHETIC conflicting position ${index}`, citations: [{ partId: cited.id, quote: cited.text.slice(0, 1) }] },
    ] : [];
    const capture: SynthesisGenerationCapture = { schemaVersion: 1, binding, startedAt: "2026-09-30T00:00:00Z",
      finishedAt: "2026-09-30T00:01:00Z", outcome: "returned", outputText: JSON.stringify({ status: "complete",
        coveredPartIds: input.parts.map(part => part.id), observations, uncertainty: `SYNTHETIC uncertainty ${index}` }),
      providerReceiptText: null, finishReason: "stop", responseId: null, inputTokens: null, outputTokens: null, failureCode: null };
    changeCapture?.(capture, index);
    return createSynthesisGenerationResult(binding, capture);
  });
  const args = { job, selections, results, plan, records, input, saved, scope: sourceScope, taskByteLimit: 4096 };
  const inventory = assembleSynthesisGenerationResults(args), sequence = selections.length;
  const context = createSynthesisGenerationContext(inventory, args, sequence);
  return { args, inventory, sequence, context };
}
type Content = ReturnType<typeof createSynthesisGenerationContextContent>;
type FramePart = { id: string; entityId: string; fieldIndex: number; fieldSha256: string; pointer: string;
  kind: SynthesisGenerationField["kind"]; childCount?: number; text?: string; start?: number; end?: number; length?: number };
function content(f: ReturnType<typeof fixture>, target = f.args.records.contributionIds[0], limit = 4096) {
  return createSynthesisGenerationContextContent(f.context, f.inventory, f.args, f.sequence, target, limit);
}

// Derive the expected tree independently. Original numeric spellings are string
// values inside sourceParts, so JSON.parse cannot round those retained tokens.
function expectedFields(value: unknown, pointer = "", fields: SynthesisGenerationField[] = []) {
  if (value === null) fields.push({ pointer, kind: "null", text: "null" });
  else if (typeof value === "string") fields.push({ pointer, kind: "string", text: value });
  else if (typeof value === "number") fields.push({ pointer, kind: "number", text: String(value) });
  else if (typeof value === "boolean") fields.push({ pointer, kind: "boolean", text: String(value) });
  else {
    const entries = Object.entries(value as object);
    fields.push({ pointer, kind: Array.isArray(value) ? "array" : "object", childCount: entries.length });
    for (const [key, child] of entries) expectedFields(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, fields);
  }
  return fields;
}
function checkFrames(value: Content) {
  const parts = value.frames.flatMap((frame, index) => {
    expect(frame.index).toBe(index); expect(frame.sha256).toBe(sourceHash(frame.canonical));
    expect(frame.utf8Bytes).toBe(Buffer.byteLength(frame.canonical, "utf8"));
    expect(frame.utf8Bytes).toBeLessThanOrEqual(value.frameByteLimit);
    const body = JSON.parse(frame.canonical);
    expect(body).toMatchObject({ schemaVersion: 1, purpose: "private_synthesis_context_content_frame", index,
      contextManifestSha256: value.contextManifestSha256, targetRecordId: value.targetRecordId, rangeUnit: "utf16_code_units" });
    expect(body.parts.length).toBeGreaterThan(0);
    return body.parts as FramePart[];
  });
  const byEntity = new Map<string, FramePart[]>();
  for (const part of parts) { const rows = byEntity.get(part.entityId) ?? []; rows.push(part); byEntity.set(part.entityId, rows); }
  expect(new Set(parts.map(part => part.id)).size).toBe(parts.length);
  expect([...byEntity.keys()]).toEqual(value.entities.map(entity => entity.id));
  for (const [index, entity] of value.entities.entries()) {
    expect(entity.index).toBe(index); expect(entity.sha256).toBe(sourceHash(entity.canonical));
    expect(entity.utf8Bytes).toBe(Buffer.byteLength(entity.canonical, "utf8"));
    expect(entity.id).toBe(sourceHash(`${value.contextManifestSha256}:${value.targetRecordId}:${index}:${entity.sha256}`));
    const fields = expectedFields(JSON.parse(entity.canonical)), rows = byEntity.get(entity.id)!;
    expect(entity.fieldsSha256).toBe(sourceHash(JSON.stringify(fields)));
    expect(new Set(rows.map(row => row.fieldIndex))).toEqual(new Set(fields.map((_, index) => index)));
    for (const [fieldIndex, field] of fields.entries()) {
      const fragments = rows.filter(row => row.fieldIndex === fieldIndex);
      for (const fragment of fragments) {
        const { id, ...address } = fragment;
        expect(id).toBe(sourceHash(JSON.stringify(address)));
        expect(fragment).toMatchObject({ pointer: field.pointer, kind: field.kind, fieldSha256: sourceHash(JSON.stringify(field)) });
      }
      if ("childCount" in field) { expect(fragments).toHaveLength(1); expect(fragments[0].childCount).toBe(field.childCount); }
      else {
        let end = 0;
        for (const fragment of fragments) {
          expect(fragment.start).toBe(end); expect(fragment.end! - fragment.start!).toBe(fragment.text!.length);
          expect(fragment.length).toBe(field.text.length);
          if (field.text.isWellFormed()) expect(fragment.text!.isWellFormed()).toBe(true);
          end = fragment.end!;
        }
        expect(end).toBe(field.text.length); expect(fragments.map(row => row.text).join("")).toBe(field.text);
      }
    }
  }
  const { manifestSha256, entities, frames, ...manifest } = value;
  expect(manifestSha256).toBe(sourceHash(JSON.stringify({ ...manifest,
    entities: entities.map(({ canonical: _canonical, ...row }) => row), frames: frames.map(({ canonical: _canonical, ...row }) => row) })));
}

describe("complete retained synthesis context content", () => {
  it("reconstructs every typed source part, observation, citation and uncertainty through bounded frames", () => {
    const snapshot = makeSourceSnapshot(2);
    snapshot.items[0].body = 'SYNTHETIC "quoted" \\ newline\n意見😀 e\u0301'.repeat(120) + "SOURCE TAIL";
    snapshot.items[0].parent_item_id = snapshot.items[1].id;
    const f = fixture(snapshot), before = JSON.stringify(f), value = content(f, `item:${snapshot.items[0].id}`);
    checkFrames(value); expect(value.frames.length).toBeGreaterThan(10);
    expect(value.inputStatus).toBe("ready_for_context_processing"); expect(value.interpretation).toBe("not_assessed");
    expect(value.contributionIds).toEqual(f.args.records.contributionIds);
    expect(value.source).toEqual(f.context.source); expect(value.selectionSequence).toBe(f.sequence);
    expect(value.requestId).toBe(f.args.job.jobId); expect(value.segmentResultsManifestSha256).toBe(f.inventory.manifestSha256);
    const segments = value.entities.filter(entity => entity.kind === "segment").map(entity => JSON.parse(entity.canonical));
    for (const segment of segments) {
      const task = f.args.plan.tasks[segment.taskIndex], original = JSON.parse(task.canonical).input;
      expect(segment).toMatchObject({ sourceParts: original.parts, originalRecordSha256: original.recordSha256,
        originalFieldsSha256: original.fieldsSha256, selectedOutput: f.inventory.entries[segment.taskIndex].parsed!.output });
    }
    expect(segments.flatMap(segment => segment.selectedOutput.observations).length).toBeGreaterThan(0);
    expect(segments.flatMap(segment => segment.sourceParts).filter(part => part.pointer === "/body").map(part => part.text).join("")).toContain(snapshot.items[0].body);
    expect(content(f, value.targetRecordId)).toEqual(value);
    expect(verifySynthesisGenerationContextContent(structuredClone(value), f.context, f.inventory, f.args, f.sequence, value.targetRecordId, 4096)).toEqual(value);
    expect(JSON.stringify(f)).toBe(before);
  });

  it("retains exact numeric tokens, empty values, escaped keys and malformed original Unicode", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.answers[0].answer_json = { "a/b~c": "NUMBER_MARKER", empty: "", yes: true, no: false, nil: null, array: [], object: {}, lone: "\ud800", nul: "\u0000" };
    const tokens = ["9007199254740993", "-0", "1.234567890123456789", "1e+999", "1.00e-99"];
    const f = fixture(snapshot, saved => {
      saved.snapshotText = saved.snapshotText.replace('"NUMBER_MARKER"', `[${tokens.join(",")}]`);
      saved.snapshotSha256 = sourceHash(saved.snapshotText);
    }), value = content(f, `answer:${snapshot.answers[0].id}`);
    checkFrames(value);
    const segments = value.entities.filter(entity => entity.kind === "segment").map(entity => JSON.parse(entity.canonical));
    const parts = segments.filter(row => row.recordId.startsWith("answer:")).flatMap(row => row.sourceParts);
    expect(parts.filter(row => row.pointer.startsWith("/answer_json/a~1b~0c/")).map(row => row.text)).toEqual(tokens);
    for (const token of ["", "true", "false", "null", "\ud800", "\u0000"]) expect(parts.some(row => row.text === token)).toBe(true);
    expect(parts.filter(row => row.childCount === 0)).toHaveLength(2);
    expect(value.entities.filter(entity => entity.kind === "record").map(entity => JSON.parse(entity.canonical).recordKind)).toEqual(["answer", "context", "session", "definition"]);
  });

  it("keeps complete Unicode observations across frame boundaries", () => {
    const f = fixture(makeSourceSnapshot(1), undefined, capture => {
      const output = JSON.parse(capture.outputText!);
      for (const observation of output.observations) observation.text = "😀".repeat(1995) + "FINAL";
      output.uncertainty = "意見😀".repeat(990) + "TAIL";
      capture.outputText = JSON.stringify(output);
    });
    const value = content(f); checkFrames(value);
    const segments = value.entities.filter(entity => entity.kind === "segment").map(entity => JSON.parse(entity.canonical));
    expect(segments.some(row => row.selectedOutput.observations.length)).toBe(true);
    for (const segment of segments) {
      expect(segment.selectedOutput.uncertainty).toBe("意見😀".repeat(990) + "TAIL");
      for (const observation of segment.selectedOutput.observations) expect(observation.text).toBe("😀".repeat(1995) + "FINAL");
    }
  });

  it("includes the last of 301 linked comments, retains cycle and unavailable edges, and counts only contributions", () => {
    const snapshot = makeSourceSnapshot(301);
    for (let index = 0; index < 300; index++) snapshot.items[index].parent_item_id = snapshot.items[index + 1].id;
    snapshot.items[300].parent_item_id = snapshot.items[0].id;
    const f = fixture(snapshot), value = content(f, `item:${snapshot.items[0].id}`, 65536);
    const records = value.entities.filter(row => row.kind === "record").map(row => JSON.parse(row.canonical));
    expect(records).toHaveLength(303); expect(new Set(records.map(row => row.recordId)).size).toBe(303);
    expect(records.filter(row => row.contribution)).toHaveLength(301); expect(value.contributionIds).toHaveLength(302);
    expect(value.entities.filter(row => row.kind === "reference").map(row => JSON.parse(row.canonical))).toContainEqual({
      kind: "reference", recordId: `item:${snapshot.items[300].id}`, targetId: `item:${snapshot.items[0].id}`, retained: true });
    const segments = value.entities.filter(row => row.kind === "segment").map(row => JSON.parse(row.canonical));
    expect(segments.map(row => row.taskIndex)).toEqual(records.flatMap(row => f.inventory.entries.filter(entry => entry.recordId === row.recordId).map(entry => entry.taskIndex)));
    expect(segments.filter(row => row.recordId === `item:${snapshot.items[300].id}`).flatMap(row => row.sourceParts).filter(row => row.pointer === "/body").map(row => row.text).join("")).toBe(snapshot.items[300].body);
    const missing = makeSourceSnapshot(1); missing.items[0].parent_item_id = "e0000000-0000-4000-8000-000000000099";
    const absent = content(fixture(missing), `item:${missing.items[0].id}`);
    expect(absent.entities.filter(row => row.kind === "reference").map(row => JSON.parse(row.canonical))).toContainEqual({
      kind: "reference", recordId: `item:${missing.items[0].id}`, targetId: `item:${missing.items[0].parent_item_id}`, retained: false });
  }, 30000);

  it("preserves incomplete results and binds late arrivals to different content", () => {
    const f = fixture(makeSourceSnapshot(1), undefined, (capture, index) => {
      if (index === 0) { capture.outcome = "failed"; capture.failureCode = "synthetic_failure"; capture.outputText = null; }
      if (index === 1) capture.finishReason = "length";
      if (index === 2) capture.outputText = "INVALID SYNTHETIC JSON";
    }), value = content(f, f.context.records[0].id);
    expect(value.inputStatus).toBe("incomplete");
    const segments = value.entities.filter(row => row.kind === "segment").map(row => JSON.parse(row.canonical));
    expect(segments.find(row => row.taskIndex === 0)).toMatchObject({ disposition: "failed", selectedOutput: null });
    expect(segments.find(row => row.taskIndex === 1)).toMatchObject({ disposition: "provider_incomplete", selectedOutput: { status: "complete" } });
    expect(segments.find(row => row.taskIndex === 2)).toMatchObject({ disposition: "invalid_output", selectedOutput: null });
    const ready = fixture(), args = { ...ready.args, results: ready.args.results.slice(1) };
    const inventory = assembleSynthesisGenerationResults(args), context = createSynthesisGenerationContext(inventory, args, ready.sequence);
    const waiting = content({ ...ready, args, inventory, context }, context.records[0].id);
    expect(waiting.inputStatus).toBe("incomplete"); expect(waiting.selectionSequence).toBe(ready.sequence);
    expect(waiting.manifestSha256).not.toBe(content(ready, context.records[0].id).manifestSha256);
    expect(waiting.entities.filter(row => row.kind === "segment").map(row => JSON.parse(row.canonical))).toContainEqual(expect.objectContaining({ taskIndex: 0, disposition: "awaiting_result", selectedOutput: null }));
  });

  it("emits no content frames for an empty selection", () => {
    const snapshot = makeSourceSnapshot(0); snapshot.answers = []; snapshot.counts.answers = 0;
    const f = fixture(snapshot), value = content(f, f.context.records[0].id);
    expect(value.inputStatus).toBe("empty_selection"); expect(value.entities).toEqual([]); expect(value.frames).toEqual([]);
    expect(value.contributionIds).toEqual([]); checkFrames(value);
    expect(() => content(f, "item:missing")).toThrow("target is unavailable");
  });

  it("rejects changed authorities, self-hashed content, targets, limits and selection anchors", () => {
    const f = fixture(), value = content(f), target = value.targetRecordId;
    for (const limit of [4095, 1048577, 4096.5, NaN]) expect(() => content(f, target, limit)).toThrow();
    expect(() => content(f, "item:missing")).toThrow("target is unavailable");
    expect(() => createSynthesisGenerationContextContent(f.context, f.inventory, { ...f.args, scope: { ...sourceScope, workspaceId: sourceScope.campaignId } }, f.sequence, target)).toThrow();
    const inventory = structuredClone(f.inventory); inventory.entries.pop();
    expect(() => createSynthesisGenerationContextContent(f.context, inventory, f.args, f.sequence, target)).toThrow("inventory differs");
    const context = structuredClone(f.context); context.records.pop();
    const { manifestSha256: _hash, ...manifest } = context; context.manifestSha256 = sourceHash(JSON.stringify(manifest));
    expect(() => createSynthesisGenerationContextContent(context, f.inventory, f.args, f.sequence, target)).toThrow("differs");
    const altered = structuredClone(value); altered.frames[0].canonical += " "; altered.frames[0].sha256 = sourceHash(altered.frames[0].canonical);
    expect(() => verifySynthesisGenerationContextContent(altered, f.context, f.inventory, f.args, f.sequence, target, 4096)).toThrow("differs");
    for (const args of [[f.sequence + 1, target, 4096], [f.sequence, f.context.records[0].id, 4096], [f.sequence, target, 8192]] as const) {
      expect(() => verifySynthesisGenerationContextContent(value, f.context, f.inventory, f.args, args[0], args[1], args[2])).toThrow("differs");
    }
  });
});
