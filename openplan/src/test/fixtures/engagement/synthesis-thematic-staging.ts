import { createSynthesisThematicPlan } from "@/lib/engagement/synthesis-thematic-continuation";
import { createSynthesisThematicStagingPlan, type SynthesisThematicStagingPlan } from "@/lib/engagement/synthesis-thematic-staging";
import { thematicContinuationFixture } from "./synthesis-thematic-continuation";
import { sourceHash as hash } from "./synthesis-source";

export function thematicStagingFixture(count = 1) {
 const f = thematicContinuationFixture(count);
 return { f, plan: createSynthesisThematicStagingPlan(createSynthesisThematicPlan(f.prepared)) };
}
/** Synthetic transport state, independently checked against native SQL receipts. */
export function thematicStagingState(plan: SynthesisThematicStagingPlan, nextIndex = 0, sealed = false) {
 const h=plan.header, last=plan.entries[nextIndex-1];
 const proposalReferenceText=JSON.stringify({ schemaVersion:1,purpose:"private_synthesis_thematic_proposal_reference",taskIndex:h.frameCount,
  inputManifestSha256:h.inputManifestSha256,inputSealSha256:h.inputSealSha256,continuationHeaderSha256:h.continuationHeaderSha256,
  contentManifestSha256:h.contentManifestSha256,frameTailSha256:h.tailSha256 });
 const receiptText=JSON.stringify({schemaVersion:1,requestId:h.requestId,headerSha256:plan.headerSha256,frameCount:h.frameCount,taskCount:h.taskCount,
  frameBytes:h.frameBytes,tailSha256:h.tailSha256,proposalReferenceText,proposalReferenceSha256:hash(proposalReferenceText),sealedAt:"2026-10-02T12:00:00Z"});
 return {schemaVersion:1 as const,requestId:h.requestId,campaignId:h.campaignId,workspaceId:h.workspaceId,
  headerText:plan.headerText,headerSha256:plan.headerSha256,nextIndex,frameBytes:last?.cumulativeBytes??0,tailSha256:last?.chainSha256??plan.seedSha256,
  cancelled:false,seal:sealed?{receiptText,receiptSha256:hash(receiptText)}:null};
}
