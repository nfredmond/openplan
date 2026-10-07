import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { verifySynthesisExecutionQueueReceipt } from "./synthesis-execution-queue-records";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { runSynthesisGenerationSchedule } from "./synthesis-generation-scheduler";
import { runSynthesisContextSchedule } from "./synthesis-context-scheduler";
import { runSynthesisThematicSchedule } from "./synthesis-thematic-scheduler";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const grantSchema = z.object({ id, request_id: id, intent_text: z.string().max(4096), intent_sha256: hash }).strict();
const requestSchema = z.object({ id, campaign_id: id, workspace_id: id, actor_id: id, source_id: id,
  intent_text: z.string().max(4096), intent_sha256: hash }).strict();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Bind explicit queue custody to retained authority before entering the existing
 * scheduler. The root is the single-task CLI root, so interruption recovery uses
 * the same target/authorization/task journals. Schedulers and native dispatch
 * still enforce current permission; this historical read grants no new rights.
 */
export async function runQueuedSynthesisSchedule(args: {
  service: Pick<SupabaseClient, "from" | "rpc">; target: string; root: string;
  receipt: unknown; commandText: string; signal: AbortSignal;
}) {
  args.signal.throwIfAborted();
  const target = providerApiWorkerTarget(args.target);
  const { command } = await verifySynthesisExecutionQueueReceipt(args.receipt, args.commandText);
  async function read(table: string, projection: string, value: string) {
    const bounded = synthesisWorkerRequestSignal(args.signal);
    const response = await args.service.from(table).select(projection).eq("id", value).abortSignal(bounded).single();
    bounded.throwIfAborted();
    if (response.error) throw new Error("Queued synthesis authority unavailable");
    return response.data;
  }
  const grant = grantSchema.parse(await read("engagement_synthesis_generation_authorizations", "id,request_id,intent_text,intent_sha256", command.authorizationId));
  const request = requestSchema.parse(await read("engagement_synthesis_generation_requests", "id,campaign_id,workspace_id,actor_id,source_id,intent_text,intent_sha256", command.requestId));
  const source = z.object({ sourceId: id, sourceSha256: hash }).passthrough().parse(JSON.parse(request.intent_text));
  if (grant.id !== command.authorizationId || grant.request_id !== command.requestId ||
    grant.intent_sha256 !== command.authorizationIntentSha256 || digest(grant.intent_text) !== grant.intent_sha256 ||
    request.id !== command.requestId || request.campaign_id !== command.campaignId || request.workspace_id !== command.workspaceId ||
    request.actor_id !== command.actorId || request.source_id !== command.sourceId || source.sourceId !== command.sourceId ||
    source.sourceSha256 !== command.sourceSha256 || request.intent_sha256 !== command.requestIntentSha256 ||
    digest(request.intent_text) !== request.intent_sha256) throw new Error("Queued synthesis authority differs");
  args.signal.throwIfAborted();
  const run = command.stage === "thematic" ? runSynthesisThematicSchedule
    : command.stage === "context" ? runSynthesisContextSchedule : runSynthesisGenerationSchedule;
  return run({ service: args.service, target, authorizationId: command.authorizationId,
    directory: join(args.root, digest(target), command.authorizationId), signal: args.signal });
}
