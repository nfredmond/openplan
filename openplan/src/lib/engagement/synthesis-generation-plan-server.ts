import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisGenerationPlan, synthesisGenerationPlanBatch, verifySynthesisGenerationPlanState } from "./synthesis-generation-plan";
import type { SynthesisSourceScope } from "./synthesis-sources-server";

/** Stage preparation through service-only native commands, outside a browser handler.
 * On an unknown acknowledgement, stop. A later invocation reconstructs the same
 * plan and resumes from its checked database cursor, without a provider call.
 */
export async function retainSynthesisGenerationPlan(
  service: Pick<SupabaseClient, "rpc">, request: unknown, saved: unknown, scope: SynthesisSourceScope, signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const plan = createSynthesisGenerationPlan(request, saved, scope);
  const call = async (name: string, args: Record<string, unknown>) => {
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(10000);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const { data, error } = await service.rpc(name, args).abortSignal(requestSignal);
    requestSignal.throwIfAborted();
    if (error) throw new Error("Synthesis plan acknowledgement unavailable; resume the same request");
    return verifySynthesisGenerationPlanState(plan, data);
  };
  let state = await call("prepare_engagement_synthesis_generation_plan", { p_request: plan.header.requestId, p_header_text: plan.headerText });
  while (!state.cancelled && !state.seal) {
    const batch = synthesisGenerationPlanBatch(plan, state.nextIndex);
    if (!batch) break;
    state = await call("stage_engagement_synthesis_generation_tasks", {
      p_request: plan.header.requestId, p_start: batch.start, p_previous_sha256: batch.previousSha256, p_tasks_text: batch.tasksText,
    });
    if (state.nextIndex < batch.nextIndex) throw new Error("Synthesis plan acknowledgement did not retain the requested batch");
  }
  if (!state.cancelled && !state.seal) state = await call("seal_engagement_synthesis_generation_plan", {
    p_request: plan.header.requestId, p_header_sha256: plan.headerSha256,
  });
  if (!state.cancelled && !state.seal) throw new Error("Synthesis plan completion receipt is missing");
  return { plan, state };
}
