import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSynthesisExecutionQueueCommand, verifySynthesisExecutionQueueReceipt } from "./synthesis-execution-queue-records";
import { SynthesisGenerationRequestError } from "./synthesis-generation-requests-server";

/** Forward unchanged staff bytes using the authenticated client. Native locks
 * check current authority; this helper neither uses service credentials nor
 * dispatches a provider call. An uncertain reply leaves the caller's command
 * available for exact replay, including after the original permission expires.
 */
export async function enqueueSynthesisExecution(client: Pick<SupabaseClient, "rpc">, args: {
  commandText: string; campaignId: string; workspaceId: string; actorId: string;
}, signal: AbortSignal) {
  signal.throwIfAborted();
  let parsed: ReturnType<typeof parseSynthesisExecutionQueueCommand>;
  try { parsed = parseSynthesisExecutionQueueCommand(args.commandText); }
  catch { throw new SynthesisGenerationRequestError("invalid", 400); }
  const { command, commandText } = parsed;
  if (command.campaignId !== args.campaignId || command.workspaceId !== args.workspaceId || command.actorId !== args.actorId) {
    throw new SynthesisGenerationRequestError("forbidden", 403);
  }
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await client.rpc("enqueue_engagement_synthesis_execution", { p_command_text: commandText }).abortSignal(bounded);
  bounded.throwIfAborted();
  if (response.error) {
    const code = response.error.code;
    if (code === "42501") throw new SynthesisGenerationRequestError("forbidden", 403);
    if (["PT409", "23505"].includes(code)) throw new SynthesisGenerationRequestError("conflict", 409);
    if (["22023", "22P02"].includes(code)) throw new SynthesisGenerationRequestError("invalid", 400);
    throw new SynthesisGenerationRequestError("unavailable", 503);
  }
  let verified;
  try { verified = await verifySynthesisExecutionQueueReceipt(response.data, commandText); }
  catch { throw new SynthesisGenerationRequestError("unavailable", 503); }
  bounded.throwIfAborted();
  return verified.receipt;
}
