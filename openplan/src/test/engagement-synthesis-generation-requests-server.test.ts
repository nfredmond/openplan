import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { cancelSynthesisGenerationRequest, createSynthesisGenerationRequest, readSynthesisGenerationRequest,
  verifySynthesisGenerationRequest } from "@/lib/engagement/synthesis-generation-requests-server";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: uuid(1), workspaceId: uuid(2), requestId: uuid(3) };
const actorId = uuid(4), cancellationId = uuid(5), date = "2026-10-02T12:00:00.000Z";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const intent = { schemaVersion: 1, sourceId: uuid(6), sourceSha256: "a".repeat(64), connectionId: uuid(7),
  configurationRevisionId: uuid(8), configurationHash: "b".repeat(64), modelId: "synthetic-model", taskByteLimit: 4096 };
const intentText = JSON.stringify(intent, null, 2);
function state(exists = true, cancelled = false) {
  const receiptText = JSON.stringify({ schemaVersion: 1, id: cancellationId, ...scope, actorId,
    reason: "Stop this exact request", requestExisted: exists, cancelledAt: date });
  return { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: exists ? { id: scope.requestId, actorId, intentText, intentSha256: hash(intentText), createdAt: date } : null,
    cancellation: cancelled ? { id: cancellationId, receiptText, receiptSha256: hash(receiptText), createdAt: date } : null,
    replayed: false };
}
function client(data: unknown, code?: string, after?: () => void) {
  const abortSignal = vi.fn(async (_signal: AbortSignal) => { after?.(); return { data, error: code ? { code, message: "PRIVATE detail" } : null }; });
  const rpc = vi.fn(() => ({ abortSignal }));
  return { rpc, abortSignal, db: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}
const signal = () => new AbortController().signal;
const create = { ...scope, actorId, intentText };
const cancel = { ...scope, actorId, cancellationId, reason: "Stop this exact request" };

describe("staff synthesis request custody adapter", () => {
  it("preserves exact request bytes, uses authenticated creation once and accepts retained replay after cancellation", async () => {
    const saved = { ...state(true, true), replayed: true }, mock = client(saved);
    const result = await createSynthesisGenerationRequest(mock.db, create, signal());
    expect(result.state).toEqual(saved);
    expect(result.intent).toEqual(intent);
    expect(mock.rpc.mock.calls).toEqual([["create_engagement_synthesis_generation_request", {
      p_campaign: scope.campaignId, p_request: scope.requestId, p_intent_text: intentText,
    }]]);
    expect(mock.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("reads retained requests without requiring the original requester or current provider", async () => {
    const saved = state(); saved.request!.actorId = uuid(99);
    const mock = client(saved);
    expect((await readSynthesisGenerationRequest(mock.db, scope, signal())).state).toEqual(saved);
    expect(mock.rpc.mock.calls).toEqual([["read_engagement_synthesis_generation_request", { p_campaign: scope.campaignId, p_request: scope.requestId }]]);
  });
  it.each([false, true])("cancels with exact identity and reason, request existed %s", async exists => {
    const saved = state(exists, true), mock = client(saved);
    expect((await cancelSynthesisGenerationRequest(mock.db, cancel, signal())).state).toEqual(saved);
    expect(mock.rpc.mock.calls).toEqual([["cancel_engagement_synthesis_generation_request", {
      p_campaign: scope.campaignId, p_request: scope.requestId, p_cancellation: cancellationId, p_reason: cancel.reason,
    }]]);
  });
  it.each(["campaignId", "workspaceId"] as const)("rejects foreign %s", field => {
    const saved = state(); saved[field] = uuid(99);
    expect(() => verifySynthesisGenerationRequest(saved, scope)).toThrow("scope differs");
  });
  it("rejects empty custody", () => expect(() => verifySynthesisGenerationRequest(state(false), scope)).toThrow("scope differs"));
  it.each(["id", "intentSha256"] as const)("rejects changed request %s", field => {
    const saved = state(); saved.request![field] = field === "id" ? uuid(99) : "c".repeat(64);
    expect(() => verifySynthesisGenerationRequest(saved, scope)).toThrow("bytes differ");
  });
  it("rejects a rehashed invalid request intent", () => {
    const saved = state(); saved.request!.intentText = JSON.stringify({ ...intent, taskByteLimit: 1 });
    saved.request!.intentSha256 = hash(saved.request!.intentText);
    expect(() => verifySynthesisGenerationRequest(saved, scope)).toThrow();
  });
  it.each(["hash", "id", "requestId", "campaignId", "workspaceId", "actorId", "requestExisted"])("rejects changed cancellation %s", field => {
    const saved = state(true, true);
    if (field === "hash") saved.cancellation!.receiptSha256 = "c".repeat(64);
    else {
      const receipt = JSON.parse(saved.cancellation!.receiptText);
      receipt[field] = field === "requestExisted" ? false : uuid(99);
      saved.cancellation!.receiptText = JSON.stringify(receipt);
      saved.cancellation!.receiptSha256 = hash(saved.cancellation!.receiptText);
    }
    expect(() => verifySynthesisGenerationRequest(saved, scope)).toThrow(/cancellation (bytes differ|scope differs)/);
  });
  it.each(["actor", "intent", "replay", "missing"])("refuses an unconfirmed creation %s", async kind => {
    const saved = state();
    if (kind === "actor") saved.request!.actorId = uuid(99);
    if (kind === "intent") { saved.request!.intentText = JSON.stringify(intent); saved.request!.intentSha256 = hash(saved.request!.intentText); }
    const raw: unknown = kind === "replay" ? { ...saved, replayed: undefined } : kind === "missing" ? state(false, true) : saved;
    await expect(createSynthesisGenerationRequest(client(raw).db, create, signal())).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });
  it.each(["id", "actor", "reason", "replay", "missing"])("refuses an unconfirmed cancellation %s", async kind => {
    const saved = state(false, true);
    const receipt = JSON.parse(saved.cancellation!.receiptText);
    if (kind === "id") { receipt.id = uuid(99); saved.cancellation!.id = uuid(99); }
    if (kind === "actor") receipt.actorId = uuid(99);
    if (kind === "reason") receipt.reason = "Different reason";
    saved.cancellation!.receiptText = JSON.stringify(receipt); saved.cancellation!.receiptSha256 = hash(saved.cancellation!.receiptText);
    const raw: unknown = kind === "replay" ? { ...saved, replayed: undefined } : kind === "missing" ? state() : saved;
    await expect(cancelSynthesisGenerationRequest(client(raw).db, cancel, signal())).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });
  it.each([["42501", "forbidden", 403], ["PT409", "conflict", 409], ["23505", "conflict", 409],
    ["22023", "invalid", 400], ["22P02", "invalid", 400], ["PT503", "unavailable", 503], ["unknown", "unavailable", 503]] as const)(
    "maps native %s without exposing private diagnostics or retrying a write", async (code, kind, status) => {
      const mock = client(null, code);
      const promise = createSynthesisGenerationRequest(mock.db, create, signal());
      await expect(promise).rejects.toMatchObject({ kind, status, message: `Synthesis request ${kind}` });
      expect(mock.rpc).toHaveBeenCalledTimes(1);
    });
  it("rejects malformed native output as unavailable", async () => {
    await expect(readSynthesisGenerationRequest(client({ private: "detail" }).db, scope, signal())).rejects.toMatchObject({ kind: "unavailable" });
  });
  it.each(["before", "after"])("stops %s RPC when cancelled", async when => {
    const controller = new AbortController();
    const mock = client(state(), undefined, () => { if (when === "after") controller.abort(); });
    if (when === "before") controller.abort();
    await expect(readSynthesisGenerationRequest(mock.db, scope, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.rpc).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
  });
  it("refuses oversized UTF-8 intent before native creation and when reading retained bytes", async () => {
    // Multibyte model text plus ASCII padding exceeds the byte limit while
    // the JavaScript string length stays below 4096.
    const text = JSON.stringify({ ...intent, modelId: "界".repeat(160) }).padEnd(3900, " ");
    const mock = client(state());
    await expect(createSynthesisGenerationRequest(mock.db, { ...create, intentText: text }, signal())).rejects.toMatchObject({ kind: "invalid" });
    expect(mock.rpc).not.toHaveBeenCalled();
    const saved = state(); saved.request!.intentText = text; saved.request!.intentSha256 = hash(text);
    expect(() => verifySynthesisGenerationRequest(saved, scope)).toThrow("bytes differ");
  });
  it("rejects a successful native response after its ten-second deadline", async () => {
    const controller = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
    try {
      const mock = client(state(), undefined, () => controller.abort());
      await expect(readSynthesisGenerationRequest(mock.db, scope, signal())).rejects.toMatchObject({ name: "AbortError" });
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(mock.abortSignal.mock.calls[0][0].aborted).toBe(true);
    } finally { timeout.mockRestore(); }
  });
  it("refuses empty cancellation reasons before native writes", async () => {
    const mock = client(state());
    await expect(cancelSynthesisGenerationRequest(mock.db, { ...cancel, reason: "  " }, signal())).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
