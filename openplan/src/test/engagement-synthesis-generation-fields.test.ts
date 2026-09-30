import { describe, expect, it } from "vitest";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords, createSynthesisGenerationFields, verifySynthesisGenerationFields, type SynthesisGenerationFields, type SynthesisGenerationField } from "@/lib/engagement/synthesis-generation-records";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

function fixture() {
  const snapshot = makeSourceSnapshot(1);
  snapshot.items[0].body = 'SYNTHETIC "quoted" words\n意見😀 e\u0301';
  snapshot.answers[0].answer_json = { "a/b": { "~key": [null, false, true, "", {}, []] }, "a": { b: "DISTINCT" }, token: "123" };
  const saved = savedSource(snapshot);
  const input = createSynthesisGenerationInput(saved, sourceScope);
  const records = createSynthesisGenerationRecords(input, saved, sourceScope);
  return { snapshot, saved, input, records };
}

// Independently reconstruct the field tree and compare it with the whole record.
function reconstruct(fields: SynthesisGenerationField[], pointer = ""): unknown {
  const field = fields.find(field => field.pointer === pointer)!;
  expect(field).toBeDefined();
  if (field.kind === "string") return field.text;
  if (field.kind === "number") return Number(field.text);
  if (field.kind === "null") return null;
  if (field.kind === "boolean") return field.text === "true";
  if (!("childCount" in field)) throw new Error("Expected a retained container field");
  const children = fields.filter(child => child.pointer !== "" && child.pointer.split("/").slice(0, -1).join("/") === pointer);
  expect(children).toHaveLength(field.childCount);
  if (field.kind === "array") {
    expect(children.map(child => child.pointer.split("/").at(-1))).toEqual(Array.from({ length: field.childCount }, (_, index) => String(index)));
    return children.map(child => reconstruct(fields, child.pointer));
  }
  return Object.fromEntries(children.map(child => [child.pointer.split("/").at(-1)!.replace(/~1/g, "/").replace(/~0/g, "~"), reconstruct(fields, child.pointer)]));
}

