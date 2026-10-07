import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSynthesisGenerationRequest, SynthesisGenerationRequestError } from "./synthesis-generation-requests-server";
import { loadSynthesisGenerationHistory } from "./synthesis-generation-selected-results-server";
import { loadSynthesisContextHistory } from "./synthesis-context-history-server";
import { loadSynthesisThematicHistory } from "./synthesis-thematic-history-server";
import { verifySynthesisProgress, synthesisTaskDispositionSchema, synthesisProgressSchema, type SynthesisProgress } from "./synthesis-progress";
import { readSynthesisProgressPlan } from "./synthesis-progress-plan-server";

const id = z.string().uuid();
export const synthesisProgressQuerySchema = z.object({ campaignId: id, workspaceId: id, requestId: id,
  stage: z.enum(["segment", "context", "thematic"]) }).strict();
type Client = Pick<SupabaseClient, "rpc">;
type Service = Pick<SupabaseClient, "rpc" | "from">;
const unavailable = (): never => { throw new SynthesisGenerationRequestError("unavailable", 503); };

/** Reuse original-output replay for all stages. A compact summary omits source
 * and generated wording; current native staff access brackets every private read.
 */
export async function readSynthesisProgress(client: Client, service: Service,
  rawQuery: z.infer<typeof synthesisProgressQuerySchema>, signal: AbortSignal): Promise<SynthesisProgress> {
  signal.throwIfAborted();
  const query = synthesisProgressQuerySchema.parse(rawQuery), { stage, ...requestScope } = query;
  const original = await readSynthesisGenerationRequest(client, requestScope, signal);
  const request = original.state.request, intent = original.intent;
  if (!request || !intent) throw new SynthesisGenerationRequestError("conflict", 409);
  const scope = { ...query, actorId: request.actorId, sourceId: intent.sourceId,
    sourceSha256: intent.sourceSha256, requestIntentSha256: request.intentSha256 };
  let status: SynthesisProgress["status"], sequence: number | null, manifestSha256: string;
  let taskCount: number | null, dispositions: string[];
  if (stage === "segment") {
    const result = await loadSynthesisGenerationHistory(client, service, requestScope, signal);
    if (result.requesterId !== request.actorId || result.campaignId !== query.campaignId || result.workspaceId !== query.workspaceId ||
      result.selections.requestId !== query.requestId || result.inventory.job.jobId !== query.requestId ||
      result.inventory.source.requestId !== intent.sourceId || result.inventory.source.sha256 !== intent.sourceSha256) unavailable();
    status = result.inventory.status; sequence = result.selections.throughSequence;
    manifestSha256 = result.inventory.manifestSha256; taskCount = result.inventory.entries.length;
    dispositions = result.inventory.entries.map(entry => entry.disposition);
    const preparation = await readSynthesisProgressPlan(service, result.selections.plan, signal);
    if (preparation !== "sealed") { status = preparation; taskCount = null; dispositions = []; sequence = null; }
  } else {
    const result = stage === "context" ? await loadSynthesisContextHistory(client, service, requestScope, signal)
      : await loadSynthesisThematicHistory(client, service, requestScope, signal);
    if (result.request.state.request.id !== query.requestId || result.request.state.request.actorId !== request.actorId ||
      result.request.state.request.intentText !== request.intentText || result.manifest.campaignId !== query.campaignId ||
      result.manifest.workspaceId !== query.workspaceId || result.manifest.requestId !== query.requestId) unavailable();
    status = synthesisProgressSchema.shape.status.parse(result.manifest.status); sequence = result.manifest.throughSequence;
    manifestSha256 = result.sha256; taskCount = result.plan === null ? null : result.entries.length;
    dispositions = result.entries.map(entry => entry.status);
    if (["inputs_not_sealed", "not_prepared", "staging"].includes(status)) { taskCount = null; dispositions = []; sequence = null; }
  }
  const current = await readSynthesisGenerationRequest(client, requestScope, signal);
  if (current.state.request?.intentText !== request.intentText || current.state.request.actorId !== request.actorId) unavailable();
  signal.throwIfAborted();
  const counts = new Map<z.infer<typeof synthesisTaskDispositionSchema>, number>();
  for (const raw of dispositions) {
    const disposition = synthesisTaskDispositionSchema.parse(raw);
    counts.set(disposition, (counts.get(disposition) ?? 0) + 1);
  }
  return verifySynthesisProgress({ schemaVersion: 1, ...scope, checkedAt: new Date().toISOString(),
    cancelled: current.cancellation !== null, status, interpretation: stage === "segment" ? "not_assessed" : "machine_unreviewed",
    selectionSequence: sequence, manifestSha256, taskCount,
    counts: [...counts].map(([disposition, count]) => ({ disposition, count })),
  }, scope);
}
