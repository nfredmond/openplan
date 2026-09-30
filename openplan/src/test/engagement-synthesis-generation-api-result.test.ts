import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSynthesisGenerationApiResult, verifySynthesisGenerationApiResult } from "@/lib/engagement/synthesis-generation-api-result";
import { createSynthesisGenerationResult, type SynthesisGenerationAttemptBinding } from "@/lib/engagement/synthesis-generation-results";
import { encodeSynthesisGenerationDelivery } from "@/lib/engagement/synthesis-generation-delivery";
import type { ProviderApiResponseReceipt } from "@/lib/assistant/provider-api-transport";

const binding: SynthesisGenerationAttemptBinding = { jobId: "a0000000-0000-4000-8000-000000000001", planSha256: "a".repeat(64),
  configurationRevisionId: "a0000000-0000-4000-8000-000000000002", configurationHash: "b".repeat(64), provider: "api_connection",
  modelId: "synthetic", taskSha256: "c".repeat(64), attemptId: "a0000000-0000-4000-8000-000000000003" };
const context = { dispatchSha256: "d".repeat(64), responseByteLimit: 4096 };
const times = { startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:00:01Z" };
const text = "SYNTHETIC\n\u0000\ud800🌉\udc00";
const body = () => ({ model: binding.modelId, id: "synthetic-response", choices: [{ index: 0,
  finish_reason: "stop", message: { role: "assistant", content: text } }], usage: { prompt_tokens: 12, completion_tokens: 34 } });
function receipt(bytes = Buffer.from(JSON.stringify(body()))): ProviderApiResponseReceipt {
  return { schemaVersion: 1, statusCode: 200, contentType: "application/json", contentEncoding: null,
    bodyBase64: bytes.toString("base64"), bodySha256: createHash("sha256").update(bytes).digest("hex"),
    retainedBytes: bytes.length, bodyComplete: true, termination: "complete" };
}
function capture(raw = receipt()) {
  const result = createSynthesisGenerationApiResult(binding, { ...context, ...times, receipt: raw });
  return verifySynthesisGenerationApiResult(binding, result, context).capture;
}
describe("synthesis API response interpretation", () => {
  it("preserves exact output and reported usage with original bytes through delivery", () => {
    const raw = receipt(), result = createSynthesisGenerationApiResult(binding, { ...context, ...times, receipt: raw });
    const checked = verifySynthesisGenerationApiResult(binding, result, context);
    expect(checked.capture).toEqual({ schemaVersion: 1, binding, ...times, outcome: "returned", outputText: text,
      finishReason: "stop", responseId: "synthetic-response", inputTokens: 12, outputTokens: 34, failureCode: null,
      providerReceiptText: JSON.stringify({ schemaVersion: 1, protocol: "openai_chat_completions", dispatchSha256: context.dispatchSha256, transport: raw }) });
    const wire = encodeSynthesisGenerationDelivery(binding, result, context.responseByteLimit);
    expect(Buffer.from(wire.captureBase64, "base64").toString("utf8")).toBe(result.canonical);
  });
  it("retains malformed UTF8 and JSON without fabricated output", () => {
    for (const bytes of [Buffer.from([0xff, 0]), Buffer.from("{"), Buffer.from('"🌉"')]) {
      const value = capture(receipt(bytes));
      expect(value.outcome).toBe("failed"); expect(value.outputText).toBeNull();
      expect(value.failureCode).toBe(bytes[0] === 34 ? "api_response_identity_invalid" : "api_response_invalid");
      expect(JSON.parse(value.providerReceiptText!).transport.bodyBase64).toBe(bytes.toString("base64"));
    }
  });
  it("does not replacement-decode otherwise parseable invalid UTF8", () => {
    const bytes = Buffer.from(JSON.stringify(body())); bytes[bytes.indexOf("SYNTHETIC")] = 0xff;
    expect(capture(receipt(bytes))).toMatchObject({ outcome: "failed", failureCode: "api_response_invalid", outputText: null });
  });
  for (const reason of ["length", "content_filter", null, "", undefined]) {
    it(`retains incomplete provider output with reason ${String(reason)}`, () => {
      const value = body(); Object.assign(value.choices[0], { finish_reason: reason });
      expect(capture(receipt(Buffer.from(JSON.stringify(value))))).toMatchObject({ outcome: "returned", outputText: text,
        finishReason: reason ?? null, failureCode: null });
    });
  }
  for (const status of [307, 401, 403, 429, 500]) {
    it(`retains HTTP ${status} as failure even if its body resembles valid output`, () => {
      expect(capture({ ...receipt(), statusCode: status })).toMatchObject({ outcome: "failed", outputText: null,
        failureCode: status === 429 ? "api_rate_limited" : [401, 403].includes(status) ? "api_auth_refused" : "api_response_failed" });
    });
  }
  it("refuses content decoding assumptions", () => {
    expect(capture({ ...receipt(), contentType: "text/plain" }).failureCode).toBe("api_response_encoding_invalid");
    expect(capture({ ...receipt(), contentEncoding: "gzip" }).failureCode).toBe("api_response_encoding_invalid");
    expect(capture({ ...receipt(), contentType: "Application/JSON; charset=utf-8", contentEncoding: "identity" }).outcome).toBe("returned");
  });
  it("keeps incomplete transport distinct from complete provider output", () => {
    for (const termination of ["request_interrupted", "response_interrupted"] as const) {
      expect(capture({ ...receipt(), bodyComplete: false, termination })).toMatchObject({ outcome: "interrupted", outputText: null, failureCode: "api_response_interrupted" });
    }
    expect(capture({ ...receipt(Buffer.alloc(4096)), bodyComplete: false, termination: "response_limit" }))
      .toMatchObject({ outcome: "failed", failureCode: "api_response_too_large" });
    expect(capture({ ...receipt(Buffer.alloc(0)), statusCode: null, contentType: null, bodyComplete: false, termination: "request_failed" }))
      .toMatchObject({ outcome: "failed", failureCode: "api_request_failed" });
  });
  it.each(["missing-model", "wrong-model", "missing-id", "blank-id", "unsafe-id", "long-id", "choices", "message", "role", "content", "tools", "function", "refusal", "finish-type", "finish-length"]) (
    "retains invalid provider structure %s as failed", mode => {
      const value: Record<string, unknown> = body();
      const choice: Record<string, unknown> = body().choices[0], message: Record<string, unknown> = body().choices[0].message;
      if (mode === "missing-model") delete value.model;
      if (mode === "wrong-model") value.model = "other";
      if (mode === "missing-id") delete value.id;
      if (mode === "blank-id") value.id = "";
      if (mode === "unsafe-id") value.id = "bad\nid";
      if (mode === "long-id") value.id = "x".repeat(201);
      if (mode === "role") message.role = "user";
      if (mode === "content") message.content = null;
      if (mode === "tools") message.tool_calls = [{ function: { name: "unexpected" } }];
      if (mode === "function") message.function_call = {};
      if (mode === "refusal") message.refusal = "declined";
      choice.message = mode === "message" ? null : message;
      if (mode === "finish-type") choice.finish_reason = 4;
      if (mode === "finish-length") choice.finish_reason = "x".repeat(201);
      value.choices = mode === "choices" ? [choice, choice] : [choice];
      const raw = receipt(Buffer.from(JSON.stringify(value))), result = capture(raw);
      expect(result).toMatchObject({ outcome: "failed", outputText: null,
        failureCode: mode.includes("model") || mode.includes("id") ? "api_response_identity_invalid" : "api_response_invalid" });
      expect(JSON.parse(result.providerReceiptText!).transport).toEqual(raw);
    });
  it("allows harmless metadata without converting missing or invalid usage to zero", () => {
    const value = body(); Object.assign(value.choices[0].message, { tool_calls: [], function_call: null, refusal: null });
    for (const usage of [undefined, null, {}, { prompt_tokens: -1, completion_tokens: "34" },
      { prompt_tokens: 1.5, completion_tokens: Number.MAX_SAFE_INTEGER + 1 }]) {
      Object.assign(value, { usage, unrelated: true });
      expect(capture(receipt(Buffer.from(JSON.stringify(value))))).toMatchObject({ outcome: "returned", inputTokens: null, outputTokens: null });
    }
    Object.assign(value, { usage: { prompt_tokens: 0, completion_tokens: Number.MAX_SAFE_INTEGER } });
    expect(capture(receipt(Buffer.from(JSON.stringify(value))))).toMatchObject({ inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER });
  });
  it("rejects a different provider or dispatch, and rechecks raw receipt integrity", () => {
    const result = createSynthesisGenerationApiResult(binding, { ...context, ...times, receipt: receipt() });
    expect(() => createSynthesisGenerationApiResult({ ...binding, provider: "codex" }, { ...context, ...times, receipt: receipt() })).toThrow("different provider");
    expect(() => verifySynthesisGenerationApiResult(binding, result, { ...context, dispatchSha256: "a".repeat(64) })).toThrow("different dispatch");
    expect(() => createSynthesisGenerationApiResult(binding, { ...context, ...times, receipt: { ...receipt(), bodySha256: "a".repeat(64) } })).toThrow("checksum differ");
  });
  it("refuses a self-hashed rewrite of output, usage, outcome or receipt encoding", () => {
    const original = capture();
    for (const patch of [{ outputText: "changed" }, { inputTokens: 0 }, { responseId: "changed" },
      { finishReason: "length" }, { outcome: "failed", failureCode: "changed" }, { providerReceiptText: " " + original.providerReceiptText }]) {
      const result = createSynthesisGenerationResult(binding, { ...original, ...patch });
      expect(() => verifySynthesisGenerationApiResult(binding, result, context)).toThrow("differs from its original response");
    }
  });
});
