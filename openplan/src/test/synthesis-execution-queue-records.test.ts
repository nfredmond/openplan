import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSynthesisExecutionQueueCommand, verifySynthesisExecutionQueueReceipt } from "../lib/engagement/synthesis-execution-queue-records";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = { schemaVersion: 1, queueId: id(1), authorizationId: id(2), authorizationIntentSha256: "a".repeat(64),
  campaignId: id(3), workspaceId: id(4), requestId: id(5), actorId: id(6), sourceId: id(7),
  sourceSha256: "b".repeat(64), requestIntentSha256: "c".repeat(64), stage: "segment" };
const original = JSON.stringify(command);
const receipt = (commandText = original) => ({ schemaVersion: 1, queueId: command.queueId, commandText,
  commandSha256: createHash("sha256").update(commandText).digest("hex"), createdAt: "2026-10-07T23:00:00Z" });

describe("exact synthesis execution queue records", () => {
  it.each(["segment", "context", "thematic"])("preserves a %s command and its original formatting", async stage => {
    const bytes = JSON.stringify({ ...command, stage }, null, 2);
    const result = await verifySynthesisExecutionQueueReceipt(receipt(bytes), bytes);
    expect(result.receipt.commandText).toBe(bytes);
    expect(result.command.stage).toBe(stage);
  });
  it.each(["queueId", "authorizationId", "campaignId", "workspaceId", "requestId", "actorId", "sourceId"])(
    "rejects a receipt for changed %s even with its valid checksum", async field => {
      const changed = JSON.stringify({ ...command, [field]: id(99) });
      await expect(verifySynthesisExecutionQueueReceipt(receipt(changed), original)).rejects.toThrow("original command");
    });
  it.each(["authorizationIntentSha256", "sourceSha256", "requestIntentSha256"])(
    "rejects changed %s with a recomputed checksum", async field => {
      const changed = JSON.stringify({ ...command, [field]: "d".repeat(64) });
      await expect(verifySynthesisExecutionQueueReceipt(receipt(changed), original)).rejects.toThrow("original command");
    });
  it("rejects another stage", async () => {
    await expect(verifySynthesisExecutionQueueReceipt(receipt(JSON.stringify({ ...command, stage: "context" })), original))
      .rejects.toThrow("original command");
  });
  it("rejects a separately changed queue receipt identity", async () => {
    await expect(verifySynthesisExecutionQueueReceipt({ ...receipt(), queueId: id(99) }, original)).rejects.toThrow("original command");
  });
  it("rejects checksum substitution", async () => {
    await expect(verifySynthesisExecutionQueueReceipt({ ...receipt(), commandSha256: "0".repeat(64) }, original)).rejects.toThrow("checksum");
  });
  it("does not accept normalized bytes in place of the saved command", async () => {
    await expect(verifySynthesisExecutionQueueReceipt(receipt(JSON.stringify(command, null, 2)), original)).rejects.toThrow("original command");
  });
  it("rejects a byte-oversized original before parsing", () => {
    expect(() => parseSynthesisExecutionQueueCommand(original + " ".repeat(4096))).toThrow();
  });
  it("rejects invalid or extra command fields", () => {
    expect(() => parseSynthesisExecutionQueueCommand(JSON.stringify({ ...command, stage: "all" }))).toThrow();
    expect(() => parseSynthesisExecutionQueueCommand(JSON.stringify({ ...command, dispatch: true }))).toThrow();
  });
  it("rejects malformed JSON and malformed receipts", async () => {
    expect(() => parseSynthesisExecutionQueueCommand("{")).toThrow();
    await expect(verifySynthesisExecutionQueueReceipt({ ...receipt(), createdAt: "yesterday" }, original)).rejects.toThrow();
  });
});
