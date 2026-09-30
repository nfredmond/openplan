import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisGenerationResult, type SynthesisGenerationAttemptBinding } from "./synthesis-generation-results";

const responseLimit = z.number().int().min(4096).max(4194304);
const acknowledgement = z.object({
  schemaVersion: z.literal(1), attemptId: z.string().uuid(), captureText: z.string(),
  captureSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Canonical JSON escapes preserve every JavaScript string, including unpaired
 * surrogates and NUL. Encode those exact UTF8 bytes so PostgreSQL never needs to
 * interpret provider strings as its more restrictive JSON value type.
 */
export function encodeSynthesisGenerationDelivery(binding: SynthesisGenerationAttemptBinding, result: unknown, responseByteLimit: number) {
  const limit = responseLimit.parse(responseByteLimit);
  const verified = verifySynthesisGenerationResult(binding, result);
  if (Buffer.byteLength(verified.canonical, "utf8") > limit * 8 + 65536) {
    throw new Error("Synthesis capture exceeds its authorized delivery bound");
  }
  return { captureBase64: Buffer.from(verified.canonical, "utf8").toString("base64"), captureSha256: verified.sha256 };
}

/** Native storage proves byte custody. Recheck capture structure and binding in
 * this layer, including when a saved output is loaded after an interruption.
 */
export function verifySynthesisGenerationOutputAcknowledgement(binding: SynthesisGenerationAttemptBinding, result: unknown, raw: unknown) {
  const original = verifySynthesisGenerationResult(binding, result);
  const ack = acknowledgement.parse(raw);
  if (ack.attemptId !== binding.attemptId || ack.captureText !== original.canonical || ack.captureSha256 !== original.sha256) {
    throw new Error("Synthesis output acknowledgement differs from the original capture");
  }
  return verifySynthesisGenerationResult(binding, { canonical: ack.captureText, sha256: ack.captureSha256 });
}

/** A lost acknowledgement stops delivery. Retry these same capture bytes; this
 * command never creates an authorization, claims a task or invokes a provider.
 */
export async function retainSynthesisGenerationOutput(service: Pick<SupabaseClient, "rpc">, args: {
  binding: SynthesisGenerationAttemptBinding; result: unknown; workerId: string; responseByteLimit: number;
}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const worker = z.string().uuid().parse(args.workerId);
  const wire = encodeSynthesisGenerationDelivery(args.binding, args.result, args.responseByteLimit);
  const { data, error } = await service.rpc("retain_engagement_synthesis_generation_output", {
    p_attempt: args.binding.attemptId, p_worker: worker, p_capture_base64: wire.captureBase64, p_capture_sha256: wire.captureSha256,
  }).abortSignal(AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]));
  if (error) throw new Error("Synthesis output acknowledgement unavailable; retain and retry the same capture");
  return verifySynthesisGenerationOutputAcknowledgement(args.binding, args.result, data);
}
