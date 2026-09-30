import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSynthesisGenerationResult, type SynthesisGenerationAttemptBinding } from "@/lib/engagement/synthesis-generation-results";
import { encodeSynthesisGenerationDelivery, retainSynthesisGenerationOutput, verifySynthesisGenerationOutputAcknowledgement } from "@/lib/engagement/synthesis-generation-delivery";

const binding: SynthesisGenerationAttemptBinding = {
  jobId: "a0000000-0000-4000-8000-000000000001", planSha256: "a".repeat(64),
  configurationRevisionId: "a0000000-0000-4000-8000-000000000002", configurationHash: "b".repeat(64),
  provider: "api_connection", modelId: "synthetic", taskSha256: "c".repeat(64), attemptId: "a0000000-0000-4000-8000-000000000003",
};
const workerId = "a0000000-0000-4000-8000-000000000004";
function result(outputText = "SYNTHETIC é 😀\u0000\ud800\udc00\ud800") {
  return createSynthesisGenerationResult(binding, { schemaVersion: 1, binding,
    startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:01:00Z", outcome: "returned",
    outputText, providerReceiptText: "SYNTHETIC original\n\u0000\udc00", finishReason: "length", responseId: null,
    inputTokens: null, outputTokens: null, failureCode: null,
  });
}
function ack(value = result()) {
  return { schemaVersion: 1, attemptId: binding.attemptId, captureText: value.canonical, captureSha256: value.sha256 };
}
function service(response: { data: unknown; error: unknown }) {
  const abortSignal = vi.fn().mockReturnThis();
  const rpc = vi.fn().mockImplementation(() => Object.assign(Promise.resolve(response), { abortSignal }));
  return { value: { rpc } as unknown as Pick<SupabaseClient, "rpc">, rpc, abortSignal };
}
describe("synthesis capture delivery", () => {
  it("retains exact canonical bytes, including NUL and unpaired surrogates", () => {
    const original = result(), wire = encodeSynthesisGenerationDelivery(binding, original, 8192);
    expect(Buffer.from(wire.captureBase64, "base64").toString("utf8")).toBe(original.canonical);
    expect(wire.captureSha256).toBe(original.sha256);
    const verified = verifySynthesisGenerationOutputAcknowledgement(binding, original, ack(original));
    expect(verified.capture.outputText).toBe(JSON.parse(original.canonical).outputText);
    expect(verified.capture.providerReceiptText).toBe("SYNTHETIC original\n\u0000\udc00");
    expect(verified.capture.inputTokens).toBeNull();
    expect(verified.capture.finishReason).toBe("length");
  });
  it("refuses changed binding, noncanonical text and wrong checksum before encoding", () => {
    expect(() => encodeSynthesisGenerationDelivery({ ...binding, taskSha256: "d".repeat(64) }, result(), 8192)).toThrow();
    expect(() => encodeSynthesisGenerationDelivery(binding, { ...result(), canonical: " " + result().canonical }, 8192)).toThrow();
    expect(() => encodeSynthesisGenerationDelivery(binding, { ...result(), sha256: "d".repeat(64) }, 8192)).toThrow();
  });
  it("enforces declared resource bounds without clipping the original", () => {
    for (const limit of [4095, 4194305, 8192.5]) expect(() => encodeSynthesisGenerationDelivery(binding, result(), limit)).toThrow();
    const large = result("é".repeat(100000));
    expect(() => encodeSynthesisGenerationDelivery(binding, large, 8192)).toThrow("authorized delivery bound");
    expect(Buffer.from(encodeSynthesisGenerationDelivery(binding, large, 65536).captureBase64, "base64").toString("utf8")).toBe(large.canonical);
  });
  it.each([
    { schemaVersion: 2 }, { attemptId: workerId }, { captureText: "changed" }, { captureSha256: "d".repeat(64) }, { extra: true },
  ])("refuses changed acknowledgement %j", patch => {
    expect(() => verifySynthesisGenerationOutputAcknowledgement(binding, result(), { ...ack(), ...patch })).toThrow();
  });
  it("refuses a different valid capture with its matching checksum", () => {
    const different = result("SYNTHETIC different valid output");
    expect(() => verifySynthesisGenerationOutputAcknowledgement(binding, result(), ack(different))).toThrow("acknowledgement differs");
  });
  it("uses only the output command and verifies the native receipt", async () => {
    const db = service({ data: ack(), error: null }), original = result();
    const retained = await retainSynthesisGenerationOutput(db.value, { binding, result: original, workerId, responseByteLimit: 8192 });
    expect(retained.canonical).toBe(original.canonical);
    expect(db.rpc.mock.calls).toEqual([["retain_engagement_synthesis_generation_output", {
      p_attempt: binding.attemptId, p_worker: workerId, p_capture_base64: Buffer.from(original.canonical, "utf8").toString("base64"), p_capture_sha256: original.sha256,
    }]]);
    expect(db.abortSignal).toHaveBeenCalledOnce();
    expect(db.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it("retains bytes after an unknown acknowledgement and redelivers the same capture", async () => {
    const lost = service({ data: ack(), error: { code: "SYNTHETIC", message: "private database detail" } });
    const args = { binding, result: result(), workerId, responseByteLimit: 8192 };
    await expect(retainSynthesisGenerationOutput(lost.value, args)).rejects.toThrow("retain and retry the same capture");
    const resumed = service({ data: ack(), error: null });
    await retainSynthesisGenerationOutput(resumed.value, args);
    expect(resumed.rpc.mock.calls).toEqual(lost.rpc.mock.calls);
  });
  it("does not deliver for an aborted call or invalid worker", async () => {
    const db = service({ data: ack(), error: null }), args = { binding, result: result(), workerId, responseByteLimit: 8192 };
    await expect(retainSynthesisGenerationOutput(db.value, args, AbortSignal.abort())).rejects.toThrow();
    await expect(retainSynthesisGenerationOutput(db.value, { ...args, workerId: "wrong" })).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("checks receipt integrity after the real delivery path returns", async () => {
    const db = service({ data: { ...ack(), captureText: "changed" }, error: null });
    await expect(retainSynthesisGenerationOutput(db.value, { binding, result: result(), workerId, responseByteLimit: 8192 })).rejects.toThrow("acknowledgement differs");
  });
});
