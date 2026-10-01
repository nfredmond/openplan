import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisContextStagingPlan, synthesisContextFrameBatch, verifySynthesisContextPlanState } from "./synthesis-context-plan";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

/** Rebuild verified context inputs on every invocation. Unknown acknowledgements
 * stop the invocation; an exact later retry checks the saved prefix and seal.
 * This retains preparation only and cannot dispatch a provider request.
 */
export async function retainSynthesisContextPlan(service: Pick<SupabaseClient, "rpc">,
  args: Parameters<typeof createSynthesisContextStagingPlan>, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const plan = createSynthesisContextStagingPlan(...args);
  const call = async (name: string, parameters: Record<string, unknown>) => {
    signal.throwIfAborted();
    const { data, error } = await service.rpc(name, parameters).abortSignal(synthesisWorkerRequestSignal(signal));
    if (error) throw new Error("Context plan acknowledgement unavailable; resume the same request");
    signal.throwIfAborted();
    return verifySynthesisContextPlanState(plan, data);
  };
  let state = await call("prepare_engagement_synthesis_context_plan", { p_request: plan.header.requestId, p_header_text: plan.headerText });
  while (!state.cancelled && !state.seal) {
    const batch = synthesisContextFrameBatch(plan, state.nextIndex);
    if (!batch) break;
    state = await call("stage_engagement_synthesis_context_frames", { p_request: plan.header.requestId,
      p_start: batch.start, p_previous_sha256: batch.previousSha256, p_frames_text: batch.framesText });
    if (state.nextIndex < batch.nextIndex) throw new Error("Context frame acknowledgement did not retain the requested batch");
  }
  if (!state.cancelled && !state.seal) state = await call("seal_engagement_synthesis_context_plan", {
    p_request: plan.header.requestId, p_header_sha256: plan.headerSha256 });
  if (!state.cancelled && !state.seal) throw new Error("Context plan completion receipt is missing");
  return { plan, state };
}
