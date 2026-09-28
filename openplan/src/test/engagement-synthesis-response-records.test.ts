import { describe, expect, it } from "vitest";
import { readSynthesisResponseLinkEvent, readSynthesisResponseLinkHistory, readSynthesisResponseLinkReceipt, synthesisResponseLinkIntentSchema, type SynthesisResponseLinkIntent } from "@/lib/engagement/synthesis-response-records-server";
import type { SynthesisApprovalIntent } from "@/lib/engagement/synthesis-approval";
import { createSynthesisReviewContent } from "@/lib/engagement/synthesis-review";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const contextScope = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, reviewId: id(1), responseId: id(2) };
function fixture(items = 1) {
  const source = savedSource(makeSourceSnapshot(items));
  const { content, preparation } = createSynthesisReviewContent(makeSourceSnapshot(items), source.snapshotSha256);
  const preparationText = JSON.stringify(preparation, null, 1), contentText = JSON.stringify(content, null, 2);
  const revision = { id: contextScope.reviewId, number: 1, contentText, contentSha256: sourceHash(contentText) };
  const intent: SynthesisApprovalIntent = { campaignId: contextScope.campaignId, workspaceId: contextScope.workspaceId, reviewId: contextScope.reviewId,
    sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256,
    preparationSha256: sourceHash(preparationText), revisionId: revision.id, revisionNo: 1, revisionSha256: revision.contentSha256,
    requestId: id(3), actorId: sourceActor, operation: "approve", reason: "SYNTHETIC exact private approval",
    predecessorId: null, predecessorSha256: null };
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: 1, createdAt: sourceDate, intent });
  const recordText = JSON.stringify({ id: contextScope.responseId, campaign_id: contextScope.campaignId, category_id: null,
    theme_title: "SYNTHETIC response", you_said: "SYNTHETIC reviewed issues", we_did: "SYNTHETIC staff explanation é",
    status: "draft", ai_assisted: false, source_item_ids: [], sort_order: 0, published_at: null,
    created_at: sourceDate, updated_at: sourceDate, created_by: sourceActor }, null, 1);
  return { schemaVersion: 1, visibility: "private", purpose: "reviewed_synthesis_response", ...contextScope,
    sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256, source,
    preparationText, preparationSha256: sourceHash(preparationText), revision,
    approval: { eventText, eventSha256: sourceHash(eventText) }, groupId: content.groups[0].id,
    responseHistory: { id: id(4), campaign_id: contextScope.campaignId, response_id: contextScope.responseId, revision: 1,
      actor_id: sourceActor, recorded_at: sourceDate, event: "created", recordText, record_sha256: sourceHash(recordText) } };
}

const scope = { ...contextScope, groupId: fixture().groupId };
type Context = ReturnType<typeof fixture>;
function event(context: Context, number = 1, previous: ReturnType<typeof packet> | null = null, operation: SynthesisResponseLinkIntent["operation"] = number === 1 ? "link" : "refresh") {
  const contextText = JSON.stringify(context, null, 2), contextSha256 = sourceHash(contextText);
  return { schemaVersion: 1, purpose: "private_synthesis_response_link", eventNo: number, createdAt: sourceDate,
    intent: { ...scope, requestId: id(10 + number), actorId: sourceActor, operation, reason: "SYNTHETIC retained link é🚲",
      predecessorId: previous ? id(9 + number) : null, predecessorSha256: previous?.eventSha256 ?? null,
      expectedContextSha256: operation === "withdraw" ? null : contextSha256 }, context: { contextText, contextSha256 } };
}
function packet(value: unknown) { const eventText = JSON.stringify(value, null, 2); return { eventText, eventSha256: sourceHash(eventText) }; }
function history(entries: ReturnType<typeof packet>[]) {
  const head = entries.at(-1);
  return { ...scope, entries, eventCount: entries.length,
    headId: head ? (JSON.parse(head.eventText) as { intent: { requestId: string } }).intent.requestId : null,
    headSha256: head?.eventSha256 ?? null };
}
function changed(context = fixture()) {
  const result = structuredClone(context);
  result.responseHistory.id = id(50); result.responseHistory.revision = 2; result.responseHistory.event = "corrected";
  const record = JSON.parse(result.responseHistory.recordText);
  result.responseHistory.recordText = JSON.stringify({ ...record, we_did: "SYNTHETIC corrected response" });
  result.responseHistory.record_sha256 = sourceHash(result.responseHistory.recordText);
  return result;
}
function chain() {
  const original = fixture(), revised = changed(original);
  const first = packet(event(original)), second = packet(event(revised, 2, first));
  const third = packet(event(revised, 3, second, "withdraw")), fourth = packet(event(revised, 4, third));
  return { original, revised, first, second, third, fourth };
}

