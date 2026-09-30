import { describe, expect, it, vi } from "vitest";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords, verifySynthesisGenerationRecords, type SynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

function fixture(n = 2) {
  const snapshot = makeSourceSnapshot(n);
  const saved = savedSource(snapshot);
  const input = createSynthesisGenerationInput(saved, sourceScope, 512);
  return { snapshot, saved, input };
}

describe("whole semantic records for synthesis generation", () => {
  it("preserves all contributions and historical context beyond the old 300-comment cap", () => {
    const { snapshot, saved, input } = fixture(401);
    const before = JSON.stringify({ input, saved });
    const result = createSynthesisGenerationRecords(input, saved, sourceScope);
    expect(result.records).toHaveLength(405);
    expect(result.contributionIds).toHaveLength(402);
    expect(result.interpretation).toBe("not_assessed");
    expect(result.source).toEqual({ ...sourceScope, sha256: saved.snapshotSha256 });
    expect(result.inputManifestSha256).toBe(input.manifestSha256);
    const byId = new Map(result.records.map(record => [record.id, record]));
    for (const item of snapshot.items) expect(JSON.parse(byId.get(`item:${item.id}`)!.text)).toEqual(item);
    for (const answer of snapshot.answers) expect(JSON.parse(byId.get(`answer:${answer.id}`)!.text)).toEqual(answer);
    for (const session of snapshot.sessions) expect(JSON.parse(byId.get(`session:${session.id}`)!.text)).toEqual(session);
    expect(byId.get(`definition:${snapshot.definitions[0].id}`)!.text).toBe(snapshot.definitions[0].definitionText);
    expect(byId.get(`item:${snapshot.items[400].id}`)!.text).toContain("FINAL SOURCE TAIL");
    const { items: _items, sessions: _sessions, answers: _answers, definitions: _definitions, ...context } = snapshot;
    expect(JSON.parse(byId.get(`context:${sourceScope.requestId}`)!.text)).toEqual(context);
    expect(result.records.every(record => record.references.every(reference => reference.retained))).toBe(true);
    for (const record of result.records) {
      expect(record.sha256).toBe(sourceHash(record.text));
      expect(record.utf8Bytes).toBe(Buffer.byteLength(record.text, "utf8"));
    }
    const { manifestSha256, ...value } = result;
    const manifest = { ...value, records: result.records.map(({ text: _text, ...descriptor }) => descriptor) };
    expect(manifestSha256).toBe(sourceHash(JSON.stringify(manifest)));
    expect(createSynthesisGenerationRecords(input, saved, sourceScope)).toEqual(result);
    expect(verifySynthesisGenerationRecords(JSON.parse(JSON.stringify(result)), input, saved, sourceScope)).toEqual(result);
    expect(JSON.stringify({ input, saved })).toBe(before);
  });

  it("preserves exact numeric tokens in nested answers instead of rounded values", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.answers[0].answer_json = { value: "NUMBER_MARKER" };
    const saved = savedSource(snapshot);
    saved.snapshotText = saved.snapshotText.replace('"NUMBER_MARKER"', '[9007199254740993,-0,1.234567890123456789,1e+999,{"tiny":1.00e-99}]');
    saved.snapshotSha256 = sourceHash(saved.snapshotText);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const record = createSynthesisGenerationRecords(input, saved, sourceScope).records.find(record => record.kind === "answer")!;
    expect(record.text).toContain('"value":[9007199254740993,-0,1.234567890123456789,1e+999,{"tiny":1.00e-99}]');
    expect(record.text).not.toContain('9007199254740992');
    expect(record.text).not.toContain('Infinity');
  });

  it("keeps participant token objects, escaped names, nulls and boolean values as participant data", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.answers[0].answer_json = JSON.parse('{"token":"9007199254740993","constructor":{"token":"-0"},"__proto__":{"token":"123"},"quo\\\"te":"\\\\path","values":[null,false,true]}');
    const saved = savedSource(snapshot);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const answer = createSynthesisGenerationRecords(input, saved, sourceScope).records.find(record => record.kind === "answer")!;
    expect(JSON.parse(answer.text).answer_json).toEqual(snapshot.answers[0].answer_json);
    expect(answer.text).toContain('"token":"9007199254740993"');
    expect(answer.text).toContain('"__proto__":{"token":"123"}');
  });

  it("keeps long multilingual record text intact without a record-size cap", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].body = '😀意見 العربية e\u0301 "quoted"\n'.repeat(40_000) + "FINAL RECORD WORDS";
    const saved = savedSource(snapshot);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const record = createSynthesisGenerationRecords(input, saved, sourceScope).records.find(record => record.kind === "item")!;
    expect(record.utf8Bytes).toBeGreaterThan(1_048_576);
    expect(JSON.parse(record.text).body).toBe(snapshot.items[0].body);
    expect(record.text).toContain("FINAL RECORD WORDS");
  });

  it("keeps reply parents outside the selection visibly unavailable and namespaces colliding identities", () => {
    const snapshot = makeSourceSnapshot(2);
    snapshot.items[1].parent_item_id = "b0000000-0000-4000-8000-999999999999";
    snapshot.answers[0].id = snapshot.items[0].id;
    const saved = savedSource(snapshot);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const result = createSynthesisGenerationRecords(input, saved, sourceScope);
    const reply = result.records.find(record => record.id === `item:${snapshot.items[1].id}`)!;
    expect(reply.references).toContainEqual({ id: `item:${snapshot.items[1].parent_item_id}`, retained: false });
    expect(result.records.find(record => record.id === `item:${snapshot.items[0].id}`)?.kind).toBe("item");
    expect(result.records.find(record => record.id === `answer:${snapshot.items[0].id}`)?.kind).toBe("answer");
    expect(result.contributionIds).toHaveLength(3);
  });

  it("retains historical definitions and answer-session links without treating a missing definition as current", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].configuration_version_id = null;
    snapshot.answers[0].question_prompt_snapshot = null;
    const saved = savedSource(snapshot);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const result = createSynthesisGenerationRecords(input, saved, sourceScope);
    const item = result.records.find(record => record.kind === "item")!;
    expect(item.references).toEqual([{ id: `context:${sourceScope.requestId}`, retained: true }]);
    expect(JSON.parse(item.text).configuration_version_id).toBeNull();
    const answer = result.records.find(record => record.kind === "answer")!;
    expect(answer.references).toContainEqual({ id: `session:${snapshot.sessions[0].id}`, retained: true });
    expect(JSON.parse(answer.text).question_prompt_snapshot).toBeNull();
    const session = result.records.find(record => record.kind === "session")!;
    expect(session.references).toContainEqual({ id: `definition:${snapshot.definitions[0].id}`, retained: true });
  });

  it("retains unanswered sessions and empty selected contributions without inventing generated themes", () => {
    const snapshot = makeSourceSnapshot(0);
    snapshot.answers = []; snapshot.counts.answers = 0;
    const saved = savedSource(snapshot);
    const input = createSynthesisGenerationInput(saved, sourceScope);
    const result = createSynthesisGenerationRecords(input, saved, sourceScope);
    expect(result.contributionIds).toEqual([]);
    expect(result.records.map(record => record.kind)).toEqual(["context", "definition", "session"]);
    expect(result.interpretation).toBe("not_assessed");
    expect(JSON.parse(result.records[0].text).counts).toMatchObject({ answers: 0, campaignAnswers: 1, sessions: 1 });
  });

  it("refuses a runtime that cannot expose original numeric tokens", () => {
    const { input, saved } = fixture();
    const original = JSON.parse;
    const spy = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => original(text,
      reviver ? function (this: unknown, key: string, value: unknown) { return reviver.call(this, key, value); } : undefined));
    try { expect(() => createSynthesisGenerationRecords(input, saved, sourceScope)).toThrow(/numeric token is unavailable/); }
    finally { spy.mockRestore(); }
  });

  it("refuses incomplete input and another source's apparently consistent records", () => {
    const { input, saved } = fixture();
    const result = createSynthesisGenerationRecords(input, saved, sourceScope);
    const shortened = structuredClone(input); shortened.parts.pop();
    expect(() => createSynthesisGenerationRecords(shortened, saved, sourceScope)).toThrow();
    expect(() => createSynthesisGenerationRecords(input, saved, { ...sourceScope,
      workspaceId: "a0000000-0000-4000-8000-000000000099" })).toThrow();
    const next = makeSourceSnapshot(2); next.items[0].body += " LATER CORRECTION";
    const nextSaved = savedSource(next); const nextInput = createSynthesisGenerationInput(nextSaved, sourceScope);
    expect(() => verifySynthesisGenerationRecords(result, nextInput, nextSaved, sourceScope)).toThrow();
  });

  const faults: Array<[string, (value: SynthesisGenerationRecords) => void]> = [
    ["missing answer", value => { value.records = value.records.filter(record => record.kind !== "answer"); }],
    ["altered text with its new checksum", value => { const row = value.records.find(record => record.kind === "item")!; row.text += " "; row.sha256 = sourceHash(row.text); row.utf8Bytes++; }],
    ["missing contribution identity", value => { value.contributionIds.pop(); }],
    ["false retained reference", value => { value.records[1].references[0].retained = false; }],
    ["wrong manifest hash", value => { value.manifestSha256 = "0".repeat(64); }],
  ];
  it.each(faults)("refuses %s", (_label, mutate) => {
    const { input, saved } = fixture();
    const result = createSynthesisGenerationRecords(input, saved, sourceScope);
    mutate(result);
    expect(() => verifySynthesisGenerationRecords(result, input, saved, sourceScope)).toThrow();
  });
});
