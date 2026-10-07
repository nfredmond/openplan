import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSynthesisGenerationRequest, SynthesisGenerationRequestError } from "./synthesis-generation-requests-server";
import { parseSynthesisExecutionReceipt, synthesisExecutionCommandSchema, synthesisExecutionScopeSchema } from "./synthesis-execution-records";

type Client = Pick<SupabaseClient, "rpc">;
const commandSchema = synthesisExecutionScopeSchema.extend(synthesisExecutionCommandSchema.shape).strict();
const rpcNames = { segment: "authorize_engagement_synthesis_generation", context: "authorize_engagement_synthesis_context",
  thematic: "authorize_engagement_synthesis_thematic" } as const;
const unavailable = () => new SynthesisGenerationRequestError("unavailable", 503);

/** Retain an exact staff grant using the authenticated native operation. Read
 * the original request before and after the write, since the authorization RPC
 * takes no campaign argument. No service client, provider call or retry is used.
 * Current expiry, cancellation and provider checks belong to native new grants;
 * an old receipt must remain recoverable after those conditions change.
 */
export async function authorizeSynthesisExecution(client: Client, raw: z.infer<typeof commandSchema>, signal: AbortSignal) {
  signal.throwIfAborted();
  const args = commandSchema.parse(raw);
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const command = { authorizationId: args.authorizationId, intentText: args.intentText };
  const digest = createHash("sha256").update(args.intentText, "utf8").digest("hex");
  // Reuse the same parser before transport, without normalizing original bytes.
  try {
    parseSynthesisExecutionReceipt({ schemaVersion: 1, id: args.authorizationId, requestId: args.requestId,
      intentText: args.intentText, intentSha256: digest }, command, args.requestId);
  } catch { throw new SynthesisGenerationRequestError("invalid", 400); }
  async function currentRequest() {
    const result = await readSynthesisGenerationRequest(client, scope, signal);
    if (!result.state.request || result.state.request.actorId !== args.actorId) throw new SynthesisGenerationRequestError("forbidden", 403);
    if (result.state.request.intentSha256 !== args.requestIntentSha256 || result.intent?.sourceId !== args.sourceId ||
      result.intent.sourceSha256 !== args.sourceSha256) throw new SynthesisGenerationRequestError("conflict", 409);
    return result;
  }
  await currentRequest();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  bounded.throwIfAborted();
  const response = await client.rpc(rpcNames[args.stage], { p_request: args.requestId,
    p_authorization: args.authorizationId, p_intent_text: args.intentText }).abortSignal(bounded);
  bounded.throwIfAborted();
  if (response.error) {
    const code = response.error.code;
    if (code === "42501") throw new SynthesisGenerationRequestError("forbidden", 403);
    if (["PT409", "23505", "0A000"].includes(code)) throw new SynthesisGenerationRequestError("conflict", 409);
    if (["22023", "22P02"].includes(code)) throw new SynthesisGenerationRequestError("invalid", 400);
    throw unavailable();
  }
  let verified;
  try {
    verified = parseSynthesisExecutionReceipt(response.data, command, args.requestId);
    if (verified.receipt.intentSha256 !== digest) throw unavailable();
  } catch { throw unavailable(); }
  await currentRequest();
  signal.throwIfAborted();
  return verified.receipt;
}
