import { describe, expect, it } from "vitest";
import { readSynthesisResponseContext } from "@/lib/engagement/synthesis-response-context-server";
import { synthesisApprovalIntentSchema, type SynthesisApprovalIntent } from "@/lib/engagement/synthesis-approval";
import { applySynthesisReviewChange, createSynthesisReviewContent, synthesisReviewContentSchema } from "@/lib/engagement/synthesis-review";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, reviewId: id(1), responseId: id(2) };
function fixture(items = 301) {
  const source = savedSource(makeSourceSnapshot(items));
  const { content, preparation } = createSynthesisReviewContent(makeSourceSnapshot(items), source.snapshotSha256);
  const preparationText = JSON.stringify(preparation, null, 1), contentText = JSON.stringify(content, null, 2);
  const revision = { id: scope.reviewId, number: 1, contentText, contentSha256: sourceHash(contentText) };
  const intent: SynthesisApprovalIntent = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId,
    sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256,
    preparationSha256: sourceHash(preparationText), revisionId: revision.id, revisionNo: 1, revisionSha256: revision.contentSha256,
    requestId: id(3), actorId: sourceActor, operation: "approve", reason: "SYNTHETIC exact private approval",
    predecessorId: null, predecessorSha256: null };
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: 1, createdAt: sourceDate, intent });
  const recordText = JSON.stringify({ id: scope.responseId, campaign_id: scope.campaignId, category_id: null,
    theme_title: "SYNTHETIC response", you_said: "SYNTHETIC reviewed issues", we_did: "SYNTHETIC staff explanation é",
    status: "draft", ai_assisted: false, source_item_ids: [], sort_order: 0, published_at: null,
    created_at: sourceDate, updated_at: sourceDate, created_by: sourceActor }, null, 1);
  return { schemaVersion: 1, visibility: "private", purpose: "reviewed_synthesis_response", ...scope,
    sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256, source,
    preparationText, preparationSha256: sourceHash(preparationText), revision,
    approval: { eventText, eventSha256: sourceHash(eventText) }, groupId: content.groups[0].id,
    responseHistory: { id: id(4), campaign_id: scope.campaignId, response_id: scope.responseId, revision: 1,
      actor_id: sourceActor, recorded_at: sourceDate, event: "created", recordText, record_sha256: sourceHash(recordText) } };
}
type Context = ReturnType<typeof fixture>;
function packet(context: Context, whitespace = "") {
  const contextText = whitespace + JSON.stringify(context, null, 2);
  return { contextText, contextSha256: sourceHash(contextText) };
}
function approval(context: Context, patch: Partial<SynthesisApprovalIntent>) {
  const old = JSON.parse(context.approval.eventText) as { intent: unknown };
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: 1, createdAt: sourceDate,
    intent: { ...synthesisApprovalIntentSchema.parse(old.intent), ...patch } });
  context.approval = { eventText, eventSha256: sourceHash(eventText) };
}

