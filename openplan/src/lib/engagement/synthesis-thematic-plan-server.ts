import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { createSynthesisThematicStagingPlan, synthesisThematicFrameBatch, verifySynthesisThematicStagingState, synthesisThematicStagingStateSchema } from "./synthesis-thematic-staging";
import { loadSynthesisThematicProposalInputs } from "./synthesis-thematic-proposal-inputs-server";
import { createSynthesisThematicPlan } from "./synthesis-thematic-continuation";

/** Reconstruct native originals before deterministic task planning. This read
 * retains no task plan and grants no provider dispatch or spending permission.
 */
export async function loadSynthesisThematicPlan(...args: Parameters<typeof loadSynthesisThematicProposalInputs>) {
  const prepared = await loadSynthesisThematicProposalInputs(...args);
  args[2].throwIfAborted();
  return createSynthesisThematicPlan(prepared);
}

/** Reconstruct originals on each resume, then compare every acknowledgement
 * with the expected prefix. Unconfirmed writes stop this invocation; retrying
 * the same request recovers the exact native cursor without replacing frames.
 */
export async function retainSynthesisThematicPlan(...args: Parameters<typeof loadSynthesisThematicProposalInputs>) {
  const [service, , signal] = args;
  const plan = createSynthesisThematicStagingPlan(await loadSynthesisThematicPlan(...args));
  async function call(name: string, parameters: Record<string, unknown>) {
    signal.throwIfAborted();
    const { data, error } = await service.rpc(name, parameters).abortSignal(synthesisWorkerRequestSignal(signal));
    if (error) throw new Error("Thematic plan acknowledgement unavailable; resume the same request");
    signal.throwIfAborted(); return verifySynthesisThematicStagingState(plan, data);
  }
  let state = await call("prepare_engagement_synthesis_thematic_plan", { p_request: plan.header.requestId, p_header_text: plan.headerText });
  while (!state.cancelled && !state.seal) {
    const batch = synthesisThematicFrameBatch(plan, state.nextIndex); if (!batch) break;
    state = await call("stage_engagement_synthesis_thematic_frames", { p_request: plan.header.requestId,
      p_start: batch.start, p_previous_sha256: batch.previousSha256, p_frames_text: batch.framesText });
    if (state.nextIndex < batch.nextIndex) throw new Error("Thematic frame acknowledgement did not retain the requested batch");
  }
  if (!state.cancelled && !state.seal) state = await call("seal_engagement_synthesis_thematic_plan", { p_request: plan.header.requestId, p_header_sha256: plan.headerSha256 });
  if (!state.cancelled && !state.seal) throw new Error("Thematic plan completion receipt is missing");
  return { plan, state };
}

/** Inspect native custody, including a cancelled request, without reconstructing
 * or authorizing fresh work. A worker must separately replay and verify originals.
 */
export async function readSynthesisThematicPlanState(...args: Parameters<typeof loadSynthesisThematicProposalInputs>) {
  const [service, scope, signal] = args; signal.throwIfAborted();
  const { data, error } = await service.rpc("read_engagement_synthesis_thematic_plan", { p_request: scope.requestId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  if (error) throw new Error("Thematic plan custody unavailable");
  signal.throwIfAborted(); const state = synthesisThematicStagingStateSchema.parse(data);
  if (state.requestId !== scope.requestId || state.campaignId !== scope.campaignId || state.workspaceId !== scope.workspaceId) throw new Error("Thematic plan custody scope differs");
  return state;
}
