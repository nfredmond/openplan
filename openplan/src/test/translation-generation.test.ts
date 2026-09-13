// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslationGeneration, translationGenerationPacketCanonical, type TranslationGenerationBinding, type TranslationGenerationPacket } from "@/lib/engagement/translation-generation";
import { prepareTranslationCredential } from "@/lib/integrations/translation-credentials";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const calls: Array<{ url: string; key: string | null; body: Record<string, unknown>; signal: AbortSignal | null | undefined }> = [];
let reply: Record<string, unknown>;
let responseStatus: number;
let onFetch: (() => void) | undefined;
beforeEach(() => {
  calls.length = 0; responseStatus = 200; onFetch = undefined;
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-GENERATION-SECRET-0123456789");
  vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-AMBIENT-KEY-MUST-NOT-BE-USED");
  reply = { id: "SYNTHETIC-response", type: "message", role: "assistant", model: "synthetic-reported-model",
    content: [{ type: "text", text: "  SYNTHETIC translated words.  " }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 7 } };
  // The real Anthropic and AI SDKs run against an in-process transport. This
  // test cannot send data to a provider; every fetch is intercepted and counted.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), key: new Headers(init?.headers).get("x-api-key"),
      body: JSON.parse(String(init?.body)), signal: init?.signal });
    onFetch?.();
    return new Response(JSON.stringify(reply), { status: responseStatus, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function fixture() {
  const workspaceId = randomUUID(), campaignId = randomUUID(), requestId = randomUUID(), credentialId = randomUUID(), fieldId = randomUUID();
  const packet: TranslationGenerationPacket = { schemaVersion: 1, workspaceId, campaignId, fieldId,
    sourceText: "  SYNTHETIC source words.\nKeep the final line.  ", targetLanguage: "es" };
  const packetCanonical = translationGenerationPacketCanonical(packet);
  const credential = prepareTranslationCredential({ workspaceId, requestId, credentialId, modelId: "synthetic-selected-model", source: "workspace", apiKey: "SYNTHETIC-SELECTED-KEY" });
  const binding: TranslationGenerationBinding = { workspaceId, campaignId, requestId, credentialId, fieldId,
    attemptId: randomUUID(), reservationId: randomUUID(), configurationHash: credential.configurationHash,
    packetHash: hash(packetCanonical), leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  const controller = new AbortController();
  return { args: { binding, credential, packetCanonical, signal: controller.signal }, packet, controller };
}

describe("one claimed translation generation", () => {
  it("uses the exact captured source, key and recipe through the real SDK and retains completion provenance", async () => {
    const f = fixture();
    const result = await createTranslationGeneration(f.args)();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.anthropic.com/v1/messages", key: "SYNTHETIC-SELECTED-KEY", body: { model: "synthetic-selected-model", max_tokens: 1500, temperature: 0 } });
    expect(JSON.stringify(calls[0].body)).toContain(JSON.stringify(f.packet.sourceText).slice(1, -1));
    expect(result.status).toBe("completed");
    expect(result.output).toBe("  SYNTHETIC translated words.  ");
    expect(result.receipt).toMatchObject({ ...f.args.binding, provider: "anthropic", credentialSource: "workspace", recipeVersion: 1,
      model: "synthetic-selected-model", reportedModel: "synthetic-reported-model", targetLanguage: "es", responseId: "SYNTHETIC-response",
      finishReason: "stop", inputTokens: 12, outputTokens: 7, sourceHash: hash(f.packet.sourceText), outputHash: hash(result.output) });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC-SELECTED-KEY");
    expect(JSON.stringify(result)).not.toContain(f.args.credential.credentialCiphertext);
  });
  it("does not use changed caller objects or ambient credentials after capture", async () => {
    const f = fixture();
    const original = structuredClone(f.args.binding);
    const run = createTranslationGeneration(f.args);
    f.args.binding.attemptId = randomUUID(); f.args.binding.leaseExpiresAt = "2000-01-01T00:00:00Z";
    f.args.credential.configuration.modelId = "changed-model"; f.args.credential.credentialCiphertext = "changed-ciphertext";
    f.args.packetCanonical = "changed source"; f.args.signal = AbortSignal.abort();
    vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-CHANGED-ENV");
    const result = await run();
    expect(result.receipt).toMatchObject(original);
    expect(calls[0].body.model).toBe("synthetic-selected-model");
    expect(calls[0].key).toBe("SYNTHETIC-SELECTED-KEY");
  });
  it("consumes success exactly once including a concurrent second invocation", async () => {
    const run = createTranslationGeneration(fixture().args);
    const first = run();
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
    await first;
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
    expect(calls).toHaveLength(1);
  });
  it("does not retry a provider 429 automatically or on a second invocation", async () => {
    responseStatus = 429; reply = { type: "error", error: { type: "rate_limit_error", message: "SYNTHETIC rate limit" } };
    const run = createTranslationGeneration(fixture().args);
    await expect(run()).rejects.toThrow("translation_attempt_failed");
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
    expect(calls).toHaveLength(1);
  });
  it.each(["expired", "aborted"])("consumes an %s attempt without contacting the provider", async kind => {
    const f = fixture();
    if (kind === "expired") f.args.binding.leaseExpiresAt = "2000-01-01T00:00:00Z";
    else f.controller.abort();
    const run = createTranslationGeneration(f.args);
    await expect(run()).rejects.toThrow("translation_attempt_interrupted");
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
    expect(calls).toHaveLength(0);
  });
  it("rejects an answer arriving after cancellation while preserving the consumed attempt", async () => {
    const f = fixture(); onFetch = () => f.controller.abort();
    const run = createTranslationGeneration(f.args);
    await expect(run()).rejects.toThrow("translation_attempt_interrupted");
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(true);
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
  });
  it("refuses completion after the durable lease deadline even before its timer fires", async () => {
    const f = fixture();
    onFetch = () => { vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.args.binding.leaseExpiresAt) + 1); };
    const run = createTranslationGeneration(f.args);
    await expect(run()).rejects.toThrow("translation_attempt_interrupted");
    expect(calls).toHaveLength(1);
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
  });
  it.each(["max_tokens", "tool_use", "unknown"])("retains incomplete output and usage for %s without making it publishable", async stop => {
    reply.stop_reason = stop;
    const run = createTranslationGeneration(fixture().args);
    const result = await run();
    expect(result.status).toBe("incomplete");
    expect(result.output).toBe("  SYNTHETIC translated words.  ");
    expect(result.receipt.outputTokens).toBe(7);
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
    expect(calls).toHaveLength(1);
  });
  it.each(["   ", "x".repeat(8001), "nul\0word", "unpaired\ud800"])("keeps unpublishable words as incomplete evidence", async output => {
    reply.content = [{ type: "text", text: output }];
    const result = await createTranslationGeneration(fixture().args)();
    expect(result.status).toBe("incomplete");
    expect(result.output).toBe(output);
    expect(result.receipt.outputHash).toBe(hash(output));
  });
  it("counts supplementary characters as code points without trimming output", async () => {
    const output = "😀".repeat(8000); reply.content = [{ type: "text", text: output }];
    expect((await createTranslationGeneration(fixture().args)()).status).toBe("completed");
  });
  it("preserves invalid token counts as unknown rather than zero", async () => {
    reply.usage = { input_tokens: -1, output_tokens: 0.5 };
    const result = await createTranslationGeneration(fixture().args)();
    expect(result.receipt.inputTokens).toBeNull();
    expect(result.receipt.outputTokens).toBeNull();
  });
  it("refuses missing required provider usage and consumes the uncertain dispatch", async () => {
    reply.usage = { input_tokens: null, output_tokens: null };
    const run = createTranslationGeneration(fixture().args);
    await expect(run()).rejects.toThrow("translation_attempt_failed");
    await expect(run()).rejects.toThrow("translation_attempt_already_consumed");
    expect(calls).toHaveLength(1);
  });
  it.each(["workspaceId", "campaignId", "requestId", "credentialId", "fieldId", "configurationHash", "packetHash"] as const)("refuses changed binding %s before a model call", field => {
    const f = fixture();
    f.args.binding[field] = field.endsWith("Hash") ? "0".repeat(64) : randomUUID();
    expect(() => createTranslationGeneration(f.args)).toThrow("translation_attempt_binding_invalid");
    expect(calls).toHaveLength(0);
  });
  it.each(["source", "oversize", "empty", "unavailable_language", "noncanonical", "ciphertext", "unpaired_source"])("refuses %s without spending", kind => {
    const f = fixture();
    if (kind === "source") f.args.packetCanonical = f.args.packetCanonical.replace("source words", "different words");
    if (kind === "ciphertext") f.args.credential.credentialCiphertext = "bad-ciphertext";
    if (["oversize", "empty", "unavailable_language", "unpaired_source"].includes(kind)) {
      const packet = { ...f.packet, sourceText: kind === "oversize" ? "界".repeat(11000) : kind === "empty" ? "  " : kind === "unpaired_source" ? "unpaired\ud800" : f.packet.sourceText,
        targetLanguage: kind === "unavailable_language" ? "nv" : "es" };
      f.args.packetCanonical = JSON.stringify(packet); f.args.binding.packetHash = hash(f.args.packetCanonical);
    }
    if (kind === "noncanonical") { f.args.packetCanonical += " "; f.args.binding.packetHash = hash(f.args.packetCanonical); }
    expect(() => createTranslationGeneration(f.args)).toThrow("translation_attempt_binding_invalid");
    expect(calls).toHaveLength(0);
  });
});
