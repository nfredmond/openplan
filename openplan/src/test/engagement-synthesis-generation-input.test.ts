import { describe, expect, it } from "vitest";
import { createSynthesisGenerationInput, verifySynthesisGenerationInput, type SynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

describe("complete retained input for resumable synthesis", () => {
  it("reconstructs all 301 comments, the survey answer, full long text and original JSON bytes", () => {
    const saved = savedSource();
    const before = JSON.stringify(saved);
    const input = createSynthesisGenerationInput(saved, sourceScope, 512);
    const checked = verifySynthesisGenerationInput(input, saved, sourceScope);
    expect(checked.snapshotText).toBe(saved.snapshotText);
    expect(sourceHash(input.parts.map(part => part.text).join(""))).toBe(saved.snapshotSha256);
    expect(input.manifestSha256).toBe(sourceHash(input.manifestText));
    const manifest = checked.manifest;
    expect(manifest.source).toEqual({ ...sourceScope, sha256: saved.snapshotSha256, utf8Bytes: Buffer.byteLength(saved.snapshotText) });
    expect(manifest.coverage).toMatchObject({ comments: 301, replies: 0, answers: 1, sessions: 1,
      sessionsWithoutSelectedAnswers: 0, interpretation: "not_assessed" });
    expect(manifest.coverage.sourceIds).toHaveLength(302);
    expect(manifest.coverage.sourceIds).toContain("item:b0000000-0000-4000-8000-000000000300");
    expect(manifest.coverage.sourceIds).toContain("answer:a0000000-0000-4000-8000-000000000007");
    expect(checked.snapshotText).toContain("FINAL SOURCE TAIL");
    expect(checked.snapshotText).toContain("SYNTHETIC original question");
    expect(manifest.source.utf8Bytes).toBe(Buffer.byteLength(saved.snapshotText));
    let nextByte = 0;
    for (const [index, part] of input.parts.entries()) {
      expect(part.index).toBe(index);
      expect(part.byteStart).toBe(nextByte);
      expect(part.byteEnd - part.byteStart).toBe(Buffer.byteLength(part.text));
      expect(part.sha256).toBe(sourceHash(part.text));
      expect(part.byteEnd - part.byteStart).toBeLessThanOrEqual(512);
      nextByte = part.byteEnd;
    }
    expect(nextByte).toBe(Buffer.byteLength(saved.snapshotText));
    expect(JSON.stringify(saved)).toBe(before);
    expect(createSynthesisGenerationInput(saved, sourceScope, 512)).toEqual(input);
  });

  it("keeps multilingual characters, JSON escapes and long continuations without splitting surrogate pairs", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].body = '意見😀é e\u0301 العربية "quoted" \\path\n'.repeat(1000) + "TAIL";
    const saved = savedSource(snapshot);
    const input = createSynthesisGenerationInput(saved, sourceScope, 257);
    expect(input.parts.length).toBeGreaterThan(100);
    expect(input.parts.every(part => part.text.isWellFormed() && Buffer.byteLength(part.text) <= 257)).toBe(true);
    expect(verifySynthesisGenerationInput(input, saved, sourceScope).snapshotText).toBe(saved.snapshotText);
  });

  it("preserves numeric spellings that JSON.parse and JSON.stringify would round", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.answers[0].answer_json = { recorded: "NUMBER_MARKER" };
    const saved = savedSource(snapshot);
    saved.snapshotText = saved.snapshotText.replace('"NUMBER_MARKER"', '9007199254740993');
    saved.snapshotSha256 = sourceHash(saved.snapshotText);
    const input = createSynthesisGenerationInput(saved, sourceScope, 256);
    const reconstructed = verifySynthesisGenerationInput(input, saved, sourceScope).snapshotText;
    expect(reconstructed).toBe(saved.snapshotText);
    expect(reconstructed).toContain('9007199254740993');
    expect(reconstructed).not.toContain('9007199254740992');
  });

  it("continues past the largest frame size without imposing that limit on the source", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].body = "SYNTHETIC long contribution 😀 ".repeat(40_000) + "COMPLETE LARGE TAIL";
    const saved = savedSource(snapshot);
    expect(Buffer.byteLength(saved.snapshotText)).toBeGreaterThan(1_048_576);
    const input = createSynthesisGenerationInput(saved, sourceScope, 1_048_576);
    expect(input.parts.length).toBeGreaterThan(1);
    expect(input.parts.every(part => Buffer.byteLength(part.text) <= 1_048_576)).toBe(true);
    expect(verifySynthesisGenerationInput(input, saved, sourceScope).snapshotText).toBe(saved.snapshotText);
  });

  it("distinguishes reply and answer identities and keeps unanswered sessions explicit", () => {
    const snapshot = makeSourceSnapshot(2);
    snapshot.items[1].parent_item_id = snapshot.items[0].id;
    snapshot.answers[0].id = snapshot.items[0].id;
    snapshot.sessions.push({ ...snapshot.sessions[0], id: "a0000000-0000-4000-8000-000000000008" });
    snapshot.counts.sessions = snapshot.counts.campaignSessions = 2;
    const saved = savedSource(snapshot);
    const { manifest } = verifySynthesisGenerationInput(createSynthesisGenerationInput(saved, sourceScope), saved, sourceScope);
    expect(manifest.coverage).toMatchObject({ comments: 1, replies: 1, answers: 1, sessions: 2, sessionsWithoutSelectedAnswers: 1 });
    expect(manifest.coverage.sourceIds).toContain(`item:${snapshot.items[0].id}`);
    expect(manifest.coverage.sourceIds).toContain(`answer:${snapshot.items[0].id}`);
    expect(manifest.coverage.sourceIds).toHaveLength(3);
  });

  it("retains a survey-only source and an observed empty selection without declaring analysis", () => {
    const snapshot = makeSourceSnapshot(0);
    snapshot.selection.includeItems = false;
    snapshot.sessions[0].configuration_version_id = null;
    snapshot.campaign.configurationVersionId = null;
    snapshot.definitions = [];
    const saved = savedSource(snapshot);
    const survey = verifySynthesisGenerationInput(createSynthesisGenerationInput(saved, sourceScope), saved, sourceScope);
    expect(survey.manifest.coverage).toMatchObject({ comments: 0, answers: 1, interpretation: "not_assessed" });
    expect(survey.snapshotText).toBe(saved.snapshotText);
    snapshot.answers = [];
    snapshot.counts.answers = 0;
    const emptySaved = savedSource(snapshot);
    const empty = verifySynthesisGenerationInput(createSynthesisGenerationInput(emptySaved, sourceScope), emptySaved, sourceScope);
    expect(empty.manifest.coverage).toMatchObject({ sourceIds: [], comments: 0, replies: 0, answers: 0,
      sessionsWithoutSelectedAnswers: 1, interpretation: "not_assessed" });
    expect(JSON.parse(empty.snapshotText).counts.campaignAnswers).toBe(1);
    expect(JSON.parse(empty.snapshotText).definitions).toEqual([]);
  });

  it.each([0, 255, 256.5, 1_048_577, Number.NaN, Number.POSITIVE_INFINITY])("refuses invalid frame byte limit %s without changing the source", limit => {
    expect(() => createSynthesisGenerationInput(savedSource(makeSourceSnapshot(1)), sourceScope, limit)).toThrow();
  });

  it("refuses an invalid Unicode source instead of replacing bytes", () => {
    const saved = savedSource(makeSourceSnapshot(1));
    saved.snapshotText = saved.snapshotText.replace('FINAL SOURCE TAIL', '\ud800');
    saved.snapshotSha256 = sourceHash(saved.snapshotText);
    expect(() => createSynthesisGenerationInput(saved, sourceScope)).toThrow(/invalid Unicode/);
  });

  it("rechecks authoritative source identity, bytes and membership before planning", () => {
    const saved = savedSource(makeSourceSnapshot(1));
    expect(() => createSynthesisGenerationInput(saved, { ...sourceScope, workspaceId: "a0000000-0000-4000-8000-000000000099" })).toThrow();
    expect(() => createSynthesisGenerationInput({ ...saved, snapshotText: saved.snapshotText + " " }, sourceScope)).toThrow();
    const source = makeSourceSnapshot(1);
    source.answers[0].session_id = "a0000000-0000-4000-8000-000000000099";
    expect(() => createSynthesisGenerationInput(savedSource(source), sourceScope)).toThrow();
  });

  const faults: Array<[string, (input: SynthesisGenerationInput) => void]> = [
    ["missing part", input => { input.parts.pop(); }],
    ["duplicate part", input => { input.parts.push(input.parts[0]); }],
    ["out-of-order parts", input => { [input.parts[0], input.parts[1]] = [input.parts[1], input.parts[0]]; }],
    ["changed text", input => { input.parts[0].text = input.parts[0].text.replace('{', '['); }],
    ["false byte range", input => { input.parts[0].byteEnd++; }],
    ["false part checksum", input => { input.parts[0].sha256 = "f".repeat(64); }],
    ["false manifest checksum", input => { input.manifestSha256 = "f".repeat(64); }],
    ["self-hashed omitted answer", input => {
      const manifest = JSON.parse(input.manifestText);
      manifest.coverage.sourceIds = manifest.coverage.sourceIds.filter((id: string) => !id.startsWith("answer:"));
      manifest.coverage.answers = 0;
      input.manifestText = JSON.stringify(manifest); input.manifestSha256 = sourceHash(input.manifestText);
    }],
  ];
  it.each(faults)("refuses %s even when other retained parts remain readable", (_name, mutate) => {
    const saved = savedSource(makeSourceSnapshot(1));
    const input = createSynthesisGenerationInput(saved, sourceScope, 256);
    mutate(input);
    expect(() => verifySynthesisGenerationInput(input, saved, sourceScope)).toThrow();
  });

  it("refuses input from another retained source, even when both independently verify", () => {
    const first = savedSource(makeSourceSnapshot(1));
    const next = makeSourceSnapshot(1); next.items[0].body += " CORRECTION";
    const second = savedSource(next);
    const input = createSynthesisGenerationInput(first, sourceScope);
    expect(() => verifySynthesisGenerationInput(input, second, sourceScope)).toThrow();
  });
});
