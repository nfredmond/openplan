import { describe, expect, it } from "vitest";
import { readSynthesisResponseLinkEvent, readSynthesisResponseLinkHistory, readSynthesisResponseLinkReceipt, synthesisResponseLinkIntentSchema } from "@/lib/engagement/synthesis-response-records-server";
import { sourceHash } from "./fixtures/engagement/synthesis-source";
import { id, fixture, scope, event, packet, history, changed, chain, reviewVersion } from "./fixtures/engagement/synthesis-response-link";

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
