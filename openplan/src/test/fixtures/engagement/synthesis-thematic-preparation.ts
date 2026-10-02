import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { z } from "zod";
import { loadSynthesisContextHistory } from "@/lib/engagement/synthesis-context-history-server";
import { loadSynthesisThematicPreparation } from "@/lib/engagement/synthesis-thematic-preparation-server";
import { synthesisContextHistoryFixture } from "./synthesis-context-history";
import { sourceHash as hash } from "./synthesis-source";

/** Only transport is mocked. Both entry points replay the real source, plans,
 * original provider captures and context continuation. SQL authority is separate.
 */
export async function synthesisThematicPreparationFixture() {
  const f = synthesisContextHistoryFixture(); f.completeHistory();
  const expected = await loadSynthesisContextHistory(f.client, f.service, f.scope, f.controller.signal);
  const source = (await f.client.rpc("read_engagement_synthesis_sources", {})).data as {
    requestId: string; campaignId: string; workspaceId: string; snapshotText: string; snapshotSha256: string; createdAt: string };
  const parent = { schemaVersion: 1, campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId,
    request: z.object({ id: z.string(), actorId: z.string(), intentText: z.string(), intentSha256: z.string(), createdAt: z.string() }).parse({
      id: f.parentRow.id, actorId: f.parentRow.actor_id, intentText: f.parentRow.intent_text,
      intentSha256: f.parentRow.intent_sha256, createdAt: f.parentRow.created_at }), cancellation: null };
  const requestId = randomUUID(), actorId = randomUUID(), b = expected.request.binding;
  const thematicText = JSON.stringify({ schemaVersion: 1, parentRequestId: b.parentRequestId, selectionSequence: b.selectionSequence,
    segmentResultsManifestSha256: b.segmentResultsManifestSha256, contextManifestSha256: b.contextManifestSha256, frameByteLimit: b.frameByteLimit });
  const choiceText = JSON.stringify({ schemaVersion: 1, targetRecordId: b.targetRecordId, contextRequestId: f.scope.requestId,
    selectionSequence: expected.manifest.throughSequence, historyManifestSha256: expected.sha256,
    finalCaptureSha256: expected.entries.at(-1)!.captureSha256, finalResultSha256: expected.entries.at(-1)!.resultSha256 });
  const { snapshotText: _snapshotText, ...reference } = source;
  const bundle = { schemaVersion: 1, purpose: "private_synthesis_thematic_preparation",
    thematic: { schemaVersion: 1, campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId,
      request: { ...f.request.request, id: requestId, actorId }, cancellation: null as unknown,
      thematic: { parentRequestId: b.parentRequestId, thematicText, thematicSha256: hash(thematicText), createdAt: f.request.request.createdAt } },
    parent, context: f.request,
    choice: { schemaVersion: 1, campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId, requestId,
      targetRecordId: b.targetRecordId, choiceText, choiceSha256: hash(choiceText), createdBy: actorId, createdAt: f.request.request.createdAt }, source: reference };
  const sourceRow = { id: source.requestId, campaign_id: source.campaignId, workspace_id: source.workspaceId,
    snapshot_text: source.snapshotText, snapshot_sha256: source.snapshotSha256, created_at: source.createdAt };
  f.rows.set("engagement_synthesis_sources", [sourceRow]);
  const calls: Array<{ name: string; parameters: Record<string, unknown>; signal?: AbortSignal }> = [];
  const options = { deny: "", denyRead: 0, reads: 0, abortAt: "", before: null as null | ((name: string) => void),
    change: null as null | ((packet: typeof bundle) => void) };
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => {
    const call = { name, parameters, signal: undefined as AbortSignal | undefined }; calls.push(call); options.before?.(name);
    const result = (async () => {
      let data: unknown;
      if (name === "read_engagement_synthesis_thematic_preparation") {
        options.reads++; const packet = structuredClone(bundle); options.change?.(packet); data = packet;
      } else if (name === "read_engagement_synthesis_thematic_preparation_selections") {
        data = (await f.client.rpc("read_engagement_synthesis_generation_selection_history", {
          p_request: parameters.p_stage === "parent" ? b.parentRequestId : f.scope.requestId,
          p_through_sequence: parameters.p_stage === "parent" ? b.selectionSequence : expected.manifest.throughSequence,
          p_after_task_index: parameters.p_after_task_index, p_limit: parameters.p_limit,
        })).data;
      } else throw new Error(`Unexpected preparation RPC ${name}`);
      if (name === options.abortAt) f.controller.abort();
      return { data, error: options.deny === name || (name === "read_engagement_synthesis_thematic_preparation" && options.denyRead === options.reads) ? { code: "42501" } : null };
    })();
    return Object.assign(result, { abortSignal(signal: AbortSignal) { call.signal = signal; return result; } });
  });
  const service = { from: f.from, rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  const scope = { campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId, requestId, targetRecordId: b.targetRecordId };
  f.trace.length = 0; f.calls.length = 0;
  return { f, expected, bundle, sourceRow, scope, calls, options, service, load: () => loadSynthesisThematicPreparation(service, scope, f.controller.signal),
    patchChoice: (patch: Record<string, unknown>) => { bundle.choice.choiceText = JSON.stringify({ ...JSON.parse(choiceText), ...patch }); bundle.choice.choiceSha256 = hash(bundle.choice.choiceText); } };
}