describe("retained synthesis response records", () => {
  it("verifies complete original, refresh, withdrawal and relink bytes", async () => {
    const { first, second, third, fourth } = chain();
    const result = await readSynthesisResponseLinkHistory(history([first, second, third, fourth]), scope);
    expect(result.entries.map(row => row.intent.operation)).toEqual(["link", "refresh", "withdraw", "refresh"]);
    expect(result.entries[0].eventText).toBe(first.eventText); expect(result.head?.eventSha256).toBe(fourth.eventSha256);
    expect(result.entries[2].context).toEqual(result.entries[1].context);
    expect(result.head?.evidence.response.we_did).toBe("SYNTHETIC corrected response");
    const expected = synthesisResponseLinkIntentSchema.parse(JSON.parse(first.eventText).intent);
    expect((await readSynthesisResponseLinkReceipt({ event: first, replayed: true }, expected)).replayed).toBe(true);
  });
  it("retains a reason containing 2000 supplementary Unicode characters", async () => {
    const value = event(fixture()); value.intent.reason = "🚲".repeat(2000);
    expect((await readSynthesisResponseLinkEvent(packet(value), scope)).intent.reason).toBe(value.intent.reason);
  });
  it("preserves a complete 302-member selected group", async () => {
    const result = await readSynthesisResponseLinkEvent(packet(event(fixture(301))), scope);
    expect(result.evidence.group.sourceIds).toHaveLength(302);
  });
  it("accepts an explicitly complete empty history", async () => {
    expect(await readSynthesisResponseLinkHistory(history([]), scope)).toEqual({ scope, entries: [], head: null });
  });
  it.each(["campaignId", "workspaceId", "reviewId", "responseId", "groupId"] as const)("rejects foreign %s", async key => {
    const expected = { ...scope, [key]: key === "groupId" ? "other" : id(90) };
    await expect(readSynthesisResponseLinkHistory(history([]), expected)).rejects.toThrow("link scope differs");
    await expect(readSynthesisResponseLinkEvent(packet(event(fixture())), expected)).rejects.toThrow("link scope differs");
  });
  it("rejects changed bytes and invalid text", async () => {
    const original = packet(event(fixture()));
    await expect(readSynthesisResponseLinkEvent({ ...original, eventText: original.eventText + " " }, scope)).rejects.toThrow("event checksum differs");
    for (const eventText of ["\ud800", "\0"]) await expect(readSynthesisResponseLinkEvent({ eventText, eventSha256: sourceHash(eventText) }, scope)).rejects.toThrow("Invalid synthesis response event text");
  });
  it.each([{ schemaVersion: 2 }, { purpose: "public_authority" }, { extra: true }])("rejects unsupported event %j", async patch => {
    await expect(readSynthesisResponseLinkEvent(packet({ ...event(fixture()), ...patch }), scope)).rejects.toThrow();
  });
  it("verifies inner evidence even after recomputing the outer event hash", async () => {
    const value = event(fixture()); value.context.contextText += " ";
    await expect(readSynthesisResponseLinkEvent(packet(value), scope)).rejects.toThrow("context checksum differs");
  });
  it("binds the context group and intended context hash", async () => {
    const other = { ...scope, groupId: "different" }, value = event(fixture()); value.intent.groupId = other.groupId;
    await expect(readSynthesisResponseLinkEvent(packet(value), other)).rejects.toThrow("context group differs");
    const stale = event(fixture()); stale.intent.expectedContextSha256 = sourceHash("other");
    await expect(readSynthesisResponseLinkEvent(packet(stale), scope)).rejects.toThrow("intended context differs");
  });
  it.each([
    { operation: "link", predecessorId: id(80), predecessorSha256: sourceHash("previous") },
    { operation: "refresh" }, { operation: "withdraw" }, { predecessorSha256: sourceHash("previous") },
    { predecessorId: id(11), predecessorSha256: sourceHash("previous"), operation: "refresh" },
    { reason: " \uFEFF\n" }, { reason: "\ud800" }, { reason: "\0" }, { reason: "é".repeat(2001) },
    { expectedContextSha256: null }, { extra: true },
  ])("rejects invalid exact intent %#", async patch => {
    const value = event(fixture());
    expect(() => synthesisResponseLinkIntentSchema.parse({ ...value.intent, ...patch })).toThrow();
    await expect(readSynthesisResponseLinkEvent(packet({ ...value, intent: { ...value.intent, ...patch } }), scope)).rejects.toThrow();
  });
  it("rejects a first link numbered as a later event", async () => {
    const value = event(fixture()); value.eventNo = 2;
    await expect(readSynthesisResponseLinkEvent(packet(value), scope)).rejects.toThrow("event sequence differs");
  });
  it("rejects omitted events and reordered history", async () => {
    const { first, second } = chain(), full = history([first, second]);
    await expect(readSynthesisResponseLinkHistory({ ...full, entries: [first] }, scope)).rejects.toThrow("history is incomplete");
    await expect(readSynthesisResponseLinkHistory(history([second, first]), scope)).rejects.toThrow("history order differs");
  });
  it("rejects omitted events even when metadata count matches the entries", async () => {
    const { first, second } = chain(), value = JSON.parse(second.eventText); value.eventNo = 3;
    await expect(readSynthesisResponseLinkHistory(history([first, packet(value)]), scope)).rejects.toThrow("history order differs");
  });
  it.each(["predecessorId", "predecessorSha256"] as const)("rejects changed %s", async key => {
    const { first, second } = chain(), value = JSON.parse(second.eventText);
    value.intent[key] = key === "predecessorId" ? id(90) : sourceHash("wrong");
    await expect(readSynthesisResponseLinkHistory(history([first, packet(value)]), scope)).rejects.toThrow("predecessor differs");
  });
  it.each(["headId", "headSha256"] as const)("rejects incorrect %s", async key => {
    const { first } = chain();
    await expect(readSynthesisResponseLinkHistory({ ...history([first]), [key]: key === "headId" ? id(90) : sourceHash("wrong") }, scope)).rejects.toThrow("history head differs");
  });
  it("rejects a withdrawal that changes retained context", async () => {
    const { first, revised } = chain(), withdrawal = packet(event(revised, 2, first, "withdraw"));
    await expect(readSynthesisResponseLinkHistory(history([first, withdrawal]), scope)).rejects.toThrow("withdrawal context differs");
  });
  it("rejects duplicate withdrawal and formatting-only active refresh", async () => {
    const { original, revised, first, second, third } = chain();
    const fourth = packet(event(revised, 4, third, "withdraw"));
    await expect(readSynthesisResponseLinkHistory(history([first, second, third, fourth]), scope)).rejects.toThrow("withdrawal context differs");
    const value = event(original, 2, first); value.context.contextText += " ";
    value.context.contextSha256 = sourceHash(value.context.contextText); value.intent.expectedContextSha256 = value.context.contextSha256;
    await expect(readSynthesisResponseLinkHistory(history([first, packet(value)]), scope)).rejects.toThrow("refresh changes nothing");
  });
  it.each(["actorId", "reason", "requestId"] as const)("rejects a receipt with different %s", async key => {
    const { first } = chain(), intent = synthesisResponseLinkIntentSchema.parse(JSON.parse(first.eventText).intent);
    await expect(readSynthesisResponseLinkReceipt({ event: first, replayed: true }, { ...intent, [key]: key === "reason" ? "Different reason" : id(90) })).rejects.toThrow("receipt differs from the exact command");
  });
});

