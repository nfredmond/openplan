import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { synthesisContinuationParentSchema, synthesisContinuationCommandSchema, synthesisContinuationPageSchema,
  type SynthesisContinuationParent, type SynthesisContinuationCommand } from "./synthesis-continuation-records";
import { readSynthesisGenerationRequest, SynthesisGenerationRequestError } from "./synthesis-generation-requests-server";
import { loadSynthesisGenerationHistory } from "./synthesis-generation-selected-results-server";
import { readSynthesisProgressPlan } from "./synthesis-progress-plan-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { createSynthesisContextRequest } from "./synthesis-context-requests-server";
import { createSynthesisThematicRequest } from "./synthesis-thematic-requests-server";

type Client = Pick<SupabaseClient, "rpc">;
type Service = Pick<SupabaseClient, "rpc" | "from">;
const scopeSchema = z.object({ campaignId: z.string().uuid(), workspaceId: z.string().uuid() }).strict();
type Scope = z.infer<typeof scopeSchema>;
const conflict = (): never => { throw new SynthesisGenerationRequestError("conflict", 409); };

async function readParent(client: Client, scope: Scope, parent: SynthesisContinuationParent, signal: AbortSignal) {
  const result = await readSynthesisGenerationRequest(client, { ...scope, requestId: parent.parentRequestId }, signal);
  if (result.state.request?.actorId !== parent.parentActorId || result.state.request.intentSha256 !== parent.parentIntentSha256 ||
    result.intent?.sourceId !== parent.sourceId || result.intent.sourceSha256 !== parent.sourceSha256) conflict();
  return result;
}

/** Reconstruct the explicitly selected history before exposing contributions or
 * saving a child. Current staff authority brackets service-only original reads.
 */
async function inspectParent(client: Client, service: Service, scope: Scope, parent: SynthesisContinuationParent, signal: AbortSignal) {
  signal.throwIfAborted();
  await readParent(client, scope, parent, signal);
  const history = await loadSynthesisGenerationHistory(client, service, { ...scope, requestId: parent.parentRequestId,
    throughSequence: parent.throughSequence }, signal);
  if (history.campaignId !== scope.campaignId || history.workspaceId !== scope.workspaceId || history.requesterId !== parent.parentActorId ||
    history.selections.requestId !== parent.parentRequestId || history.selections.throughSequence !== parent.throughSequence ||
    history.inventory.job.jobId !== parent.parentRequestId || history.inventory.source.requestId !== parent.sourceId ||
    history.inventory.source.sha256 !== parent.sourceSha256 || history.inventory.manifestSha256 !== parent.segmentResultsManifestSha256 ||
    history.inventory.status !== "ready_for_record_consolidation" || !history.inventory.contributionIds.length ||
    new Set(history.inventory.contributionIds).size !== history.inventory.contributionIds.length) conflict();
  if (await readSynthesisProgressPlan(service, history.selections.plan, signal) !== "sealed") conflict();
  await readParent(client, scope, parent, signal);
  signal.throwIfAborted();
  return history;
}

/** Page only the pinned parent's contributions. Previews are bounded plain text;
 * contact metadata and structured answer payloads are not part of this picker.
 */
export async function readSynthesisContinuationPage(client: Client, service: Service, rawScope: Scope,
  rawParent: SynthesisContinuationParent, rawOffset: number, signal: AbortSignal) {
  const scope = scopeSchema.parse(rawScope), parent = synthesisContinuationParentSchema.parse(rawParent);
  const offset = z.number().int().nonnegative().safe().parse(rawOffset);
  const history = await inspectParent(client, service, scope, parent, signal);
  const ids = history.inventory.contributionIds;
  if (offset > ids.length) conflict();
  const sourceScope = { ...scope, requestId: parent.sourceId };
  const response = await client.rpc("read_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_request: parent.sourceId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  if (response.error) throw new SynthesisGenerationRequestError("unavailable", 503);
  const source = verifySynthesisSource(response.data, sourceScope);
  if (source.snapshotSha256 !== parent.sourceSha256) conflict();
  const rows = new Map<string, { kind: "item" | "answer"; label: string; text: string }>([
    ...source.snapshot.items.map(row => [`item:${row.id}`, { kind: "item" as const, label: row.title?.trim() || "Comment", text: row.body }] as const),
    ...source.snapshot.answers.map(row => [`answer:${row.id}`, { kind: "answer" as const,
      label: row.question_prompt_snapshot?.trim() || "Survey response", text: row.answer_text ?? "" }] as const),
  ]);
  // Compare full membership, not just the displayed page. A skipped contribution
  // must not disappear behind a successful first-page response.
  if (rows.size !== ids.length || ids.some(recordId => !rows.has(recordId))) conflict();
  const entries = ids.slice(offset, offset + 25).map(recordId => {
    const row = rows.get(recordId)!;
    return { recordId, kind: row.kind, label: row.label.slice(0, 160), excerpt: row.text.slice(0, 280), excerptTruncated: row.text.length > 280 };
  });
  const current = await readParent(client, scope, parent, signal);
  signal.throwIfAborted();
  const end = offset + entries.length;
  return synthesisContinuationPageSchema.parse({ schemaVersion: 1, ...scope, parent, cancelled: current.cancellation !== null,
    interpretation: "not_assessed", offset, pageSize: 25, total: ids.length, nextOffset: end < ids.length ? end : null, entries });
}

/** Retain a staff command through existing native child-request operations.
 * This creates no execution grant, thematic choice, worker call or publication.
 */
export async function createSynthesisContinuation(client: Client, service: Service, rawScope: Scope,
  rawActorId: string, rawCommand: SynthesisContinuationCommand, signal: AbortSignal) {
  const scope = scopeSchema.parse(rawScope), actorId = z.string().uuid().parse(rawActorId);
  const command = synthesisContinuationCommandSchema.parse(rawCommand), parent = command.parent;
  const history = await inspectParent(client, service, scope, parent, signal);
  if (command.stage === "context" && !history.inventory.contributionIds.includes(command.targetRecordId)) conflict();
  const args = { ...scope, actorId, requestId: command.requestId, parentRequestId: parent.parentRequestId,
    throughSequence: parent.throughSequence, intentText: command.intentText, frameByteLimit: command.frameByteLimit };
  const result = command.stage === "context"
    ? await createSynthesisContextRequest(client, service, { ...args, targetRecordId: command.targetRecordId }, signal)
    : await createSynthesisThematicRequest(client, service, args, signal);
  signal.throwIfAborted();
  if (result.binding.segmentResultsManifestSha256 !== parent.segmentResultsManifestSha256 ||
    result.binding.parentRequestId !== parent.parentRequestId || result.binding.selectionSequence !== parent.throughSequence ||
    result.binding.frameByteLimit !== command.frameByteLimit || result.state.request.id !== command.requestId ||
    result.state.request.actorId !== actorId || result.state.request.intentText !== command.intentText ||
    result.state.replayed === undefined || (command.stage === "context" &&
      (!("targetRecordId" in result.binding) || result.binding.targetRecordId !== command.targetRecordId))) conflict();
  return result.state;
}
