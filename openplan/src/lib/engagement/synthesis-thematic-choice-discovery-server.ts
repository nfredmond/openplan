import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { readSynthesisContextRequest } from "./synthesis-context-requests-server";
import { readSynthesisGenerationRequest } from "./synthesis-generation-requests-server";
import { readSynthesisContinuationPage } from "./synthesis-continuation-server";
import { readSynthesisThematicChoice } from "./synthesis-thematic-choices-server";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { verifySynthesisRequestHistory, synthesisRequestHistoryCursorSchema, type SynthesisRequestHistoryCursor } from "./synthesis-request-history";
import { thematicContributionPageSchema, thematicContextPageSchema } from "./synthesis-thematic-choice-discovery";
import { synthesisThematicChoiceSelectionSchema } from "./synthesis-thematic-choice-command";

const id = z.string().uuid();
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id, actorId: id }).strict();
type Scope = z.infer<typeof scopeSchema>;
type Client = Pick<SupabaseClient, "rpc">;
type Service = Pick<SupabaseClient, "rpc" | "from">;
type Request = Awaited<ReturnType<typeof readSynthesisThematicRequest>>;
const requestScope = ({ campaignId, workspaceId, requestId }: Scope) => ({ campaignId, workspaceId, requestId });
async function read(client: Client, scope: Scope, signal: AbortSignal) {
  const request = await readSynthesisThematicRequest(client, requestScope(scope), signal);
  if (request.state.request.actorId !== scope.actorId) throw new Error("Only the thematic requester can select inputs");
  return request;
}
function metadata(scope: Scope, request: Request) {
  return { schemaVersion: 1 as const, ...scope, sourceId: request.intent.sourceId, sourceSha256: request.intent.sourceSha256,
    requestIntentSha256: request.state.request.intentSha256, thematicSha256: request.state.thematic.thematicSha256 };
}
async function recheck(client: Client, scope: Scope, previous: Request, signal: AbortSignal) {
  const current = await read(client, scope, signal);
  if (current.state.request.intentText !== previous.state.request.intentText || current.state.thematic.thematicText !== previous.state.thematic.thematicText) {
    throw new Error("Thematic request changed during discovery");
  }
  signal.throwIfAborted();
}

/** List complete-source contributions and their immutable saved choices. Paging
 * does not make a partial selection eligible for whole-source preparation.
 */
export async function readThematicContributionPage(client: Client, service: Service, rawScope: Scope, rawOffset: number, signal: AbortSignal) {
  const scope = scopeSchema.parse(rawScope), offset = z.number().int().nonnegative().safe().parse(rawOffset);
  const request = await read(client, scope, signal), parentRequestId = request.binding.parentRequestId;
  const parent = await readSynthesisGenerationRequest(client, { ...requestScope(scope), requestId: parentRequestId }, signal);
  if (!parent.state.request || parent.intent?.sourceId !== request.intent.sourceId || parent.intent.sourceSha256 !== request.intent.sourceSha256) {
    throw new Error("Thematic parent source differs");
  }
  const page = await readSynthesisContinuationPage(client, service, { campaignId: scope.campaignId, workspaceId: scope.workspaceId }, {
    parentRequestId, parentActorId: parent.state.request.actorId, parentIntentSha256: parent.state.request.intentSha256,
    sourceId: request.intent.sourceId, sourceSha256: request.intent.sourceSha256, throughSequence: request.binding.selectionSequence,
    segmentResultsManifestSha256: request.binding.segmentResultsManifestSha256,
  }, offset, signal);
  const choices = [];
  for (const entry of page.entries) choices.push((await readSynthesisThematicChoice(client, requestScope(scope), entry.recordId, signal))?.record ?? null);
  await recheck(client, scope, request, signal);
  return thematicContributionPageSchema.parse({ ...metadata(scope, request), page, choices });
}

/** Discover context requests through current staff RPCs. Matching request
 * metadata establishes eligibility for inspection, not completed output.
 */
export async function readThematicContextPage(client: Client, rawScope: Scope, targetRecordId: string,
  rawBefore: SynthesisRequestHistoryCursor | null, signal: AbortSignal) {
  const scope = scopeSchema.parse(rawScope), before = rawBefore === null ? null : synthesisRequestHistoryCursorSchema.parse(rawBefore);
  synthesisThematicChoiceSelectionSchema.shape.targetRecordId.parse(targetRecordId);
  const request = await read(client, scope, signal), sourceScope = { campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    sourceId: request.intent.sourceId, sourceSha256: request.intent.sourceSha256 };
  const response = await client.rpc("list_engagement_synthesis_generation_requests", { p_campaign: scope.campaignId,
    p_source: sourceScope.sourceId, p_before: before }).abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Context discovery unavailable");
  const history = verifySynthesisRequestHistory(response.data, sourceScope, before), eligibleRequestIds: string[] = [];
  for (const entry of history.entries) {
    if (entry.stage !== "context" || entry.parentRequestId !== request.binding.parentRequestId) continue;
    const context = await readSynthesisContextRequest(client, { ...requestScope(scope), requestId: entry.requestId }, signal);
    if (context.state.request.actorId !== entry.actorId || context.state.request.intentSha256 !== entry.intentSha256 ||
      context.intent.sourceId !== sourceScope.sourceId || context.intent.sourceSha256 !== sourceScope.sourceSha256) throw new Error("Discovered context scope differs");
    const binding = context.binding;
    if (binding.targetRecordId === targetRecordId && binding.parentRequestId === request.binding.parentRequestId &&
      binding.selectionSequence === request.binding.selectionSequence && binding.segmentResultsManifestSha256 === request.binding.segmentResultsManifestSha256 &&
      binding.contextManifestSha256 === request.binding.contextManifestSha256) eligibleRequestIds.push(entry.requestId);
  }
  await recheck(client, scope, request, signal);
  return thematicContextPageSchema.parse({ ...metadata(scope, request), targetRecordId, parentRequestId: request.binding.parentRequestId, history, eligibleRequestIds });
}
