import { describe, expect, it } from "vitest";
import { readResponseLinkContextPreview, readResponseLinkHistoryDisplay } from "@/lib/engagement/synthesis-response-link-reader";
import { chain, event, fixture, history, id, packet, scope } from "./fixtures/engagement/synthesis-response-link";
import { sourceHash } from "./fixtures/engagement/synthesis-source";
const contextPacket = (context: unknown) => { const contextText = JSON.stringify(context); return { contextText, contextSha256: sourceHash(contextText) }; };
describe("browser response link display", () => {
  it("shows complete retained wording and membership with exact packet bytes", async () => {
    const raw = fixture(302), input = contextPacket(raw), result = await readResponseLinkContextPreview(input, scope);
    expect(result.packet).toEqual(input); expect(result.content.notes).toBe(JSON.parse(raw.revision.contentText).notes);
    expect(result.group.sourceIds).toEqual(JSON.parse(raw.revision.contentText).groups[0].sourceIds);
    expect(result.response.we_did).toBe(JSON.parse(raw.responseHistory.recordText).we_did);
    expect(result.approval.intent.revisionId).toBe(raw.revision.id);
  });
  it.each(["campaignId", "workspaceId", "reviewId", "responseId", "groupId"] as const)("refuses another %s", async field => {
    await expect(readResponseLinkContextPreview(contextPacket({ ...fixture(), [field]: field === "groupId" ? "another" : id(99) }), scope)).rejects.toThrow(/belongs to another/);
  });
  it("checks outer, review and response hashes independently", async () => {
    const raw = fixture(), input = contextPacket(raw);
    await expect(readResponseLinkContextPreview({ ...input, contextText: input.contextText + " " }, scope)).rejects.toThrow(/checksum/);
    await expect(readResponseLinkContextPreview(contextPacket({ ...raw, revision: { ...raw.revision, contentText: raw.revision.contentText + " " } }), scope)).rejects.toThrow(/checksum/);
    await expect(readResponseLinkContextPreview(contextPacket({ ...raw, responseHistory: { ...raw.responseHistory, recordText: raw.responseHistory.recordText + " " } }), scope)).rejects.toThrow(/checksum/);
  });
  it("refuses removed response evidence and mismatched record scope", async () => {
    const raw = fixture();
    for (const field of ["campaign_id", "response_id", "event"]) await expect(readResponseLinkContextPreview(contextPacket({ ...raw, responseHistory: { ...raw.responseHistory, [field]: field === "event" ? "removed" : id(99) } }), scope)).rejects.toThrow(/retained response/);
    for (const field of ["id", "campaign_id"]) {
      const recordText = JSON.stringify({ ...JSON.parse(raw.responseHistory.recordText), [field]: id(99) });
      await expect(readResponseLinkContextPreview(contextPacket({ ...raw, responseHistory: { ...raw.responseHistory, recordText, record_sha256: sourceHash(recordText) } }), scope)).rejects.toThrow(/response record/);
    }
  });
  it("requires the retained source identity, selected group and exact approval", async () => {
    const raw = fixture();
    for (const field of ["sourceId", "sourceSha256", "groups"]) {
      const contentText = JSON.stringify({ ...JSON.parse(raw.revision.contentText), [field]: field === "groups" ? [] : field === "sourceId" ? id(99) : "a".repeat(64) });
      await expect(readResponseLinkContextPreview(contextPacket({ ...raw, revision: { ...raw.revision, contentText, contentSha256: sourceHash(contentText) } }), scope)).rejects.toThrow(field === "groups" ? /group/ : /source/);
    }
    for (const field of ["revisionId", "revisionNo", "revisionSha256", "operation"]) {
      const approval = JSON.parse(raw.approval.eventText); approval.intent[field] = field === "revisionNo" ? 2 : field === "revisionSha256" ? "a".repeat(64) : field === "operation" ? "withdraw" : id(99);
      if (field === "operation") { approval.eventNo = 2; approval.intent.predecessorId = id(98); approval.intent.predecessorSha256 = "b".repeat(64); }
      await expect(readResponseLinkContextPreview(contextPacket({ ...raw, approval: packet(approval) }), scope)).rejects.toThrow(/approval differs/);
    }
  });
  it("shows the complete original, corrected, withdrawn and restored link chain", async () => {
    const { first, second, third, fourth } = chain(), result = await readResponseLinkHistoryDisplay(history([first, second, third, fourth]), scope);
    expect(result.entries.map(row => row.eventText)).toEqual([first, second, third, fourth].map(row => row.eventText));
    expect(result.entries[0].preview.response.we_did).not.toBe(result.head?.preview.response.we_did);
    expect(result.entries[2].context).toEqual(result.entries[1].context); expect(result.head?.eventSha256).toBe(fourth.eventSha256);
    expect(await readResponseLinkHistoryDisplay(history([]), scope)).toEqual({ scope, entries: [], head: null });
  });
  it("refuses incomplete counts, reordered or duplicated events and wrong heads", async () => {
    const { first, second, third } = chain(), full = history([first, second, third]);
    for (const raw of [{ ...full, eventCount: 4 }, { ...full, entries: [first, third] }, history([second, first, third]), history([first, first]), { ...full, headId: id(99) }, { ...full, headSha256: "a".repeat(64) }]) await expect(readResponseLinkHistoryDisplay(raw, scope)).rejects.toThrow();
  });
  it("refuses skipped numbers and reused request IDs with otherwise valid predecessors", async () => {
    const { first, second, third } = chain();
    const skipped = packet({ ...JSON.parse(second.eventText), eventNo: 3 });
    await expect(readResponseLinkHistoryDisplay(history([first, skipped]), scope)).rejects.toThrow(/order/);
    const reused = JSON.parse(third.eventText); reused.intent.requestId = JSON.parse(first.eventText).intent.requestId;
    await expect(readResponseLinkHistoryDisplay(history([first, second, packet(reused)]), scope)).rejects.toThrow(/order/);
  });
  it("checks every event's scope and predecessor even with valid checksums", async () => {
    const { first, second } = chain(), value = JSON.parse(second.eventText);
    for (const field of ["predecessorId", "predecessorSha256"]) {
      const changed = packet({ ...value, intent: { ...value.intent, [field]: field.endsWith("Sha256") ? "a".repeat(64) : id(99) } });
      await expect(readResponseLinkHistoryDisplay(history([first, changed]), scope)).rejects.toThrow(/predecessor/);
    }
    const foreignScope = { ...scope, campaignId: id(99) };
    await expect(readResponseLinkHistoryDisplay({ ...history([first]), ...foreignScope }, foreignScope)).rejects.toThrow(/belongs to another/);
  });
  it("rejects withdrawal evidence replacement and repeated withdrawal", async () => {
    const { first, second, third } = chain(), value = JSON.parse(third.eventText);
    const replaced = packet({ ...value, context: JSON.parse(first.eventText).context });
    await expect(readResponseLinkHistoryDisplay(history([first, second, replaced]), scope)).rejects.toThrow(/withdrawal evidence/);
    const repeatedValue = event(fixture(), 4, third, "withdraw");
    repeatedValue.context = value.context;
    const repeated = packet(repeatedValue);
    await expect(readResponseLinkHistoryDisplay(history([first, second, third, repeated]), scope)).rejects.toThrow(/withdrawal evidence/);
  });
});
