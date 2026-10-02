import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { loadSynthesisContextHistory } from "./synthesis-context-history-server";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), sequence = z.number().int().nonnegative().safe();
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const choiceSchema = z.object({ schemaVersion: z.literal(1), targetRecordId: target, contextRequestId: id,
  selectionSequence: sequence, historyManifestSha256: hash, finalCaptureSha256: hash, finalResultSha256: hash }).strict();
const recordSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id, requestId: id, targetRecordId: target,
  choiceText: z.string().max(4096), choiceSha256: hash, createdBy: id, createdAt: z.string().datetime({ offset: true }),
  replayed: z.boolean().optional() }).strict();
type Client = Pick<SupabaseClient, "rpc">;
type Service = Pick<SupabaseClient, "rpc" | "from">;
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** These are requested immutable inputs, not a verified plan or spending grant.
 * The eventual input-plan reader must replay the original context again and
 * compare every pinned hash before accepting its seal.
 */
export function verifySynthesisThematicChoice(raw: unknown, scope: z.infer<typeof scopeSchema>, targetRecordId: string) {
  const record = recordSchema.parse(raw), choice = choiceSchema.parse(JSON.parse(record.choiceText));
  if (record.campaignId !== scope.campaignId || record.workspaceId !== scope.workspaceId || record.requestId !== scope.requestId
    || record.targetRecordId !== targetRecordId || choice.targetRecordId !== targetRecordId
    || digest(record.choiceText) !== record.choiceSha256) throw new Error("Retained thematic input choice differs");
  return { record, choice };
}

export async function readSynthesisThematicChoice(client: Client, rawScope: z.infer<typeof scopeSchema>,
  targetRecordId: string, signal: AbortSignal,
) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope); target.parse(targetRecordId);
  await readSynthesisThematicRequest(client, scope, signal);
  // The native reader rechecks current staff permission on the thematic request.
  const response = await client.rpc("read_engagement_synthesis_thematic_choice", { p_campaign: scope.campaignId,
    p_request: scope.requestId, p_target: targetRecordId }).abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Thematic input choice unavailable");
  return response.data === null ? null : verifySynthesisThematicChoice(response.data, scope, targetRecordId);
}

const createSchema = scopeSchema.extend({ actorId: id, contextRequestId: id, throughSequence: sequence, targetRecordId: target }).strict();

/** Retain one reconstructed context at a time under the current staff client.
 * Each exact choice can be retried after interruption. Whole-source membership,
 * durable worker preparation and a sealed input plan remain separate work.
 */
export async function retainSynthesisThematicChoice(client: Client, service: Service,
  raw: z.infer<typeof createSchema>, signal: AbortSignal,
) {
  signal.throwIfAborted(); const args = createSchema.parse(raw);
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const request = await readSynthesisThematicRequest(client, scope, signal);
  if (request.state.request.actorId !== args.actorId) throw new Error("Only the thematic requester can retain input choices");
  const history = await loadSynthesisContextHistory(client, service, { campaignId: args.campaignId, workspaceId: args.workspaceId,
    requestId: args.contextRequestId, throughSequence: args.throughSequence }, signal);
  signal.throwIfAborted();
  const binding = history.request.binding, last = history.entries.at(-1);
  if (history.manifest.status !== "frames_complete" || history.finalOutputText === null || !last?.captureSha256 || !last.resultSha256) {
    throw new Error("Thematic input requires complete retained context");
  }
  if (history.request.state.campaignId !== args.campaignId || history.request.state.workspaceId !== args.workspaceId
    || history.request.state.request.id !== args.contextRequestId || history.manifest.throughSequence !== args.throughSequence
    || history.request.intent.sourceId !== request.intent.sourceId || history.request.intent.sourceSha256 !== request.intent.sourceSha256
    || binding.parentRequestId !== request.binding.parentRequestId || binding.selectionSequence !== request.binding.selectionSequence
    || binding.segmentResultsManifestSha256 !== request.binding.segmentResultsManifestSha256
    || binding.contextManifestSha256 !== request.binding.contextManifestSha256 || binding.targetRecordId !== args.targetRecordId) {
    throw new Error("Thematic context differs from the requested source and parent");
  }
  const choice = choiceSchema.parse({ schemaVersion: 1, targetRecordId: args.targetRecordId, contextRequestId: args.contextRequestId,
    selectionSequence: args.throughSequence, historyManifestSha256: history.sha256,
    finalCaptureSha256: last.captureSha256, finalResultSha256: last.resultSha256 });
  const choiceText = JSON.stringify(choice);
  signal.throwIfAborted();
  const response = await client.rpc("retain_engagement_synthesis_thematic_choice", { p_campaign: args.campaignId,
    p_request: args.requestId, p_choice_text: choiceText }).abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Thematic input save unconfirmed; retry the same choice");
  const retained = verifySynthesisThematicChoice(response.data, scope, args.targetRecordId);
  if (retained.record.choiceText !== choiceText || retained.record.createdBy !== args.actorId || retained.record.replayed === undefined) {
    throw new Error("Saved thematic input differs from the requested choice");
  }
  return retained;
}
