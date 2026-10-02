import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisThematicProposalInputs } from "./synthesis-thematic-proposal-inputs-server";
import { createSynthesisThematicPlan } from "./synthesis-thematic-continuation";
import { createSynthesisThematicStagingPlan, verifySynthesisThematicStagingState } from "./synthesis-thematic-staging";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),natural=z.number().int().nonnegative().safe();
const digest=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
const requestSchema=z.object({id,campaign_id:id,workspace_id:id}).strict();
const frameSchema=z.object({request_id:id,frame_index:natural,frame_text:z.string(),frame_sha256:hash,frame_bytes:natural}).strict();
const taskSchema=z.object({request_id:id,task_index:natural,task_text:z.string(),task_sha256:hash,task_bytes:natural,cumulative_bytes:natural,chain_sha256:hash}).strict();
const referenceSchema=z.object({schemaVersion:z.literal(1),purpose:z.literal("private_synthesis_thematic_frame_reference"),frameIndex:natural,frameSha256:hash,frameBytes:natural,inputManifestSha256:hash,contentManifestSha256:hash}).strict();
const taskColumns="request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256";
const differs=():never=>{throw new Error("Thematic worker retained inputs differ");};
type Service=Pick<SupabaseClient,"rpc"|"from">;

/** Reconstruct original sealed inputs, then compare every retained frame and
 * task reference. Recheck current scope after the reads. Neither reconstruction
 * nor a stored seal replaces native resource authorization and dispatch fencing.
 */
export async function loadSynthesisThematicWorkerInputs(service:Service,rawRequestId:string,signal:AbortSignal){
 signal.throwIfAborted();const requestId=id.parse(rawRequestId);
 async function read(query:PromiseLike<{data:unknown;error:unknown}>){
  signal.throwIfAborted();const response=await query;signal.throwIfAborted();
  if(response.error) throw new Error("Thematic worker retained inputs unavailable");return response.data;
 }
 function readTask(index:number){
  return read(service.from("engagement_synthesis_generation_plan_tasks").select(taskColumns)
   .eq("request_id",requestId).eq("task_index",index).abortSignal(synthesisWorkerRequestSignal(signal)).single());
 }
 const row=requestSchema.parse(await read(service.from("engagement_synthesis_generation_requests").select("id,campaign_id,workspace_id").eq("id",requestId).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
 if(row.id!==requestId) differs();
 const scope={requestId,campaignId:row.campaign_id,workspaceId:row.workspace_id};
 const prepared=await loadSynthesisThematicProposalInputs(service,scope,signal);
 const plan=createSynthesisThematicStagingPlan(createSynthesisThematicPlan(prepared));
 async function current(){
  signal.throwIfAborted();const response=await service.rpc("read_engagement_synthesis_thematic_plan",{p_request:requestId}).abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();if(response.error) throw new Error("Thematic worker current scope unavailable");
  const state=verifySynthesisThematicStagingState(plan,response.data);
  if(!state.seal||state.cancelled) throw new Error("Thematic worker requires an active sealed plan");return state;
 }
 const state=await current();
 for(const expected of plan.entries){
  const frame=frameSchema.parse(await read(service.from("engagement_synthesis_thematic_frames").select("request_id,frame_index,frame_text,frame_sha256,frame_bytes").eq("request_id",requestId).eq("frame_index",expected.index).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
  if(frame.request_id!==requestId||frame.frame_index!==expected.index||frame.frame_text!==expected.canonical||frame.frame_sha256!==expected.sha256||frame.frame_bytes!==expected.utf8Bytes) differs();
  const task=taskSchema.parse(await readTask(expected.index));
  const reference=referenceSchema.parse(JSON.parse(task.task_text));
  if(task.request_id!==requestId||task.task_index!==expected.index||digest(task.task_text)!==task.task_sha256||Buffer.byteLength(task.task_text)!==task.task_bytes
   ||task.cumulative_bytes!==expected.cumulativeBytes||task.chain_sha256!==expected.chainSha256||reference.frameIndex!==expected.index||reference.frameSha256!==expected.sha256
   ||reference.frameBytes!==expected.utf8Bytes||reference.inputManifestSha256!==plan.header.inputManifestSha256||reference.contentManifestSha256!==plan.header.contentManifestSha256) differs();
 }
 const final=taskSchema.parse(await readTask(plan.header.frameCount));
 const receipt=JSON.parse(state.seal!.receiptText) as {proposalReferenceText:string;proposalReferenceSha256:string};
 if(final.request_id!==requestId||final.task_index!==plan.header.frameCount||final.task_text!==receipt.proposalReferenceText||final.task_sha256!==receipt.proposalReferenceSha256
  ||Buffer.byteLength(final.task_text)!==final.task_bytes||final.cumulative_bytes!==plan.header.frameBytes||final.chain_sha256!==plan.header.tailSha256) differs();
 const refreshed=await current();if(refreshed.seal!.receiptText!==state.seal!.receiptText||refreshed.seal!.receiptSha256!==state.seal!.receiptSha256) differs();
 return {scope,prepared,request:prepared.request.state,intent:prepared.request.intent,plan};
}