describe("complete typed fields for bounded synthesis tasks", () => {
  it("retains complete field values, literal text and unambiguous paths", () => {
    const { snapshot, saved, input, records } = fixture();
    const before = JSON.stringify({ saved, input, records });
    const result = createSynthesisGenerationFields(records, input, saved, sourceScope);
    expect(result.schemaVersion).toBe(1);
    expect(result.recordsManifestSha256).toBe(records.manifestSha256);
    expect(result.records.map(record => record.recordId)).toEqual(records.records.map(record => record.id));
    const item = result.records.find(record => record.recordId === `item:${snapshot.items[0].id}`)!;
    expect(item.fields).toContainEqual({ pointer: "/body", kind: "string", text: snapshot.items[0].body });
    const answer = result.records.find(record => record.recordId === `answer:${snapshot.answers[0].id}`)!;
    expect(answer.fields).toEqual(expect.arrayContaining([
      { pointer: "/answer_json/a~1b/~0key", kind: "array", childCount: 6 },
      { pointer: "/answer_json/a~1b/~0key/0", kind: "null", text: "null" },
      { pointer: "/answer_json/a~1b/~0key/1", kind: "boolean", text: "false" },
      { pointer: "/answer_json/a~1b/~0key/2", kind: "boolean", text: "true" },
      { pointer: "/answer_json/a~1b/~0key/3", kind: "string", text: "" },
      { pointer: "/answer_json/a~1b/~0key/4", kind: "object", childCount: 0 },
      { pointer: "/answer_json/a~1b/~0key/5", kind: "array", childCount: 0 },
      { pointer: "/answer_json/a/b", kind: "string", text: "DISTINCT" },
      { pointer: "/answer_json/token", kind: "string", text: "123" },
    ]));
    for (const record of result.records) {
      const { fieldsSha256, ...content } = record;
      expect(fieldsSha256).toBe(sourceHash(JSON.stringify(content)));
      expect(record.recordSha256).toBe(records.records.find(row => row.id === record.recordId)!.sha256);
      expect(new Set(record.fields.map(field => field.pointer)).size).toBe(record.fields.length);
      expect(record.fields[0]).toMatchObject({ pointer: "", kind: "object" });
      expect(reconstruct(record.fields)).toEqual(JSON.parse(records.records.find(row => row.id === record.recordId)!.text));
    }
    expect(verifySynthesisGenerationFields(JSON.parse(JSON.stringify(result)), records, input, saved, sourceScope)).toEqual(result);
    expect(JSON.stringify({ saved, input, records })).toBe(before);
  });

  it("preserves every field value beyond 300 comments and does not clip long text", () => {
    const snapshot = makeSourceSnapshot(301);
    snapshot.items[300].body = "SYNTHETIC full field 😀".repeat(60_000) + "TAIL";
    const saved = savedSource(snapshot);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const records = createSynthesisGenerationRecords(input, saved, sourceScope);
    const result = createSynthesisGenerationFields(records, input, saved, sourceScope);
    expect(result.records).toHaveLength(records.records.length);
    for (const item of snapshot.items) {
      const fields = result.records.find(record => record.recordId === `item:${item.id}`)!.fields;
      expect(fields).toContainEqual({ pointer: "/body", kind: "string", text: item.body });
    }
    expect(result.records.find(record => record.recordId === `answer:${snapshot.answers[0].id}`)).toBeDefined();
  });

  it("keeps exact numeric tokens distinguishable from participant strings", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.answers[0].answer_json = { numeric: "NUMBER_MARKER", text: "9007199254740993" };
    const saved = savedSource(snapshot);
    saved.snapshotText = saved.snapshotText.replace('"NUMBER_MARKER"', '[9007199254740993,-0,1.00e-99]');
    saved.snapshotSha256 = sourceHash(saved.snapshotText);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const records = createSynthesisGenerationRecords(input, saved, sourceScope);
    const result = createSynthesisGenerationFields(records, input, saved, sourceScope);
    const fields = result.records.find(record => record.recordId.startsWith("answer:"))!.fields;
    expect(fields).toEqual(expect.arrayContaining([
      { pointer: "/answer_json/numeric/0", kind: "number", text: "9007199254740993" },
      { pointer: "/answer_json/numeric/1", kind: "number", text: "-0" },
      { pointer: "/answer_json/numeric/2", kind: "number", text: "1.00e-99" },
      { pointer: "/answer_json/text", kind: "string", text: "9007199254740993" },
    ]));
  });

  it("keeps prototype-like field names as data", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.answers[0].answer_json = JSON.parse('{"__proto__":{"polluted":true},"constructor":"SYNTHETIC"}');
    const saved = savedSource(snapshot); const input = createSynthesisGenerationInput(saved, sourceScope);
    const records = createSynthesisGenerationRecords(input, saved, sourceScope);
    const answer = createSynthesisGenerationFields(records, input, saved, sourceScope).records.find(record => record.recordId.startsWith("answer:"))!;
    expect(answer.fields).toContainEqual({ pointer: "/answer_json/__proto__/polluted", kind: "boolean", text: "true" });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("refuses changed records and wrong workspace scope before projecting fields", () => {
    const { saved, input, records } = fixture();
    const changed = structuredClone(records); changed.records.pop();
    expect(() => createSynthesisGenerationFields(changed, input, saved, sourceScope)).toThrow();
    expect(() => createSynthesisGenerationFields(records, input, saved, { ...sourceScope,
      workspaceId: "a0000000-0000-4000-8000-000000000099" })).toThrow();
  });

  const faults: Array<[string, (value: SynthesisGenerationFields) => void]> = [
    ["missing record", value => { value.records.pop(); }],
    ["missing field", value => { value.records[0].fields.pop(); }],
    ["duplicated field", value => { value.records[0].fields.push(value.records[0].fields[0]); }],
    ["false container count", value => { const field = value.records[0].fields[0]; if (field.kind === "object") field.childCount++; }],
    ["changed field identity", value => { value.records[0].fields[0].pointer = "/wrong"; }],
    ["wrong field checksum", value => { value.records[0].fieldsSha256 = "0".repeat(64); }],
    ["wrong parent manifest", value => { value.recordsManifestSha256 = "0".repeat(64); }],
  ];
  it.each(faults)("refuses %s", (_name, mutate) => {
    const { saved, input, records } = fixture();
    const result = createSynthesisGenerationFields(records, input, saved, sourceScope);
    mutate(result);
    expect(() => verifySynthesisGenerationFields(result, records, input, saved, sourceScope)).toThrow();
  });
});
