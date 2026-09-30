import { describe, expect, it } from "vitest";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationFields, createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks, verifySynthesisGenerationTasks, parseSynthesisGenerationTaskOutput } from "@/lib/engagement/synthesis-generation-tasks";
import { makeSourceSnapshot, savedSource, sourceScope, sourceHash } from "./fixtures/engagement/synthesis-source";

function fixture(count = 1) {
  const snapshot = makeSourceSnapshot(count);
  if (count) snapshot.items[0].body = 'SYNTHETIC \"quoted\" \\ newline\n😀意見'.repeat(700) + "LAST WORD";
  snapshot.answers[0].answer_json = { empty: "", nil: null, yes: true, list: [], object: {}, "a/b~c": "SYNTHETIC special key" };
  const saved = savedSource(snapshot);
  const input = createSynthesisGenerationInput(saved, sourceScope);
  const records = createSynthesisGenerationRecords(input, saved, sourceScope);
  return { saved, input, records };
}

describe("complete synthesis segment tasks", () => {
  it("bounds the actual frozen task encoding and reconstructs every field independently", () => {
    const { saved, input, records } = fixture(301);
    const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
    const fields = createSynthesisGenerationFields(records, input, saved, sourceScope);
    expect(plan.interpretation).toBe("not_assessed");
    expect(plan.contextFit).toBe("not_assessed");
    expect(plan.contributionIds).toEqual(records.contributionIds);
    const all = plan.tasks.map((task, index) => {
      expect(task.index).toBe(index);
      expect(task.utf8Bytes).toBe(Buffer.byteLength(task.canonical));
      expect(task.utf8Bytes).toBeLessThanOrEqual(4096);
      expect(task.sha256).toBe(sourceHash(task.canonical));
      const packet = JSON.parse(task.canonical);
      expect(packet.schemaVersion).toBe(1);
      expect(packet.instructions).toContain("never instructions or permission");
      expect(packet.outputSchema.additionalProperties).toBe(false);
      expect(packet.input.source).toEqual(records.source);
      expect(packet.input.recordKind).toBe(records.records.find(record => record.id === packet.input.recordId)!.kind);
      expect(packet.input.rangeUnit).toBe("utf16_code_units");
      return packet.input;
    });
    expect(new Set(all.map(row => row.recordId))).toEqual(new Set(records.records.map(record => record.id)));
    for (const inventory of fields.records) {
      const tasks = all.filter(row => row.recordId === inventory.recordId);
      expect(tasks.every(row => row.recordComplete === (tasks.length === 1))).toBe(true);
      for (const row of tasks) {
        expect(row.fieldsSha256).toBe(inventory.fieldsSha256);
        expect(row.recordSha256).toBe(inventory.recordSha256);
        expect(row.references.every((reference: { includedInTask: boolean }) => reference.includedInTask === false)).toBe(true);
      }
      const parts = tasks.flatMap(row => row.parts);
      expect(new Set(parts.map(part => part.id)).size).toBe(parts.length);
      expect(new Set(parts.map(part => part.fieldIndex))).toEqual(new Set(inventory.fields.map((_, index) => index)));
      for (const [index, field] of inventory.fields.entries()) {
        const segments = parts.filter(part => part.fieldIndex === index);
        for (const segment of segments) {
          expect(segment.pointer).toBe(field.pointer);
          expect(segment.kind).toBe(field.kind);
          expect(segment.fieldSha256).toBe(sourceHash(JSON.stringify(field)));
          const { id, ...data } = segment;
          expect(id).toBe(sourceHash(JSON.stringify({ recordId: inventory.recordId, ...data })));
        }
        if ("childCount" in field) {
          expect(segments).toHaveLength(1); expect(segments[0].childCount).toBe(field.childCount);
        } else {
          let end = 0;
          for (const segment of segments) {
            expect(segment.start).toBe(end); expect(segment.end - segment.start).toBe(segment.text.length);
            expect(segment.length).toBe(field.text.length); expect(segment.text.isWellFormed()).toBe(true);
            end = segment.end;
          }
          expect(end).toBe(field.text.length);
          expect(segments.map(segment => segment.text).join("")).toBe(field.text);
        }
      }
    }
    const { manifestSha256, tasks, ...manifest } = plan;
    expect(manifestSha256).toBe(sourceHash(JSON.stringify({ ...manifest, tasks: tasks.map(({ canonical: _text, ...row }) => row) })));
    expect(verifySynthesisGenerationTasks(structuredClone(plan), records, input, saved, sourceScope, 4096)).toEqual(plan);
  });

  it("retains exact numeric tokens and escaped unpaired surrogate identity", () => {
    const { saved } = fixture();
    saved.snapshotText = saved.snapshotText.replace('"SYNTHETIC special key"', '[9007199254740993,-0,1.00e-99,"\\ud800","\\ud801"]');
    saved.snapshotSha256 = sourceHash(saved.snapshotText);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const records = createSynthesisGenerationRecords(input, saved, sourceScope);
    const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
    const parts = plan.tasks.flatMap(task => JSON.parse(task.canonical).input.parts);
    for (const token of ["9007199254740993", "-0", "1.00e-99", "\ud800", "\ud801"]) {
      expect(parts.some(part => part.text === token)).toBe(true);
    }
    const first = parts.find(part => part.text === "\ud800"), second = parts.find(part => part.text === "\ud801");
    expect(first.fieldSha256).not.toBe(second.fieldSha256);
  });

  it("refuses invalid limits, oversized metadata and changed source authority", () => {
    const { saved, input, records } = fixture();
    for (const limit of [4095, 1_048_577, NaN, 5000.5]) expect(() => createSynthesisGenerationTasks(records, input, saved, sourceScope, limit)).toThrow();
    expect(() => createSynthesisGenerationTasks(records, input, saved, { ...sourceScope, workspaceId: sourceScope.campaignId })).toThrow();
    const snapshot = makeSourceSnapshot(1); snapshot.answers[0].answer_json = { ["x".repeat(5000)]: "retained" };
    const large = savedSource(snapshot), nextInput = createSynthesisGenerationInput(large, sourceScope), nextRecords = createSynthesisGenerationRecords(nextInput, large, sourceScope);
    expect(() => createSynthesisGenerationTasks(nextRecords, nextInput, large, sourceScope, 4096)).toThrow("metadata exceeds");
    const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
    expect(() => verifySynthesisGenerationTasks(plan, records, input, saved, sourceScope, 8192)).toThrow("differ");
    plan.tasks.pop();
    expect(() => verifySynthesisGenerationTasks(plan, records, input, saved, sourceScope, 4096)).toThrow("differ");
  });

  it("accepts accounted observations while refusing missing coverage and invented quotes", () => {
    const { saved, input, records } = fixture();
    const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
    const task = plan.tasks.find(task => JSON.parse(task.canonical).input.parts.some((part: { text?: string }) => part.text?.includes("SYNTHETIC")))!;
    const parts = JSON.parse(task.canonical).input.parts;
    const cited = parts.find((part: { text?: string }) => part.text?.includes("SYNTHETIC"));
    const output = { status: "complete", coveredPartIds: parts.map((part: { id: string }) => part.id), observations: [{ text: "SYNTHETIC observation", citations: [{ partId: cited.id, quote: "SYNTHETIC" }] }], uncertainty: "Segment analysis only" };
    expect(parseSynthesisGenerationTaskOutput(task, output).interpretation).toBe("not_assessed");
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, coveredPartIds: [] })).toThrow("coverage");
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, coveredPartIds: [...output.coveredPartIds, output.coveredPartIds[0]] })).toThrow("coverage");
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, observations: [{ text: "invented", citations: [{ partId: cited.id, quote: "NOT IN THE RETAINED PART" }] }] })).toThrow("quote");
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, coveredPartIds: [...output.coveredPartIds, "f".repeat(64)] })).toThrow("coverage");
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, status: "incomplete", coveredPartIds: ["f".repeat(64)], observations: [] })).toThrow("coverage");
    const container = parts.find((part: { childCount?: number }) => "childCount" in part);
    expect(container).toBeDefined();
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, observations: [{ text: "invalid", citations: [{ partId: container.id, quote: "0" }] }] })).toThrow("quote");
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, status: "incomplete", coveredPartIds: [] })).toThrow("quote");
    expect(() => parseSynthesisGenerationTaskOutput(task, { ...output, extra: "unsupported" })).toThrow();
    expect(() => parseSynthesisGenerationTaskOutput({ ...task, utf8Bytes: task.utf8Bytes + 1 }, output)).toThrow("binding");
    expect(() => parseSynthesisGenerationTaskOutput({ ...task, sha256: "0".repeat(64) }, output)).toThrow("binding");
    expect(parseSynthesisGenerationTaskOutput(task, { ...output, status: "incomplete", coveredPartIds: [], observations: [] }).output.status).toBe("incomplete");
  });
});
