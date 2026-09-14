// @vitest-environment node
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readTranslationGenerationResolution, translationGenerationResolutionIntentSchema } from "@/lib/engagement/translation-generation-resolution";
import { resolveTranslationGenerationRequest, verifyTranslationGenerationResolution } from "@/lib/engagement/translation-generation-resolution-server";

const id = (n: number) => `75000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2), actorId: id(3) };
const intent = { resolutionId: id(4), requestId: id(5), copyJson: JSON.stringify("exact\0\ud800 original bytes"), reason: "Resolve the retained request" };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function body() {
  return { payload: { schema: 1, ...scope, ...intent }, result: { schema: 1, ...scope, resolutionId: intent.resolutionId, requestId: intent.requestId,
    requestExisted: true, resolvedAt: "2026-09-13T12:00:00.000Z", fields: [{ fieldId: id(6), previousState: "running", state: "interrupted", attemptId: id(7) as string | null, outputRetained: false }] } };
}
function packet(value = body()) {
  const payloadText = JSON.stringify(value.payload), resultText = JSON.stringify(value.result);
  return { payloadText, payloadSha256: hash(payloadText), resultText, resultSha256: hash(resultText), replayed: false };
}
function client(data: unknown = packet(), error: { code: string } | null = null) {
  const rpc = vi.fn(() => ({ abortSignal: vi.fn(async () => ({ data, error })) }));
  return { rpc, value: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}

describe("generation resolution receipt binding", () => {
  it("checks server bytes and keeps opaque damaged strings unchanged", () => {
    const result = verifyTranslationGenerationResolution(packet(), scope, intent);
    expect(result.payload.copyJson).toBe(intent.copyJson);
    expect(result.result.fields[0]).toMatchObject({ previousState: "running", state: "interrupted", outputRetained: false });
  });
  it.each(["payloadSha256", "resultSha256"] as const)("rejects a mismatched %s before acknowledgement", key => {
    expect(() => verifyTranslationGenerationResolution({ ...packet(), [key]: "a".repeat(64) }, scope, intent)).toThrow("checksum differs");
  });
  it.each(["actorId", "workspaceId", "campaignId", "resolutionId", "requestId", "copyJson", "reason"] as const)("rejects a different payload %s even with valid digests", key => {
    const value = body(); value.payload[key] = key === "copyJson" ? JSON.stringify("changed bytes") : key === "reason" ? "changed reason" : id(99);
    expect(() => verifyTranslationGenerationResolution(packet(value), scope, intent)).toThrow("differs from the retained request");
  });
  it.each(["actorId", "workspaceId", "campaignId", "resolutionId", "requestId"] as const)("rejects a different result %s even with valid digests", key => {
    const value = body(); value.result[key] = id(99);
    expect(() => verifyTranslationGenerationResolution(packet(value), scope, intent)).toThrow("differs from the retained request");
  });
  it.each(["missing_fields", "duplicate_fields", "revived_running", "lost_output", "lost_attempt", "queued_attempt"])("rejects incoherent outcome %s", kind => {
    const value = body(), field = value.result.fields[0];
    if (kind === "missing_fields") value.result.fields = [];
    if (kind === "duplicate_fields") value.result.fields.push({ ...field });
    if (kind === "revived_running") field.state = "completed";
    if (kind === "lost_output") Object.assign(field, { previousState: "completed", state: "completed" });
    if (kind === "lost_attempt") field.attemptId = null;
    if (kind === "queued_attempt") Object.assign(field, { previousState: "queued", state: "cancelled" });
    expect(() => readTranslationGenerationResolution(packet(value), scope, intent)).toThrow();
  });
  it.each(["null", "{}", '"bad\\q"', ' "noncanonical"'])("refuses unsafe copy encoding %s", copyJson => {
    expect(translationGenerationResolutionIntentSchema.safeParse({ ...intent, copyJson }).success).toBe(false);
  });
  it.each(["", "  ", "reason\0", "reason\ud800"])("refuses an invalid reason %j", reason => {
    expect(translationGenerationResolutionIntentSchema.safeParse({ ...intent, reason }).success).toBe(false);
  });
});
describe("generation resolution server", () => {
  it("sends the exact resolution using the authenticated RPC and confirms its receipt", async () => {
    const f = client();
    expect(await resolveTranslationGenerationRequest(f.value, scope, intent)).toEqual(packet());
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("resolve_translation_generation_request", { p_resolution: intent.resolutionId, p_request: intent.requestId,
      p_campaign: scope.campaignId, p_copy_json: intent.copyJson, p_reason: intent.reason });
    expect(f.rpc.mock.results[0].value.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("refuses an invalid scope before any write", async () => {
    const f = client();
    await expect(resolveTranslationGenerationRequest(f.value, { ...scope, actorId: "invalid" }, intent)).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("refuses an invalid intent before any write", async () => {
    const f = client();
    await expect(resolveTranslationGenerationRequest(f.value, scope, { ...intent, reason: "" })).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "forbidden", 403], ["PT409", "conflict", 409], ["23505", "conflict", 409], ["22023", "invalid", 400], ["22P02", "invalid", 400], ["PT503", "unavailable", 503]] as const)("preserves refusal %s", async (code, kind, status) => {
    const f = client(null, { code });
    await expect(resolveTranslationGenerationRequest(f.value, scope, intent)).rejects.toMatchObject({ kind, status });
  });
  it("does not acknowledge unchecked database output", async () => {
    const f = client({ ...packet(), resultSha256: "b".repeat(64) });
    await expect(resolveTranslationGenerationRequest(f.value, scope, intent)).rejects.toThrow("checksum differs");
  });
});
