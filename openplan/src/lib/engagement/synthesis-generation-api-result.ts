import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { verifyProviderApiResponseReceipt } from "@/lib/assistant/provider-api-response-receipt";
import { createSynthesisGenerationResult, verifySynthesisGenerationResult,
  type SynthesisGenerationAttemptBinding, type SynthesisGenerationCapture } from "./synthesis-generation-results";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const token = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const envelopeSchema = z.object({ schemaVersion: z.literal(1), protocol: z.literal("openai_chat_completions"),
  dispatchSha256: hash, transport: z.unknown(),
}).strict();
type Context = { dispatchSha256: string; responseByteLimit: number };

/** Preserve transport custody even when a response cannot supply usable output.
 * Segment coverage and quotations are assessed separately against the source.
 * Reported token counts are not measured billing; absent or invalid counts stay null.
 */
export function createSynthesisGenerationApiResult(binding: SynthesisGenerationAttemptBinding,
  args: Context & { receipt: unknown; startedAt: string; finishedAt: string },
) {
  if (binding.provider !== "api_connection") throw new Error("Synthesis API result has a different provider");
  const dispatchSha256 = hash.parse(args.dispatchSha256);
  const { receipt, bytes } = verifyProviderApiResponseReceipt(args.receipt, args.responseByteLimit);
  const capture: SynthesisGenerationCapture = { schemaVersion: 1, binding,
    startedAt: args.startedAt, finishedAt: args.finishedAt, outcome: "failed",
    providerReceiptText: JSON.stringify({ schemaVersion: 1, protocol: "openai_chat_completions", dispatchSha256, transport: receipt }),
    outputText: null, finishReason: null, responseId: null, inputTokens: null, outputTokens: null, failureCode: null };
  const failed = (code: string, interrupted = false) => {
    capture.failureCode = code; capture.outcome = interrupted ? "interrupted" : "failed";
    return createSynthesisGenerationResult(binding, capture);
  };
  if (!receipt.bodyComplete) return failed(receipt.termination === "response_limit" ? "api_response_too_large" :
    receipt.termination === "request_failed" ? "api_request_failed" : "api_response_interrupted",
    receipt.termination === "request_interrupted" || receipt.termination === "response_interrupted");
  if (receipt.statusCode !== 200) return failed(receipt.statusCode === 429 ? "api_rate_limited" :
    [401, 403].includes(receipt.statusCode ?? 0) ? "api_auth_refused" : "api_response_failed");
  if (!/^application\/json(?:\s*;|$)/i.test(receipt.contentType ?? "") ||
    ![null, "identity"].includes(receipt.contentEncoding)) return failed("api_response_encoding_invalid");
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return failed("api_response_invalid"); }
  if (!record(body) || body.model !== binding.modelId || typeof body.id !== "string" || body.id.length === 0 ||
    body.id.length > 200 || /[\s\u0000-\u001f\u007f]/.test(body.id)) return failed("api_response_identity_invalid");
  if (!Array.isArray(body.choices) || body.choices.length !== 1 || !record(body.choices[0])) return failed("api_response_invalid");
  const choice = body.choices[0], message = choice.message;
  if (!record(message) || message.role !== "assistant" || typeof message.content !== "string" ||
    (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 0)) ||
    message.function_call != null || message.refusal != null ||
    (choice.finish_reason != null && (typeof choice.finish_reason !== "string" || choice.finish_reason.length > 200))) {
    return failed("api_response_invalid");
  }
  capture.outcome = "returned"; capture.outputText = message.content; capture.responseId = body.id;
  capture.finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;
  if (record(body.usage)) {
    capture.inputTokens = token(body.usage.prompt_tokens); capture.outputTokens = token(body.usage.completion_tokens);
  }
  return createSynthesisGenerationResult(binding, capture);
}

/** Reinterpret original bytes when loading a saved capture. A self-hashed
 * rewritten outcome, usage value or output is not an acceptable original.
 */
export function verifySynthesisGenerationApiResult(binding: SynthesisGenerationAttemptBinding, result: unknown, context: Context) {
  const verified = verifySynthesisGenerationResult(binding, result);
  const envelope = envelopeSchema.parse(JSON.parse(verified.capture.providerReceiptText ?? ""));
  if (envelope.dispatchSha256 !== context.dispatchSha256) throw new Error("Synthesis API receipt names a different dispatch");
  const expected = createSynthesisGenerationApiResult(binding, { ...context, receipt: envelope.transport,
    startedAt: verified.capture.startedAt, finishedAt: verified.capture.finishedAt });
  if (!isDeepStrictEqual(expected, { canonical: verified.canonical, sha256: verified.sha256 })) {
    throw new Error("Synthesis API capture differs from its original response");
  }
  return verified;
}
