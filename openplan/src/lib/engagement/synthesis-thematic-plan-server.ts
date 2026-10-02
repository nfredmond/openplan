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
