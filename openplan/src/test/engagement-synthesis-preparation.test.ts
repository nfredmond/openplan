import { describe, expect, it } from "vitest";
import { prepareSynthesisSource } from "@/lib/engagement/synthesis-preparation";
import { makeSourceSnapshot, savedSource } from "./fixtures/engagement/synthesis-source";

describe("complete retained-source preparation", () => {
  it.each([0, 300, 301, 1201])("accounts for every source at %i comments, without interpreting sentiment or rewriting originals", n => {
    const snapshot = makeSourceSnapshot(n), saved = savedSource(snapshot);
    const original = JSON.stringify(snapshot);
    const result = prepareSynthesisSource(snapshot, saved.snapshotSha256);
    expect(result.source).toEqual({ requestId: snapshot.requestId, campaignId: snapshot.campaignId, workspaceId: snapshot.workspaceId, sha256: saved.snapshotSha256 });
    expect(result.algorithmVersion).toBe(1);
    expect(result.interpretation).toBe("not_assessed");
    expect(result.counts).toEqual({ comments: n, replies: 0, answers: 1, contributions: n + 1, sessions: 1, sessionsWithoutSelectedAnswers: 0 });
    expect(result.categoryGroups).toHaveLength(1);
    expect(result.categoryGroups[0].sourceIds).toEqual([...snapshot.items.map(item => `item:${item.id}`), `answer:${snapshot.answers[0].id}`].sort());
    expect(result.questionGroups[0].sourceIds).toEqual([`answer:${snapshot.answers[0].id}`]);
    expect(result.questionGroups[0]).toMatchObject({ label: "SYNTHETIC original question", context: "retained", questionType: "free_text", questionId: snapshot.answers[0].question_id });
    expect(JSON.stringify(snapshot)).toBe(original);
    if (n) expect(snapshot.items.at(-1)?.body).toContain("FINAL SOURCE TAIL");
  });
  it("keeps historical versions, changed question wording and source kinds distinct", () => {
    const snapshot = makeSourceSnapshot(2);
    const nextVersion = "a0000000-0000-4000-8000-000000000014";
    snapshot.definitions.push({ ...snapshot.definitions[0], id: nextVersion, definitionText: snapshot.definitions[0].definitionText.replace("SYNTHETIC retained category", "SYNTHETIC renamed category") });
    snapshot.items[1].configuration_version_id = nextVersion;
    snapshot.items[1].parent_item_id = snapshot.items[0].id;
    snapshot.answers[0].id = snapshot.items[0].id;
    snapshot.answers.push({ ...snapshot.answers[0], id: snapshot.items[1].id, question_prompt_snapshot: "SYNTHETIC different prompt" });
    snapshot.counts.answers = snapshot.counts.campaignAnswers = 2;
    const result = prepareSynthesisSource(snapshot, savedSource(snapshot).snapshotSha256);
    expect(result.counts).toMatchObject({ comments: 1, replies: 1, answers: 2, contributions: 4 });
    expect(result.categoryGroups.map(group => [group.label, group.sourceIds.length])).toEqual([["SYNTHETIC retained category", 3], ["SYNTHETIC renamed category", 1]]);
    expect(result.questionGroups.map(group => group.label)).toEqual(["SYNTHETIC different prompt", "SYNTHETIC original question"]);
    const reversed = { ...snapshot, items: [...snapshot.items].reverse(), answers: [...snapshot.answers].reverse() };
    expect(prepareSynthesisSource(reversed, result.source.sha256)).toEqual(result);
  });
  it("preserves uncategorized, missing definition, unknown category and unknown question as different states", () => {
    const snapshot = makeSourceSnapshot(3);
    snapshot.items[0].category_id = null;
    snapshot.items[1].configuration_version_id = null;
    snapshot.items[2].category_id = "a0000000-0000-4000-8000-000000000015";
    snapshot.answers[0].question_id = null;
    snapshot.answers[0].question_prompt_snapshot = null;
    const result = prepareSynthesisSource(snapshot, savedSource(snapshot).snapshotSha256);
    expect(result.categoryGroups.map(group => group.context).sort()).toEqual(["category_unavailable", "definition_unavailable", "question_unavailable", "uncategorized"]);
    expect(result.categoryGroups.every(group => group.sourceIds.length === 1 && group.label === null)).toBe(true);
    expect(result.questionGroups[0]).toMatchObject({ context: "question_unavailable", label: null });
    snapshot.sessions[0].configuration_version_id = null;
    expect(prepareSynthesisSource(snapshot, result.source.sha256).questionGroups[0].context).toBe("definition_unavailable");
  });
  it("counts retained sessions with no selected answers without inventing a contribution or typed interpretation", () => {
    const snapshot = makeSourceSnapshot(0);
    snapshot.sessions.push({ ...snapshot.sessions[0], id: "a0000000-0000-4000-8000-000000000016" });
    snapshot.counts.sessions = snapshot.counts.campaignSessions = 2;
    snapshot.answers[0].question_type = "multi_select";
    snapshot.answers[0].answer_text = null;
    snapshot.answers[0].answer_json = { selected: ["SYNTHETIC choice"], geometry: null };
    const original = JSON.stringify(snapshot);
    const result = prepareSynthesisSource(snapshot, savedSource(snapshot).snapshotSha256);
    expect(result.counts).toMatchObject({ contributions: 1, sessions: 2, sessionsWithoutSelectedAnswers: 1 });
    expect(result.questionGroups[0].questionType).toBe("multi_select");
    expect(result.interpretation).toBe("not_assessed");
    expect(JSON.stringify(snapshot)).toBe(original);
    snapshot.answers = [];
    snapshot.counts.answers = 0;
    const empty = prepareSynthesisSource(snapshot, result.source.sha256);
    expect(empty.counts).toMatchObject({ contributions: 0, sessions: 2, sessionsWithoutSelectedAnswers: 2 });
    expect(empty.categoryGroups).toEqual([]);
    expect(empty.questionGroups).toEqual([]);
  });
  it("refuses duplicate membership, orphan answers, and mismatched retained counts", () => {
    const snapshot = makeSourceSnapshot(2), sha = savedSource(snapshot).snapshotSha256;
    const duplicate = structuredClone(snapshot);
    duplicate.items[1].id = duplicate.items[0].id;
    expect(() => prepareSynthesisSource(duplicate, sha)).toThrow("Duplicate preparation source membership");
    const orphan = structuredClone(snapshot);
    orphan.answers[0].session_id = "a0000000-0000-4000-8000-000000000099";
    expect(() => prepareSynthesisSource(orphan, sha)).toThrow("Preparation answer session is missing");
    for (const key of ["items", "sessions", "answers"] as const) {
      const mismatch = structuredClone(snapshot); mismatch.counts[key]++;
      expect(() => prepareSynthesisSource(mismatch, sha)).toThrow("Preparation source counts differ");
    }
  });
});
