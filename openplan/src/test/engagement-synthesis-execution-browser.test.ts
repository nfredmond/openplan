import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySynthesisExecutionHistory, verifySynthesisExecutionPreview } from "@/lib/engagement/synthesis-execution-browser";

const id = (n: number) => `c7600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2), requestId: id(3), actorId: id(4), sourceId: id(5),
  sourceSha256: "a".repeat(64), requestIntentSha256: "b".repeat(64), stage: "segment" as const };
const date = "2026-10-02T00:00:00.123456+00:00";
const intentText = JSON.stringify({ schemaVersion: 1, headerSha256: "c".repeat(64), maxAttempts: 1, maxOutputTokens: 2048,
  responseByteLimit: 65536, expiresAt: date, chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null }, null, 2);
const entry = { schemaVersion: 1, id: id(6), requestId: scope.requestId, createdAt: date,
  intentText, intentSha256: createHash("sha256").update(intentText).digest("hex") };
const history = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId,
  actorId: scope.actorId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256, requestIntentSha256: scope.requestIntentSha256,
  cancelled: false, entries: [entry], nextCursor: { id: entry.id, createdAt: date } };
const preview = { schemaVersion: 1, ...scope, headerSha256: "c".repeat(64), sealSha256: "d".repeat(64), taskCount: 2,
  inputBytes: 9000, sealedAt: date, cancelled: false,
  provider: { connectionId: id(7), revisionId: id(8), configurationHash: "e".repeat(64), label: "SYNTHETIC provider",
    endpoint: "https://provider.invalid/v1/", modelId: "synthetic", current: true } };

describe("browser execution scope and original bytes", () => {
  it("keeps original allowance bytes and exact history cursor", async () => {
    expect(await verifySynthesisExecutionHistory(history, scope)).toEqual(history);
    expect(verifySynthesisExecutionPreview(preview, scope)).toEqual(preview);
  });
  it.each(["campaignId", "workspaceId", "requestId", "actorId", "sourceId", "sourceSha256", "requestIntentSha256"] as const)(
    "refuses substituted %s in preview and history", async field => {
      const value = field.endsWith("Sha256") ? "f".repeat(64) : id(99);
      expect(() => verifySynthesisExecutionPreview({ ...preview, [field]: value }, scope)).toThrow();
      await expect(verifySynthesisExecutionHistory({ ...history, [field]: value }, scope)).rejects.toThrow();
    });
  it("refuses a preview for a different preparation stage", () => {
    expect(() => verifySynthesisExecutionPreview({ ...preview, stage: "context" }, scope)).toThrow("scope differs");
  });
  it.each(["hash", "request", "duplicate", "cursor-id", "cursor-time", "empty-cursor"])("refuses altered history %s", async kind => {
    const page = structuredClone(history);
    if (kind === "hash") page.entries[0].intentSha256 = "f".repeat(64);
    if (kind === "request") page.entries[0].requestId = id(99);
    if (kind === "duplicate") page.entries.push(entry);
    if (kind === "cursor-id") page.nextCursor.id = id(99);
    if (kind === "cursor-time") page.nextCursor.createdAt = "2026-10-02T00:00:00.123Z";
    if (kind === "empty-cursor") page.entries = [];
    await expect(verifySynthesisExecutionHistory(page, scope)).rejects.toThrow();
  });
});
