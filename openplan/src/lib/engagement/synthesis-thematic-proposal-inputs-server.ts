import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisThematicInputInventory } from "./synthesis-thematic-input-seal-server";
import { createSynthesisThematicInputManifest, verifySynthesisThematicInputSeal } from "./synthesis-thematic-input-manifest";
import { createSynthesisThematicPreparationReader } from "./synthesis-thematic-preparation-server";
import { readSynthesisThematicInput, verifySynthesisThematicReplayedInput } from "./synthesis-thematic-inputs-server";
import type { SynthesisThematicProposalInput } from "./synthesis-thematic-proposal";

const id = z.string().uuid();
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
// Full context validation belongs to replay. This projection preserves exact
// note text and uncertainty for proposal checking; raw output remains alongside.
const contextOutputSchema = z.object({ notes: z.array(z.object({ id: z.number().int().nonnegative().safe(), text: z.string() })),
  uncertainties: z.array(z.string()) });
type Service = Pick<SupabaseClient, "rpc" | "from">;
const differs = (): never => { throw new Error("Thematic proposal inputs differ from sealed originals"); };

/** Reconstruct the complete sealed source before thematic task preparation.
 * Metadata cannot stand in for original history: every chosen context is replayed
 * and compared with its retained input. This read performs no write or provider
 * call and grants no execution permission. It remains an in-memory collection;
 * the subsequent task planner must retain bounded, resumable work separately.
 */
export async function loadSynthesisThematicProposalInputs(service: Service, rawScope: z.infer<typeof scopeSchema>, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  async function inventory() {
    const value = await loadSynthesisThematicInputInventory(service, scope, signal);
    if (value.request.state.cancellation !== null) throw new Error("Thematic proposal preparation was cancelled");
    if (value.seal === null) throw new Error("Thematic proposal requires sealed complete-source input custody");
    const { snapshot: _snapshot, definitions: _definitions, ...saved } = value.source;
    const plan = createSynthesisThematicInputManifest(value.request.state, scope, saved, value.entries);
    return { value, saved, plan, seal: verifySynthesisThematicInputSeal(value.seal, plan) };
  }
  const first = await inventory(), read = createSynthesisThematicPreparationReader(service, scope);
  const contexts: SynthesisThematicProposalInput["contexts"] = [];
  const originals: Array<{ targetRecordId: string; proofText: string; outputText: string }> = [];
  for (const { metadata } of first.plan.entries) {
    signal.throwIfAborted(); const targetScope = { ...scope, targetRecordId: metadata.targetRecordId };
    const stored = await readSynthesisThematicInput(service, targetScope, signal);
    if (stored === null) throw new Error("Sealed thematic input custody is missing");
    if (stored.record.proofText !== metadata.proofText
      || Buffer.byteLength(stored.record.outputText, "utf8") !== metadata.outputBytes) differs();
    const prepared = await read(metadata.targetRecordId, signal);
    if (!isDeepStrictEqual(prepared.delegation.thematic.state.request, first.value.request.state.request)
      || !isDeepStrictEqual(prepared.delegation.thematic.state.thematic, first.value.request.state.thematic)
      || prepared.source.createdAt !== first.saved.createdAt) differs();
    const retained = verifySynthesisThematicReplayedInput(stored.record, targetScope, prepared);
    const output = contextOutputSchema.parse(JSON.parse(retained.record.outputText));
    contexts.push({ sourceId: metadata.targetRecordId, contextRequestId: retained.proof.contextRequestId,
      selectionSequence: prepared.delegation.choice.choice.selectionSequence, historyManifestSha256: retained.proof.historyManifestSha256,
      finalCaptureSha256: retained.proof.finalCaptureSha256, finalResultSha256: retained.proof.finalResultSha256,
      notes: output.notes, uncertainties: output.uncertainties });
    originals.push({ targetRecordId: metadata.targetRecordId, proofText: retained.record.proofText, outputText: retained.record.outputText });
  }
  const last = await inventory();
  if (!isDeepStrictEqual(last.value.request.state.request, first.value.request.state.request)
    || !isDeepStrictEqual(last.value.request.state.thematic, first.value.request.state.thematic)
    || !isDeepStrictEqual(last.saved, first.saved) || !isDeepStrictEqual(last.seal, first.seal)) differs();
  const input: SynthesisThematicProposalInput = { manifestSha256: first.plan.manifestSha256,
    sourceId: first.saved.requestId, sourceSha256: first.saved.snapshotSha256, contexts };
  return { request: last.value.request, source: first.saved, plan: first.plan, seal: first.seal, input, originals };
}
