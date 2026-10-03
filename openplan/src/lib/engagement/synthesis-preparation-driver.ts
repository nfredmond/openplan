import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSynthesisPreparationInputs } from "./synthesis-preparation-inputs";
import { renewSynthesisPreparation, type SynthesisPreparationLease, type SynthesisPreparationOutcome } from "./synthesis-preparation-worker";
import { retainSynthesisGenerationPlan } from "./synthesis-generation-plan-server";
import { retainSynthesisContextPlan } from "./synthesis-context-plan-server";
import { readSynthesisContextParentResults } from "./synthesis-generation-selected-results-server";
import { createSynthesisGenerationInput } from "./synthesis-generation-input";
import { createSynthesisGenerationRecords } from "./synthesis-generation-records";
import { createSynthesisGenerationContext } from "./synthesis-generation-context";
import { createSynthesisThematicInputPreparer } from "./synthesis-thematic-inputs-server";
import { retainSynthesisThematicInputSeal } from "./synthesis-thematic-input-seal-server";
import { retainSynthesisThematicPlan } from "./synthesis-thematic-plan-server";

/** Prepare the original requested stage under the worker's current lease. Every
 * stage uses its existing deterministic reconstruction and native retention path.
 * Unknown reads/writes throw and remain recoverable; they do not become a fake
 * failure receipt. This function never creates provider authorization or output.
 */
export async function prepareSynthesisStage(service: Pick<SupabaseClient, "from" | "rpc">,
  lease: SynthesisPreparationLease, signal: AbortSignal,
): Promise<SynthesisPreparationOutcome> {
  const inputs = await loadSynthesisPreparationInputs(service, lease, signal);
  let state: { cancelled: boolean; seal: { receiptSha256: string } | null };
  if (inputs.stage === "segment") {
    const { id, intentText, intentSha256 } = inputs.request;
    state = (await retainSynthesisGenerationPlan(service, { id, intentText, intentSha256 }, inputs.saved, inputs.sourceScope, signal)).state;
  } else if (inputs.stage === "context") {
    const { context, parent, saved, sourceScope } = inputs;
    const { id, intentText, intentSha256, actorId } = parent.state.request;
    const results = await readSynthesisContextParentResults(service, lease.requestId,
      { request: { id, intentText, intentSha256 }, actorId, saved, scope: sourceScope, throughSequence: context.binding.selectionSequence }, signal);
    const input = createSynthesisGenerationInput(saved, sourceScope), records = createSynthesisGenerationRecords(input, saved, sourceScope);
    const plan = results.selections.plan.taskPlan;
    const reconstruction = { job: results.inventory.job, selections: results.selections.selections, results: results.inventory.results,
      input, records, saved, scope: sourceScope, plan, taskByteLimit: plan.taskByteLimit };
    const dependencies = createSynthesisGenerationContext(results.inventory, reconstruction, context.binding.selectionSequence);
    state = (await retainSynthesisContextPlan(service, [context.state, inputs.scope, [dependencies, results.inventory, reconstruction,
      context.binding.selectionSequence, context.binding.targetRecordId, context.binding.frameByteLimit]], signal)).state;
  } else {
    const prepare = createSynthesisThematicInputPreparer(service, inputs.scope);
    const targets = [...inputs.source.snapshot.items.map(item => `item:${item.id}`), ...inputs.source.snapshot.answers.map(answer => `answer:${answer.id}`)].sort();
    for (const target of targets) { signal.throwIfAborted(); await prepare(target, signal); }
    await retainSynthesisThematicInputSeal(service, inputs.scope, signal);
    state = (await retainSynthesisThematicPlan(service, inputs.scope, signal)).state;
  }
  signal.throwIfAborted();
  if (state.cancelled || !state.seal) throw new Error("Preparation stage has no current completion seal");
  await renewSynthesisPreparation(service, lease, signal);
  return { sealSha256: state.seal.receiptSha256 };
}
