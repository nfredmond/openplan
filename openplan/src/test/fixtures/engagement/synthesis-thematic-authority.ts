import { synthesisThematicJobFixture } from "./synthesis-thematic-job";
import { sourceHash as hash } from "./synthesis-source";
import { loadSynthesisThematicScheduleAuthority } from "@/lib/engagement/synthesis-thematic-worker-authority";

/** Retain the same immutable database identities as the actual replay fixture.
 * Authority-only reads deliberately do not invoke current-scope RPCs.
 */
export async function synthesisThematicAuthorityFixture() {
  const f = await synthesisThematicJobFixture(0), request = f.prepared.request.state, intent = f.prepared.request.intent;
  const requestRow = { id: request.request.id, campaign_id: request.campaignId, workspace_id: request.workspaceId,
    actor_id: request.request.actorId, source_id: intent.sourceId, configuration_revision_id: intent.configurationRevisionId,
    intent_text: request.request.intentText, intent_sha256: request.request.intentSha256, created_at: request.request.createdAt };
  const thematicRow = { request_id: request.request.id, parent_request_id: request.thematic.parentRequestId,
    thematic_text: request.thematic.thematicText, thematic_sha256: request.thematic.thematicSha256, created_at: request.thematic.createdAt };
  const inputSealRow = { request_id: request.request.id, manifest_text: f.prepared.seal.manifestText,
    manifest_sha256: f.prepared.seal.manifestSha256, receipt_text: f.prepared.seal.receiptText, receipt_sha256: f.prepared.seal.receiptSha256 };
  const planRow = { request_id: request.request.id, header_text: f.plan.headerText, header_sha256: f.plan.headerSha256 };
  const sealRow = { request_id: request.request.id, receipt_text: f.state.seal!.receiptText, receipt_sha256: f.state.seal!.receiptSha256 };
  for (const [table, row] of [
    ["engagement_synthesis_generation_requests", requestRow], ["engagement_synthesis_thematic_requests", thematicRow],
    ["engagement_synthesis_thematic_input_seals", inputSealRow], ["engagement_synthesis_generation_plans", planRow],
    ["engagement_synthesis_generation_plan_seals", sealRow],
  ] as const) f.rows.set(table, [row]);
  f.trace.splice(0); f.rpc.mockClear();
  function changeHeader(patch: Record<string, unknown>) {
    planRow.header_text = JSON.stringify({ ...JSON.parse(planRow.header_text), ...patch }); planRow.header_sha256 = hash(planRow.header_text);
    f.grantIntent.headerSha256 = planRow.header_sha256; f.resealGrant();
    sealRow.receipt_text = JSON.stringify({ ...JSON.parse(sealRow.receipt_text), headerSha256: planRow.header_sha256 }); sealRow.receipt_sha256 = hash(sealRow.receipt_text);
  }
  function resealInputCustody(override: { manifestSha256?: string; receiptSha256?: string; preserveReceiptManifest?: boolean } = {}) {
    inputSealRow.manifest_sha256 = override.manifestSha256 ?? hash(inputSealRow.manifest_text);
    inputSealRow.receipt_text = JSON.stringify({ ...JSON.parse(inputSealRow.receipt_text), manifestSha256: override.preserveReceiptManifest ? JSON.parse(inputSealRow.receipt_text).manifestSha256 : inputSealRow.manifest_sha256 });
    inputSealRow.receipt_sha256 = override.receiptSha256 ?? hash(inputSealRow.receipt_text);
    const continuation = { ...f.plan.continuation.header, inputManifestSha256: inputSealRow.manifest_sha256, inputSealSha256: inputSealRow.receipt_sha256 };
    const continuationHeaderSha256 = hash(JSON.stringify(continuation));
    changeHeader({ inputManifestSha256: inputSealRow.manifest_sha256, inputSealSha256: inputSealRow.receipt_sha256, continuationHeaderSha256 });
    const receipt = JSON.parse(sealRow.receipt_text), reference = JSON.parse(receipt.proposalReferenceText);
    receipt.proposalReferenceText = JSON.stringify({ ...reference, inputManifestSha256: inputSealRow.manifest_sha256,
      inputSealSha256: inputSealRow.receipt_sha256, continuationHeaderSha256 });
    receipt.proposalReferenceSha256 = hash(receipt.proposalReferenceText);
    sealRow.receipt_text = JSON.stringify(receipt); sealRow.receipt_sha256 = hash(sealRow.receipt_text);
  }
  return { ...f, requestRow, thematicRow, inputSealRow, planRow, sealRow, changeHeader, resealInputCustody,
    load: () => loadSynthesisThematicScheduleAuthority(f.service, f.args.authorizationId, f.controller.signal) };
}
