import { describe, expect, it } from "vitest";
import { readSynthesisResponseLinkAcknowledgement, synthesisResponseLinkIntentSchema } from "@/lib/engagement/synthesis-response-link";
import { event, fixture, packet, chain, id } from "./fixtures/engagement/synthesis-response-link";
import { sourceHash } from "./fixtures/engagement/synthesis-source";

const saved = event(fixture()), intent = synthesisResponseLinkIntentSchema.parse(saved.intent);
const receipt = (value: unknown = saved) => ({ event: packet(value), replayed: false });
describe("browser synthesis response acknowledgement", () => {
  it("preserves exact native bytes and the complete command for original and replayed receipts", async () => {
    for (const replayed of [false, true]) {
      const raw = { ...receipt(), replayed }, result = await readSynthesisResponseLinkAcknowledgement(raw, intent);
      expect(result.event.eventText).toBe(raw.event.eventText); expect(result.event.intent).toEqual(intent); expect(result.replayed).toBe(replayed);
    }
  });
  it("accepts refresh, withdrawal and renewed link receipts with their own exact intents", async () => {
    const { first, second, third, fourth } = chain();
    for (const value of [first, second, third, fourth]) {
      const expected = synthesisResponseLinkIntentSchema.parse(JSON.parse(value.eventText).intent);
      expect((await readSynthesisResponseLinkAcknowledgement({ event: value, replayed: false }, expected)).event.eventText).toBe(value.eventText);
    }
  });
  it.each(["reason", "actorId", "requestId", "predecessorSha256", "expectedContextSha256"])("rejects a different exact command field: %s", async field => {
    const { second } = chain(), value = JSON.parse(second.eventText), expected = synthesisResponseLinkIntentSchema.parse(value.intent);
    const changed = { ...value, intent: { ...value.intent, [field]: field === "reason" ? "Different reason" : field.endsWith("Sha256") ? sourceHash("different") : id(99) } };
    await expect(readSynthesisResponseLinkAcknowledgement(receipt(changed), expected)).rejects.toThrow(/another command/);
  });
  it("rejects malformed receipts, unsupported event purpose and version", async () => {
    for (const raw of [{ ...receipt(), extra: true }, { ...receipt(), replayed: "yes" }, receipt({ ...saved, purpose: "public" }), receipt({ ...saved, schemaVersion: 2 }), receipt({ ...saved, extra: true })]) {
      await expect(readSynthesisResponseLinkAcknowledgement(raw, intent)).rejects.toThrow();
    }
  });
  it("rejects changed event bytes and invalid Unicode before parsing", async () => {
    const original = packet(saved);
    await expect(readSynthesisResponseLinkAcknowledgement({ event: { ...original, eventText: original.eventText + " " }, replayed: false }, intent)).rejects.toThrow(/checksum/);
    for (const eventText of ['{"invalid":"\ud800"}', '{"invalid":"\0"}']) {
      await expect(readSynthesisResponseLinkAcknowledgement({ event: { eventText, eventSha256: sourceHash(eventText) }, replayed: false }, intent)).rejects.toThrow(/Invalid/);
    }
  });
  it("rejects a first link numbered as a later event", async () => {
    await expect(readSynthesisResponseLinkAcknowledgement(receipt({ ...saved, eventNo: 2 }), intent)).rejects.toThrow(/sequence/);
  });
  it("checks inner context bytes even when the outer event checksum is valid", async () => {
    await expect(readSynthesisResponseLinkAcknowledgement(receipt({ ...saved, context: { ...saved.context, contextText: saved.context.contextText + " " } }), intent)).rejects.toThrow(/checksum/);
  });
  it.each(["campaignId", "workspaceId", "reviewId", "responseId", "groupId"])("rejects a rehashed context with another %s", async field => {
    const value = { ...fixture(), [field]: field === "groupId" ? "another" : id(99) }, contextText = JSON.stringify(value), contextSha256 = sourceHash(contextText);
    const changed = { ...saved, context: { contextText, contextSha256 }, intent: { ...intent, expectedContextSha256: contextSha256 } };
    await expect(readSynthesisResponseLinkAcknowledgement(receipt(changed), changed.intent)).rejects.toThrow(/scope/);
  });
  it("refuses a correctly hashed context that differs from the frozen command", async () => {
    const contextText = saved.context.contextText + " ";
    await expect(readSynthesisResponseLinkAcknowledgement(receipt({ ...saved, context: { contextText, contextSha256: sourceHash(contextText) } }), intent)).rejects.toThrow(/retained command/);
  });
});