describe("complete private synthesis response context", () => {
  it("retains all 301 comments and survey answers without coercing them into legacy response IDs", async () => {
    const context = fixture(), before = JSON.stringify(context), input = packet(context, "\n");
    const result = await readSynthesisResponseContext(input, scope);
    expect(result.packet).toEqual(input);
    expect(result.group.sourceIds).toHaveLength(302);
    expect(result.group.sourceIds).toContain(`item:${makeSourceSnapshot().items[300].id}`);
    expect(result.group.sourceIds).toContain(`answer:${makeSourceSnapshot().answers[0].id}`);
    expect(result.source.snapshot.items[300].body).toMatch(/FINAL SOURCE TAIL$/);
    expect(result.source.snapshot.definitions[0].definitionText).toBe(makeSourceSnapshot().definitions[0].definitionText);
    expect(result.response.source_item_ids).toEqual([]);
    expect(result.response.created_by).toBe(sourceActor);
    expect(JSON.stringify(context)).toBe(before);
  });
  it("retains answer-only groups, historical question wording and private authority", async () => {
    const result = await readSynthesisResponseContext(packet(fixture(0)), scope);
    expect(result.group.sourceIds).toEqual([`answer:${makeSourceSnapshot(0).answers[0].id}`]);
    expect(result.source.snapshot.answers[0].question_prompt_snapshot).toBe("SYNTHETIC original question");
    expect(result.context.visibility).toBe("private");
    expect(result.approval.purpose).toBe("internal_staff_synthesis");
  });
  it("preserves overlap, unassigned input and full Unicode without mutating the original review", async () => {
    const context = fixture(2), snapshot = makeSourceSnapshot(2);
    const original = synthesisReviewContentSchema.parse(JSON.parse(context.revision.contentText));
    const shared = original.groups[0].sourceIds[0], unassigned = original.groups[0].sourceIds[1];
    let content = applySynthesisReviewChange(original, { kind: "group_add", groupId: "minority", label: "SYNTHETIC minority",
      summary: "SYNTHETIC é🚲 ".repeat(500) + "TAIL", sentiment: "mixed", sourceIds: [shared] }, snapshot, context.sourceSha256);
    content = applySynthesisReviewChange(content, { kind: "group_update", groupId: content.groups[0].id,
      label: content.groups[0].label, summary: "", sentiment: "not_assessed", addSourceIds: [], removeSourceIds: [unassigned] }, snapshot, context.sourceSha256);
    context.groupId = "minority"; context.revision.contentText = JSON.stringify(content);
    context.revision.contentSha256 = sourceHash(context.revision.contentText);
    approval(context, { revisionSha256: context.revision.contentSha256 });
    const result = await readSynthesisResponseContext(packet(context), scope);
    expect(result.content.overlappingSourceCount).toBe(1);
    expect(result.content.unassignedSourceIds).toEqual([unassigned]);
    expect(result.group.summary).toBe(content.groups[1].summary);
    expect(original.groups).toHaveLength(1);
  });
  it.each(["campaignId", "workspaceId", "reviewId", "responseId"] as const)("rejects different expected %s", async key => {
    await expect(readSynthesisResponseContext(packet(fixture(1)), { ...scope, [key]: id(99) })).rejects.toThrow("context scope differs");
  });
  it("rejects changed outer bytes, malformed text and unsupported visibility or version", async () => {
    const context = fixture(1), input = packet(context);
    await expect(readSynthesisResponseContext({ ...input, contextText: input.contextText + " " }, scope)).rejects.toThrow("context checksum differs");
    for (const text of ["\ud800", "\0"]) {
      await expect(readSynthesisResponseContext({ contextText: text, contextSha256: sourceHash(text) }, scope)).rejects.toThrow("invalid text");
    }
    for (const patch of [{ visibility: "public" }, { purpose: "agency_adoption" }, { schemaVersion: 2 }, { unexpected: true }]) {
      await expect(readSynthesisResponseContext(packet({ ...context, ...patch }), scope)).rejects.toThrow();
    }
  });
  it.each([
    ["source bytes", (c: Context) => { c.source.snapshotText += " "; }, "source checksum differs"],
    ["source binding", (c: Context) => { c.sourceSha256 = sourceHash("other"); }, "source identity differs"],
    ["preparation bytes", (c: Context) => { c.preparationText += " "; }, "preparation checksum differs"],
    ["preparation derivation", (c: Context) => { c.preparationText = "{}"; c.preparationSha256 = sourceHash("{}"); }, "preparation differs from source"],
    ["review bytes", (c: Context) => { c.revision.contentText += " "; }, "review checksum differs"],
    ["approval bytes", (c: Context) => { c.approval.eventText += " "; }, "Approval event checksum differs"],
    ["group", (c: Context) => { c.groupId = "missing"; }, "group is unavailable"],
    ["response bytes", (c: Context) => { c.responseHistory.recordText += " "; }, "response checksum differs"],
    ["removed history", (c: Context) => { c.responseHistory.event = "removed"; }, "history scope or event differs"],
    ["history campaign", (c: Context) => { c.responseHistory.campaign_id = id(99); }, "history scope or event differs"],
    ["history response", (c: Context) => { c.responseHistory.response_id = id(99); }, "history scope or event differs"],
  ] as const)("rejects %s even when the context checksum is recomputed", async (_label, corrupt, message) => {
    const context = fixture(1); corrupt(context);
    await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow(message);
  });
  it.each(["revisionId", "revisionNo", "revisionSha256"] as const)("rejects approval of different %s", async key => {
    const context = fixture(1);
    approval(context, { [key]: key === "revisionNo" ? 2 : key === "revisionId" ? id(99) : sourceHash("other") });
    await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow("exact retained approval");
  });
  it("rejects withdrawal events and approvals bound to a different source or review", async () => {
    const withdrawn = fixture(1);
    approval(withdrawn, { operation: "withdraw", predecessorId: id(9), predecessorSha256: sourceHash("previous") });
    await expect(readSynthesisResponseContext(packet(withdrawn), scope)).rejects.toThrow("exact retained approval");
    for (const patch of [{ sourceId: id(99) }, { reviewId: id(99) }, { preparationSha256: sourceHash("other") }]) {
      const context = fixture(1); approval(context, patch);
      await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow("Approval source or review scope differs");
    }
  });
  it.each(["id", "campaign_id"] as const)("rejects a rehashed response with foreign %s", async key => {
    const context = fixture(1);
    const response = JSON.parse(context.responseHistory.recordText) as Record<string, unknown>;
    context.responseHistory.recordText = JSON.stringify({ ...response, [key]: id(99) });
    context.responseHistory.record_sha256 = sourceHash(context.responseHistory.recordText);
    await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow("record scope differs");
  });
  it("rejects a rehashed review that silently drops coverage", async () => {
    const context = fixture(1), content = synthesisReviewContentSchema.parse(JSON.parse(context.revision.contentText));
    content.groups[0].sourceIds.pop();
    context.revision.contentText = JSON.stringify(content); context.revision.contentSha256 = sourceHash(context.revision.contentText);
    approval(context, { revisionSha256: context.revision.contentSha256 });
    await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow("Review source coverage differs");
  });
  it.each(["private metadata", "missing definition"])("rejects rehashed source %s before using its review", async defect => {
    const context = fixture(1), snapshot = makeSourceSnapshot(1);
    if (defect === "private metadata") snapshot.items[0].submitted_by = "SYNTHETIC private contact";
    else snapshot.definitions = [];
    context.source = savedSource(snapshot); context.sourceSha256 = context.source.snapshotSha256;
    const rebuilt = createSynthesisReviewContent(snapshot, context.sourceSha256);
    context.preparationText = JSON.stringify(rebuilt.preparation); context.preparationSha256 = sourceHash(context.preparationText);
    context.revision.contentText = JSON.stringify(rebuilt.content); context.revision.contentSha256 = sourceHash(context.revision.contentText);
    approval(context, { sourceSha256: context.sourceSha256, preparationSha256: context.preparationSha256,
      revisionSha256: context.revision.contentSha256 });
    await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow(
      defect === "private metadata" ? "Unselected contact" : "source definition is missing");
  });
  it("refuses invalid revision addresses before comparing approved versions", async () => {
    for (const revision of [{ id: "invalid" }, { number: 0 }, { number: Number.MAX_SAFE_INTEGER + 1 }]) {
      const context = fixture(1); Object.assign(context.revision, revision);
      await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow();
    }
  });
  it("rejects invalid Unicode in retained source bytes before hashing can replace it", async () => {
    const context = fixture(1), snapshot = makeSourceSnapshot(1);
    snapshot.items[0].body = "\ud800";
    context.source.snapshotText = JSON.stringify(snapshot).replace("\\ud800", "\ud800");
    context.source.snapshotSha256 = sourceHash(context.source.snapshotText);
    context.sourceSha256 = context.source.snapshotSha256;
    await expect(readSynthesisResponseContext(packet(context), scope)).rejects.toThrow("Retained source contains invalid text");
  });
});