function reviewVersion(context: Context, revision: number, approvalNo = 1) {
  const result = structuredClone(context); result.revision.id = id(70 + revision); result.revision.number = revision;
  const approval = JSON.parse(result.approval.eventText);
  approval.eventNo = approvalNo; approval.intent.requestId = id(80 + approvalNo);
  approval.intent.revisionId = result.revision.id; approval.intent.revisionNo = revision;
  result.approval.eventText = JSON.stringify(approval); result.approval.eventSha256 = sourceHash(result.approval.eventText);
  return result;
}
describe("retained synthesis response version identity", () => {
  it("rejects a changed source within one review history", async () => {
    const first = packet(event(fixture()));
    await expect(readSynthesisResponseLinkHistory(history([first, packet(event(reviewVersion(changed(fixture(2)), 2, 2), 2, first))]), scope)).rejects.toThrow("review source differs");
  });
  it.each(["review", "response", "approval"] as const)("rejects a return to an older %s version", async kind => {
    const initial = kind === "review" ? reviewVersion(fixture(), 2) : kind === "approval" ? reviewVersion(fixture(), 1, 2) : changed();
    const next = kind === "response" ? fixture() : kind === "review" ? reviewVersion(changed(), 1, 2) : reviewVersion(changed(), 1, 1);
    const first = packet(event(initial));
    await expect(readSynthesisResponseLinkHistory(history([first, packet(event(next, 2, first))]), scope)).rejects.toThrow("returns to an older version");
  });
  it.each(["review", "response", "approval"] as const)("rejects conflicting identity for the same %s version", async kind => {
    const initial = fixture(), next = kind === "response" ? structuredClone(initial) : changed(initial);
    if (kind === "response") next.responseHistory.id = id(99);
    if (kind === "review") {
      next.revision.id = id(99);
      const value = JSON.parse(next.approval.eventText); value.intent.revisionId = next.revision.id; value.eventNo = 2; value.intent.requestId = id(98);
      next.approval.eventText = JSON.stringify(value); next.approval.eventSha256 = sourceHash(next.approval.eventText);
    }
    if (kind === "approval") {
      const value = JSON.parse(next.approval.eventText); value.intent.requestId = id(99);
      next.approval.eventText = JSON.stringify(value); next.approval.eventSha256 = sourceHash(next.approval.eventText);
    }
    const first = packet(event(initial));
    await expect(readSynthesisResponseLinkHistory(history([first, packet(event(next, 2, first))]), scope)).rejects.toThrow("context version identity differs");
  });
  it("rejects reused event identity with a valid nonadjacent predecessor", async () => {
    const { revised, first, second, third } = chain(), value = event(revised, 4, third);
    value.intent.requestId = id(11);
    await expect(readSynthesisResponseLinkHistory(history([first, second, third, packet(value)]), scope)).rejects.toThrow("history order differs");
  });
});

