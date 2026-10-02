import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { thematicProposalInputsFixture } from "./synthesis-thematic-proposal-inputs";
import { createSynthesisThematicPlan } from "@/lib/engagement/synthesis-thematic-continuation";
import { createSynthesisThematicStagingPlan } from "@/lib/engagement/synthesis-thematic-staging";
import { loadSynthesisThematicWorkerInputs } from "@/lib/engagement/synthesis-thematic-worker-load";
import { thematicStagingState } from "./synthesis-thematic-staging";
import { sourceHash as hash } from "./synthesis-source";

/** Actual original-history replay with transport-only storage. Native permissions
 * and transaction recovery are covered by the independent local-stack fixtures.
 */
export async function synthesisThematicWorkerFixture(configuration?:{connectionId:string;revisionId:string;configurationHash:string;modelId:string}){
 const original=await thematicProposalInputsFixture(configuration?{connectionId:configuration.connectionId,configurationRevisionId:configuration.revisionId,configurationHash:configuration.configurationHash,modelId:configuration.modelId}:{}),prepared=await original.load();
 const plan=createSynthesisThematicStagingPlan(createSynthesisThematicPlan(prepared)),state=thematicStagingState(plan,plan.entries.length,true);
 const rows=new Map<string,Record<string,unknown>[]>(),controller=original.f.f.controller;
 const options={failRpc:"",failTable:"",abortTable:"",stateReads:0,cancelRead:0,missingTable:"",returnedPatch:null as null|{table:string;key:string;value:unknown;patch:Record<string,unknown>}};
 const trace:Array<{table:string;columns:string;filters:Record<string,unknown>;signal?:AbortSignal}>=[];
 function add(table:string,row:Record<string,unknown>){rows.set(table,[...(rows.get(table)??[]),row]);}
 add("engagement_synthesis_generation_requests",{id:original.scope.requestId,campaign_id:original.scope.campaignId,workspace_id:original.scope.workspaceId});
 for(const frame of plan.entries){
  add("engagement_synthesis_thematic_frames",{request_id:original.scope.requestId,frame_index:frame.index,frame_text:frame.canonical,frame_sha256:frame.sha256,frame_bytes:frame.utf8Bytes});
  const text=JSON.stringify({schemaVersion:1,purpose:"private_synthesis_thematic_frame_reference",frameIndex:frame.index,frameSha256:frame.sha256,frameBytes:frame.utf8Bytes,inputManifestSha256:plan.header.inputManifestSha256,contentManifestSha256:plan.header.contentManifestSha256});
  add("engagement_synthesis_generation_plan_tasks",{request_id:original.scope.requestId,task_index:frame.index,task_text:text,task_sha256:hash(text),task_bytes:Buffer.byteLength(text),cumulative_bytes:frame.cumulativeBytes,chain_sha256:frame.chainSha256});
 }
 const receipt=JSON.parse(state.seal!.receiptText),finalText=receipt.proposalReferenceText;
 add("engagement_synthesis_generation_plan_tasks",{request_id:original.scope.requestId,task_index:plan.header.frameCount,task_text:finalText,task_sha256:hash(finalText),task_bytes:Buffer.byteLength(finalText),cumulative_bytes:plan.header.frameBytes,chain_sha256:plan.header.tailSha256});
 const from=vi.fn((table:string)=>({select(columns:string){
  const filters:Record<string,unknown>={};let signal:AbortSignal|undefined;
  async function finish(maybe:boolean){
   const row=rows.get(table)?.find(row=>Object.entries(filters).every(([key,value])=>row[key]===value));
   if(!row){let fallback=original.service.from(table).select(columns);for(const [key,value] of Object.entries(filters))fallback=fallback.eq(key,value);if(signal)fallback=fallback.abortSignal(signal);return maybe?fallback.maybeSingle():fallback.single();}
   trace.push({table,columns,filters:{...filters},signal});if(options.abortTable===table)controller.abort();let data={...row};const patch=options.returnedPatch;
   if(patch?.table===table&&data[patch.key]===patch.value) data={...data,...patch.patch};
   return {data:options.missingTable===table?null:Object.fromEntries(columns.split(",").map(key=>[key,data[key]])),error:options.failTable===table?{code:"42501"}:null};
  }
  const query={eq(key:string,value:unknown){filters[key]=value;return query;},abortSignal(value:AbortSignal){signal=value;return query;},single:()=>finish(false),maybeSingle:()=>finish(true)};return query;
 }}));
 const rpc=vi.fn((name:string,args:Record<string,unknown>)=>{
  if(name!=="read_engagement_synthesis_thematic_plan")return original.service.rpc(name,args);
  options.stateReads++;const data=structuredClone(state);if(options.stateReads===options.cancelRead)data.cancelled=true;
  const result=Promise.resolve({data,error:options.failRpc===name?{code:"42501"}:null});return Object.assign(result,{abortSignal:()=>result});
 });
 const service={from,rpc} as unknown as Pick<SupabaseClient,"from"|"rpc">;
 const f={scope:original.scope,request:prepared.request.state,f:{args:{job:{configurationRevisionId:prepared.request.intent.configurationRevisionId,configurationHash:prepared.request.intent.configurationHash,modelId:prepared.request.intent.modelId}}}};
 return {original,prepared,f,plan,state,rows,from,rpc,service,controller,trace,options,load:()=>loadSynthesisThematicWorkerInputs(service,original.scope.requestId,controller.signal)};
}
