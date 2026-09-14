import { describe, expect, it } from "vitest";
import { applySynthesisReviewChange, createSynthesisReviewContent, synthesisReviewIntentSchema, verifySynthesisReviewContent } from "@/lib/engagement/synthesis-review";
import { makeSourceSnapshot, savedSource, sourceActor, sourceScope } from "./fixtures/engagement/synthesis-source";

function fixture(n = 301) {
  const snapshot = makeSourceSnapshot(n), sha = savedSource(snapshot).snapshotSha256;
  return { snapshot, sha, ...createSynthesisReviewContent(snapshot, sha) };
}
describe("retained synthesis review content", () => {
  it("creates complete unassessed drafts from historical preparation, including the final contribution", () => {
    const { snapshot, sha, preparation, content } = fixture();
    expect(content).toMatchObject({ schemaVersion: 1, status: "staff_draft", sourceId: snapshot.requestId, sourceSha256: sha,
      title: snapshot.campaign.title, notes: "", assignedSourceCount: 302, overlappingSourceCount: 0, unassignedSourceIds: [] });
    expect(content.groups).toEqual([{ id: "category-1", label: "SYNTHETIC retained category", summary: "", sentiment: "not_assessed", sourceIds: preparation.categoryGroups[0].sourceIds }]);
    expect(content.groups[0].sourceIds).toContain(`item:${snapshot.items[300].id}`);
    expect(content.groups[0].sourceIds).toContain(`answer:${snapshot.answers[0].id}`);
  });
  it("preserves the parent and source when correcting wording, explicit sentiment and last-source membership", () => {
    const { snapshot, sha, content } = fixture(), original = JSON.stringify({ snapshot, content });
    const source = `item:${snapshot.items[300].id}`;
    const corrected = applySynthesisReviewChange(content, { kind: "group_update", groupId: "category-1", label: "SYNTHETIC staff interpretation", summary: "SYNTHETIC reviewed concern", sentiment: "mixed", addSourceIds: [], removeSourceIds: [source] }, snapshot, sha);
    expect(corrected.groups[0]).toMatchObject({ label: "SYNTHETIC staff interpretation", summary: "SYNTHETIC reviewed concern", sentiment: "mixed" });
    expect(corrected.groups[0].sourceIds).not.toContain(source);
    expect(corrected).toMatchObject({ assignedSourceCount: 301, overlappingSourceCount: 0, unassignedSourceIds: [source] });
    expect(JSON.stringify({ snapshot, content })).toBe(original);
    const regrouped = applySynthesisReviewChange(corrected, { kind: "group_add", groupId: "staff-minority", label: "SYNTHETIC distinct concern", summary: "", sentiment: "not_assessed", sourceIds: [source] }, snapshot, sha);
    expect(regrouped).toMatchObject({ assignedSourceCount: 302, unassignedSourceIds: [] });
    expect(regrouped.groups[1].sourceIds).toEqual([source]);
  });
  it("discloses overlap without inflating assigned counts and makes removed groups explicitly unassigned", () => {
    const { snapshot, sha, content } = fixture(1), id = content.groups[0].sourceIds[0];
    const overlap = applySynthesisReviewChange(content, { kind: "group_add", groupId: "shared", label: "SYNTHETIC shared issue", summary: "", sentiment: "not_assessed", sourceIds: [id] }, snapshot, sha);
    expect(overlap).toMatchObject({ assignedSourceCount: 2, overlappingSourceCount: 1, unassignedSourceIds: [] });
    const removed = applySynthesisReviewChange(overlap, { kind: "group_remove", groupId: "category-1" }, snapshot, sha);
    expect(removed).toMatchObject({ assignedSourceCount: 1, overlappingSourceCount: 0 });
    expect(removed.unassignedSourceIds).toEqual(content.groups[0].sourceIds.filter(source => source !== id));
    const empty = applySynthesisReviewChange(removed, { kind: "group_remove", groupId: "shared" }, snapshot, sha);
    expect(empty.groups).toEqual([]); expect(empty.assignedSourceCount).toBe(0);
    expect(empty.unassignedSourceIds).toEqual(content.groups[0].sourceIds);
  });
  it("retains complete notes, missing historical context and empty selected sources", () => {
    const { snapshot, sha, content } = fixture(0);
    const notes = "SYNTHETIC Unicode note é ".repeat(80) + "NOTE TAIL";
    const changed = applySynthesisReviewChange(content, { kind: "notes", title: "SYNTHETIC reviewed title", notes }, snapshot, sha);
    expect(changed.title).toBe("SYNTHETIC reviewed title"); expect(changed.notes).toBe(notes);
    snapshot.answers = []; snapshot.counts.answers = 0;
    const empty = createSynthesisReviewContent(snapshot, savedSource(snapshot).snapshotSha256);
    expect(empty.content.groups).toEqual([]); expect(empty.content.assignedSourceCount).toBe(0);
    const legacy = makeSourceSnapshot(1); legacy.items[0].configuration_version_id = null;
    expect(createSynthesisReviewContent(legacy, savedSource(legacy).snapshotSha256).content.groups.some(group => group.label === "Historical definition unavailable")).toBe(true);
  });
  it("refuses altered source identity, duplicate or unknown membership, and dishonest coverage on read", () => {
    const { snapshot, sha, content } = fixture(1);
    const check = (value: unknown) => verifySynthesisReviewContent(value, snapshot, sha);
    expect(() => check({ ...content, sourceSha256: "0".repeat(64) })).toThrow("Review source identity differs");
    expect(() => check({ ...content, sourceId: sourceActor })).toThrow("Review source identity differs");
    expect(() => check({ ...content, groups: [...content.groups, content.groups[0]], overlappingSourceCount: 2 })).toThrow("Duplicate review group identifiers");
    expect(() => check({ ...content, groups: [{ ...content.groups[0], sourceIds: [content.groups[0].sourceIds[0], content.groups[0].sourceIds[0]] }], assignedSourceCount: 1, overlappingSourceCount: 1, unassignedSourceIds: [content.groups[0].sourceIds[1]] })).toThrow("Duplicate source in review group");
    expect(() => check({ ...content, groups: [{ ...content.groups[0], sourceIds: [`item:${sourceActor}`] }], assignedSourceCount: 1, unassignedSourceIds: content.groups[0].sourceIds })).toThrow("Review references an unknown source");
    for (const patch of [{ assignedSourceCount: 0 }, { overlappingSourceCount: 1 }, { unassignedSourceIds: content.groups[0].sourceIds }]) {
      expect(() => check({ ...content, ...patch })).toThrow("Review source coverage differs");
    }
  });
  it("refuses stale or contradictory membership deltas, duplicate groups, unavailable groups and empty corrections", () => {
    const { snapshot, sha, content } = fixture(1), group = content.groups[0], member = group.sourceIds[0], unknown = `item:${sourceActor}`;
    const update = { kind: "group_update", groupId: group.id, label: group.label, summary: group.summary, sentiment: group.sentiment, addSourceIds: [], removeSourceIds: [] };
    const apply = (change: unknown) => applySynthesisReviewChange(content, change, snapshot, sha);
    expect(() => apply(update)).toThrow("Review correction changes nothing");
    expect(() => apply({ ...update, addSourceIds: [member, member] })).toThrow("Review membership delta repeats a source");
    expect(() => apply({ ...update, removeSourceIds: [member, member] })).toThrow("Review membership delta repeats a source");
    expect(() => apply({ ...update, addSourceIds: [member], removeSourceIds: [member] })).toThrow("Review membership delta repeats a source");
    expect(() => apply({ ...update, addSourceIds: [member] })).toThrow("Review membership delta differs from the parent");
    expect(() => apply({ ...update, removeSourceIds: [unknown] })).toThrow("Review membership delta differs from the parent");
    expect(() => apply({ ...update, addSourceIds: [unknown] })).toThrow("Review references an unknown source");
    expect(() => apply({ kind: "group_remove", groupId: "absent" })).toThrow("Review group is unavailable");
    expect(() => apply({ kind: "group_add", groupId: group.id, label: "Duplicate", summary: "", sentiment: "not_assessed", sourceIds: [] })).toThrow("Review group already exists");
  });
  it("binds strict create/correction intents to actor, workspace and an exact reasoned parent", () => {
    const identity = { requestId: sourceActor, actorId: sourceActor, workspaceId: sourceScope.workspaceId };
    const create = { ...identity, operation: "create", sourceId: sourceScope.requestId, sourceSha256: "a".repeat(64) };
    expect(synthesisReviewIntentSchema.parse(create)).toEqual(create);
    expect(synthesisReviewIntentSchema.safeParse({ ...create, preparation: {} }).success).toBe(false);
    const correct = { ...identity, operation: "correct", reviewId: sourceScope.requestId, expectedRevisionId: sourceScope.requestId, expectedRevisionSha256: "a".repeat(64), reason: "SYNTHETIC staff correction", change: { kind: "notes", title: "SYNTHETIC title", notes: "SYNTHETIC note" } };
    expect(synthesisReviewIntentSchema.parse(correct)).toEqual(correct);
    for (const patch of [{ reason: " " }, { reason: "bad\0reason" }, { expectedRevisionSha256: "bad" }, { expectedRevisionId: "bad" }, { actorId: "bad" }, { workspaceId: "bad" }, { change: { ...correct.change, notes: "\ud800" } }, { sourceText: "unexpected" }]) {
      expect(synthesisReviewIntentSchema.safeParse({ ...correct, ...patch }).success).toBe(false);
    }
  });
});
