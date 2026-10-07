import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { authorizeSynthesisExecution } from "@/lib/engagement/synthesis-execution-server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const date = "2026-10-02T12:00:00.000Z";
const requestIntent = { schemaVersion: 1, sourceId: id(5), sourceSha256: "a".repeat(64), connectionId: id(6),
  configurationRevisionId: id(7), configurationHash: "b".repeat(64), modelId: "synthetic-model", taskByteLimit: 4096 };
const requestText = JSON.stringify(requestIntent);
const intent = { schemaVersion: 1, headerSha256: "c".repeat(64), maxAttempts: 2, maxOutputTokens: 2048,
  responseByteLimit: 65536, expiresAt: date, chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null };
const command = { campaignId: id(1), workspaceId: id(2), requestId: id(3), actorId: id(4),
  sourceId: id(5), sourceSha256: requestIntent.sourceSha256, requestIntentSha256: hash(requestText),
  stage: "segment" as const, authorizationId: id(8), intentText: JSON.stringify(intent, null, 2) };
function request(cancelled = false) {
  const receiptText = JSON.stringify({ schemaVersion: 1, id: id(9), requestId: command.requestId,
    campaignId: command.campaignId, workspaceId: command.workspaceId, actorId: command.actorId,
    reason: "Stop this request", requestExisted: true, cancelledAt: date });
  return { schemaVersion: 1, campaignId: command.campaignId, workspaceId: command.workspaceId,
    request: { id: command.requestId, actorId: command.actorId, intentText: requestText, intentSha256: hash(requestText), createdAt: date },
    cancellation: cancelled ? { id: id(9), receiptText, receiptSha256: hash(receiptText), createdAt: date } : null };
}
function receipt() { return { schemaVersion: 1, id: command.authorizationId, requestId: command.requestId,
  intentText: command.intentText, intentSha256: hash(command.intentText) }; }
type Answer = { data: unknown; error: null | { code: string; message?: string } };
const ok = (data: unknown): Answer => ({ data, error: null });
function client(answers: Answer[], after?: (index: number, signal: AbortSignal) => void) {
  let index = 0;
  const rpc = vi.fn((_name: string, _args: unknown) => ({ abortSignal: async (signal: AbortSignal) => {
    const current = index++; after?.(current, signal);
    if (!answers[current]) throw new Error("Unexpected native call");
    return answers[current];
  } }));
  return { rpc, db: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}
const signal = () => new AbortController().signal;

describe("staff execution authorization adapter", () => {
  it.each(["segment", "context", "thematic"] as const)("retains exact %s intent once between current request reads", async stage => {
    const mock = client([ok(request()), ok(receipt()), ok(request())]);
    expect(await authorizeSynthesisExecution(mock.db, { ...command, stage }, signal())).toEqual(receipt());
    expect(mock.rpc.mock.calls).toEqual([
      ["read_engagement_synthesis_generation_request", { p_campaign: command.campaignId, p_request: command.requestId }],
      [`authorize_engagement_synthesis_${stage === "segment" ? "generation" : stage}`, {
        p_request: command.requestId, p_authorization: command.authorizationId, p_intent_text: command.intentText }],
      ["read_engagement_synthesis_generation_request", { p_campaign: command.campaignId, p_request: command.requestId }],
    ]);
  });
  it("recovers an expired original receipt after cancellation without today's provider lookup", async () => {
    const mock = client([ok(request(true)), ok(receipt()), ok(request(true))]);
    expect(await authorizeSynthesisExecution(mock.db, command, signal())).toEqual(receipt());
    expect(mock.rpc).toHaveBeenCalledTimes(3);
  });
  it.each(["actorId", "sourceId", "sourceSha256", "requestIntentSha256"] as const)("refuses changed %s before authorizing", async field => {
    const mock = client([ok(request())]);
    await expect(authorizeSynthesisExecution(mock.db, { ...command, [field]: field.endsWith("Sha256") ? "d".repeat(64) : id(99) }, signal()))
      .rejects.toMatchObject({ status: field === "actorId" ? 403 : 409 });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["campaignId", "workspaceId"] as const)("refuses a native request from another %s", async field => {
    const mock = client([ok({ ...request(), [field]: id(99) })]);
    await expect(authorizeSynthesisExecution(mock.db, command, signal())).rejects.toMatchObject({ status: 503 });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["id", "requestId", "intentText", "intentSha256"] as const)("refuses a receipt with different %s", async field => {
    const changed = { ...receipt(), [field]: field === "intentText" ? JSON.stringify(intent) : field.endsWith("Sha256") ? "d".repeat(64) : id(99) };
    const mock = client([ok(request()), ok(changed)]);
    await expect(authorizeSynthesisExecution(mock.db, command, signal())).rejects.toMatchObject({ status: 503 });
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });
  it("refuses acknowledgement after current access is revoked, leaving the original grant recoverable", async () => {
    const mock = client([ok(request()), ok(receipt()), { data: null, error: { code: "42501" } }]);
    await expect(authorizeSynthesisExecution(mock.db, command, signal())).rejects.toMatchObject({ status: 403 });
    expect(mock.rpc).toHaveBeenCalledTimes(3);
  });
  it.each([["42501", 403], ["PT409", 409], ["0A000", 409], ["22023", 400], ["PT503", 503], ["unknown", 503]] as const)(
    "preserves native refusal %s without replaying or exposing private diagnostics", async (code, status) => {
      const mock = client([ok(request()), { data: null, error: { code, message: "PRIVATE detail" } }]);
      const result = authorizeSynthesisExecution(mock.db, command, signal());
      await expect(result).rejects.toMatchObject({ status });
      await expect(result).rejects.not.toThrow("PRIVATE detail");
      expect(mock.rpc).toHaveBeenCalledTimes(2);
    });
  it.each([
    { chargesAcknowledged: false }, { maxAttempts: 0 }, { maxAttempts: Number.MAX_SAFE_INTEGER + 1 },
    { maxOutputTokens: 65537 }, { responseByteLimit: 4095 }, { responseByteLimit: 4194305 },
    { retryTaskIndex: 0 }, { retryOfAttemptId: id(10) }, { retryTaskIndex: 0, retryOfAttemptId: id(10), maxAttempts: 2 },
  ])("rejects invalid authority before reading or writing: %j", async patch => {
    const mock = client([]);
    await expect(authorizeSynthesisExecution(mock.db, { ...command, intentText: JSON.stringify({ ...intent, ...patch }) }, signal())).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("preserves an explicit one-attempt retry and its original predecessor", async () => {
    const intentText = JSON.stringify({ ...intent, maxAttempts: 1, retryTaskIndex: 0, retryOfAttemptId: id(10) });
    const saved = { ...receipt(), intentText, intentSha256: hash(intentText) };
    const mock = client([ok(request()), ok(saved), ok(request())]);
    expect(await authorizeSynthesisExecution(mock.db, { ...command, intentText }, signal())).toEqual(saved);
  });
  it.each([0, 1, 2])("refuses late output after abort at native call %s", async abortAt => {
    const controller = new AbortController();
    const mock = client([ok(request()), ok(receipt()), ok(request())], (index, bounded) => {
      if (index === abortAt) { controller.abort(); expect(bounded.aborted).toBe(true); }
    });
    await expect(authorizeSynthesisExecution(mock.db, command, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.rpc).toHaveBeenCalledTimes(abortAt + 1);
  });
});