describe("retained synthesis response immutable record identities", () => {
  it.each(["review", "response", "approval"] as const)("rejects reuse of a %s record ID at a newer version", async kind => {
    const initial = fixture();
    const next = kind === "review" ? reviewVersion(changed(initial), 2, 2) : kind === "approval" ? reviewVersion(changed(initial), 1, 2) : changed(initial);
    if (kind === "response") next.responseHistory.id = initial.responseHistory.id;
    if (kind === "review") {
      next.revision.id = initial.revision.id;
      const approval = JSON.parse(next.approval.eventText); approval.intent.revisionId = next.revision.id;
      next.approval.eventText = JSON.stringify(approval); next.approval.eventSha256 = sourceHash(next.approval.eventText);
    }
    if (kind === "approval") {
      next.revision = initial.revision;
      const approval = JSON.parse(next.approval.eventText), old = JSON.parse(initial.approval.eventText);
      approval.intent.requestId = old.intent.requestId; approval.intent.revisionId = initial.revision.id;
      next.approval.eventText = JSON.stringify(approval); next.approval.eventSha256 = sourceHash(next.approval.eventText);
    }
    const first = packet(event(initial));
    await expect(readSynthesisResponseLinkHistory(history([first, packet(event(next, 2, first))]), scope)).rejects.toThrow("immutable context record identity differs");
  });
});
