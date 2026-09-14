// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import native from "./fixtures/decision-resolution-native.json";
import { DECISION_RESOLUTION_COPY_LIMIT, decisionResolutionIntentSchema, readDecisionResolution } from "@/lib/engagement/decision-request-resolution";
import type { DecisionResolutionIntent, DecisionResolutionPacket } from "@/lib/engagement/decision-request-resolution";

const other = "75000000-0000-4000-8000-000000000099";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function intent(packet = native.cancelled): DecisionResolutionIntent {
  const body = JSON.parse(packet.payloadText) as Record<string, unknown>;
  return decisionResolutionIntentSchema.parse({ resolutionId: body.resolutionId, requestId: body.requestId, copyJson: body.copyJson, reason: body.reason });
}
function changed(packet: DecisionResolutionPacket, part: "payload" | "result", change: (value: Record<string, unknown>) => void) {
  const copy = { ...packet }, value = JSON.parse(copy[`${part}Text`]) as Record<string, unknown>;
  change(value); copy[`${part}Text`] = JSON.stringify(value); copy[`${part}Sha256`] = hash(copy[`${part}Text`]);
  return copy;
}

describe("decision request recovery evidence", () => {
  it("reads native cancelled and saved receipts with exact damaged bytes", async () => {
    expect(native.synthetic).toBe(true);
    for (const packet of [native.cancelled, native.saved]) {
      for (const replayed of [false, true]) {
        const result = await readDecisionResolution({ ...packet, replayed }, native.scope, intent(packet));
        expect(JSON.parse(result.payload.copyJson)).toBe("SYNTHETIC damaged bytes \ud800 \0 \n");
        expect(result.packet.replayed).toBe(replayed);
        if (packet === native.saved) {
          expect(result.outcome.state).toBe("saved");
          expect(result.link?.context.response.we_did).toBe("SYNTHETIC corrected answer");
          expect(result.link?.context.decision.status).toBe("proposed");
        } else {
          expect(result.outcome.state).toBe("cancelled");
          expect(result.link).toBeNull();
        }
      }
    }
  });
  it("preserves a nonblank Unicode reason without trimming saved text", async () => {
    const reason = " \u00a0理由 ";
    const packet = changed(native.cancelled, "payload", value => { value.reason = reason; });
    const result = await readDecisionResolution(packet, native.scope, { ...intent(), reason });
    expect(result.payload.reason).toBe(reason);
  });
  it.each(["payload", "result"] as const)("refuses changed %s bytes without recomputed hashes", async part => {
    const packet = { ...native.cancelled, [`${part}Text`]: native.cancelled[`${part}Text`] + " " };
    await expect(readDecisionResolution(packet, native.scope, intent())).rejects.toThrow("checksum differs");
  });
  it.each(["actorId", "workspaceId", "campaignId", "resolutionId", "requestId", "copyJson", "reason"])("binds payload %s despite a recomputed checksum", async key => {
    const packet = changed(native.cancelled, "payload", value => { value[key] = key === "copyJson" ? JSON.stringify("different copy") : key === "reason" ? "different reason" : other; });
    await expect(readDecisionResolution(packet, native.scope, intent())).rejects.toThrow("differs from the retained request");
  });
  it.each(["actorId", "workspaceId", "campaignId", "resolutionId", "requestId"])("binds result %s despite a recomputed checksum", async key => {
    const packet = changed(native.cancelled, "result", value => { value[key] = other; });
    await expect(readDecisionResolution(packet, native.scope, intent())).rejects.toThrow("differs from the retained request");
  });
  it.each(["saved_without_link", "cancelled_with_link"])("refuses incoherent state %s", async fault => {
    const original = fault === "saved_without_link" ? native.cancelled : native.saved;
    const packet = changed(original, "result", value => { value.state = fault === "saved_without_link" ? "saved" : "cancelled"; });
    await expect(readDecisionResolution(packet, native.scope, intent(original))).rejects.toThrow("outcome is incomplete");
  });
  it.each(["id", "actor_id"])("binds saved link %s", async key => {
    const packet = changed(native.saved, "result", value => { (value.link as Record<string, unknown>)[key] = other; });
    await expect(readDecisionResolution(packet, native.scope, intent(native.saved))).rejects.toThrow("different request or account");
  });
  it("validates original source evidence inside a recovered receipt", async () => {
    const packet = changed(native.saved, "result", value => {
      const link = value.link as Record<string, unknown>; link.context_text = String(link.context_text) + " ";
    });
    await expect(readDecisionResolution(packet, native.scope, intent(native.saved))).rejects.toThrow("checksum differs");
  });
  it("counts encoded bytes rather than characters for large copies", () => {
    const within = JSON.stringify("界".repeat(Math.floor((DECISION_RESOLUTION_COPY_LIMIT - 2) / 3)));
    expect(decisionResolutionIntentSchema.safeParse({ ...intent(), copyJson: within }).success).toBe(true);
    const above = JSON.stringify("界".repeat(Math.floor((DECISION_RESOLUTION_COPY_LIMIT - 2) / 3) + 1));
    expect(above.length).toBeLessThan(DECISION_RESOLUTION_COPY_LIMIT);
    expect(decisionResolutionIntentSchema.safeParse({ ...intent(), copyJson: above }).success).toBe(false);
  });
  it.each(["{}", "null", ' "noncanonical"', '"bad\\q"'])("refuses invalid opaque-copy encoding %s", copyJson => {
    expect(decisionResolutionIntentSchema.safeParse({ ...intent(), copyJson }).success).toBe(false);
  });
  it.each(["", " ", "reason\0", "reason\ud800", "\u00a0\ufeff", "x".repeat(2001)])("refuses invalid reasons of length %s", reason => {
    expect(decisionResolutionIntentSchema.safeParse({ ...intent(), reason }).success).toBe(false);
  });
});
