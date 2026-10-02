// @vitest-environment node
import { describe,expect,it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisThematicStagingPlan,synthesisThematicFrameBatch,verifySynthesisThematicStagingState } from "@/lib/engagement/synthesis-thematic-staging";
import { loadSynthesisThematicPlan,retainSynthesisThematicPlan,readSynthesisThematicPlanState } from "@/lib/engagement/synthesis-thematic-plan-server";
import { thematicStagingFixture,thematicStagingState } from "./fixtures/engagement/synthesis-thematic-staging";
import { thematicProposalInputsFixture } from "./fixtures/engagement/synthesis-thematic-proposal-inputs";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

async function transport() {
 const f=await thematicProposalInputsFixture(), signal=f.f.f.controller.signal;
 const plan=createSynthesisThematicStagingPlan(await loadSynthesisThematicPlan(f.service,f.scope,signal));
 let state=thematicStagingState(plan);
 const calls:Array<{name:string;args:Record<string,unknown>;signal?:AbortSignal}>=[];
 const options={drop:"",stale:false,missingSeal:false,cancel:"",abort:"",change:null as null|((value:typeof state)=>void)};
 const service={from:f.service.from,rpc(name:string,args:Record<string,unknown>){
  if(!["prepare_engagement_synthesis_thematic_plan","stage_engagement_synthesis_thematic_frames","seal_engagement_synthesis_thematic_plan","read_engagement_synthesis_thematic_plan"].includes(name)) return f.service.rpc(name,args);
  const call={name,args,signal:undefined as AbortSignal|undefined};calls.push(call);
  const before=structuredClone(state);
  if(name.startsWith("stage_")) state=thematicStagingState(plan,Number(args.p_start)+JSON.parse(String(args.p_frames_text)).length);
  if(name.startsWith("seal_")&&!options.missingSeal) state=thematicStagingState(plan,plan.entries.length,true);
  if(name===options.cancel) state.cancelled=true;
  const data=structuredClone(options.stale&&name.startsWith("stage_")?before:state);options.change?.(data);
  if(name===options.abort) f.f.f.controller.abort();
  const result=Promise.resolve({data,error:name===options.drop?{code:"NETWORK_UNKNOWN"}:null});
  return Object.assign(result,{abortSignal(signal:AbortSignal){call.signal=signal;return result;}});
 }} as unknown as Pick<SupabaseClient,"rpc"|"from">;
 return {f,plan,calls,options,service,signal,get state(){return state;},run:()=>retainSynthesisThematicPlan(service,f.scope,signal),read:()=>readSynthesisThematicPlanState(service,f.scope,signal)};
}

describe("thematic frame staging protocol",()=>{
 it("chains every original frame and keeps the final proposal as a separate slot",()=>{
  const {plan}=thematicStagingFixture(301);let tail=plan.seedSha256,bytes=0;
  expect(plan.continuation.content.manifest).toBeDefined();expect(plan.entries.length).toBeGreaterThan(128);
  for(const frame of plan.entries){expect(frame.previousSha256).toBe(tail);expect(frame.sha256).toBe(hash(frame.canonical));expect(frame.utf8Bytes).toBe(Buffer.byteLength(frame.canonical));bytes+=frame.utf8Bytes;tail=hash(`${tail}:${frame.index}:${frame.sha256}:${frame.utf8Bytes}`);expect(frame.chainSha256).toBe(tail);expect(frame.cumulativeBytes).toBe(bytes);}
  expect(plan.seedSha256).toBe(hash(`synthesis-thematic-frames-v1:${plan.header.requestId}:${plan.header.continuationHeaderSha256}:${plan.header.inputManifestSha256}:${plan.header.inputSealSha256}`));
  expect(plan.header).toMatchObject({frameCount:plan.entries.length,taskCount:plan.entries.length+1,frameBytes:bytes,tailSha256:tail});
  expect(plan.headerSha256).toBe(hash(plan.headerText));
  let cursor=0;const retained:string[]=[];
  while(cursor<plan.entries.length){const batch=synthesisThematicFrameBatch(plan,cursor)!;expect(batch.start).toBe(cursor);expect(batch.previousSha256).toBe(plan.entries[cursor].previousSha256);const texts=JSON.parse(batch.framesText);expect(texts.length).toBeLessThanOrEqual(128);retained.push(...texts);cursor=batch.nextIndex;}
  expect(retained).toEqual(plan.entries.map(frame=>frame.canonical));expect(synthesisThematicFrameBatch(plan,cursor)).toBeNull();
  expect(()=>synthesisThematicFrameBatch(plan,-1)).toThrow();expect(()=>synthesisThematicFrameBatch(plan,cursor+1)).toThrow();
 });
 it("counts JSON escaping toward the four MiB transport ceiling",()=>{
  const {plan}=thematicStagingFixture();const frame=plan.entries[0];
  plan.entries=Array.from({length:128},(_,index)=>({...frame,index,canonical:JSON.stringify({text:'"'.repeat(300_000)})}));
  const batch=synthesisThematicFrameBatch(plan,0)!;
  expect(batch.nextIndex).toBe(3);expect(Buffer.byteLength(batch.framesText)).toBeLessThanOrEqual(4_194_304);
  expect(Buffer.byteLength(JSON.stringify(plan.entries.slice(0,4).map(f=>f.canonical)))).toBeGreaterThan(4_194_304);
  plan.entries[0].canonical='"'.repeat(4_194_304);expect(()=>synthesisThematicFrameBatch(plan,0)).toThrow("packet limit");
 });
 it("accepts every exact prefix, a final reference and cancellation without granting execution",()=>{
  const {plan}=thematicStagingFixture();
  for(let i=0;i<=plan.entries.length;i++){const state=thematicStagingState(plan,i);expect(verifySynthesisThematicStagingState(plan,state)).toEqual(state);}
  const state=thematicStagingState(plan,plan.entries.length,true);state.cancelled=true;
  expect(verifySynthesisThematicStagingState(plan,state)).toEqual(state);
 });
 it.each(["requestId","campaignId","workspaceId","headerText","headerSha256","nextIndex","frameBytes","tailSha256"])("refuses changed retained %s",key=>{
  const {plan}=thematicStagingFixture();const state=thematicStagingState(plan,1);
  const value=key==="nextIndex"?plan.entries.length+1:key==="frameBytes"?state.frameBytes+1:key.endsWith("Id")?"00000000-0000-4000-8000-000000000099":key.endsWith("Sha256")?"0".repeat(64):"{}";
  expect(()=>verifySynthesisThematicStagingState(plan,{...state,[key]:value})).toThrow();
 });
 it.each(["schemaVersion","requestId","headerSha256","frameCount","taskCount","frameBytes","tailSha256","sealedAt"])("refuses a rehashed receipt with wrong %s",key=>{
  const {plan}=thematicStagingFixture(),state=thematicStagingState(plan,plan.entries.length,true);
  const receipt=JSON.parse(state.seal!.receiptText);receipt[key]=typeof receipt[key]==="number"?receipt[key]+1:"wrong";
  state.seal!.receiptText=JSON.stringify(receipt);state.seal!.receiptSha256=hash(state.seal!.receiptText);
  expect(()=>verifySynthesisThematicStagingState(plan,state)).toThrow();
 });
 it.each(["schemaVersion","purpose","taskIndex","inputManifestSha256","inputSealSha256","continuationHeaderSha256","contentManifestSha256","frameTailSha256"])("refuses a rehashed proposal reference with wrong %s",key=>{
  const {plan}=thematicStagingFixture(),state=thematicStagingState(plan,plan.entries.length,true);
  const receipt=JSON.parse(state.seal!.receiptText),reference=JSON.parse(receipt.proposalReferenceText);reference[key]="wrong";
  receipt.proposalReferenceText=JSON.stringify(reference);receipt.proposalReferenceSha256=hash(receipt.proposalReferenceText);
  state.seal!.receiptText=JSON.stringify(receipt);state.seal!.receiptSha256=hash(state.seal!.receiptText);
  expect(()=>verifySynthesisThematicStagingState(plan,state)).toThrow();
 });
 it("refuses missing frames and broken receipt or proposal checksums",()=>{
  const {plan}=thematicStagingFixture(),state=thematicStagingState(plan,plan.entries.length,true);
  expect(()=>verifySynthesisThematicStagingState(plan,{...thematicStagingState(plan,0),seal:state.seal})).toThrow("incomplete");
  expect(()=>verifySynthesisThematicStagingState(plan,{...state,seal:{...state.seal,receiptSha256:"0".repeat(64)}})).toThrow("corrupt");
  const receipt=JSON.parse(state.seal!.receiptText);receipt.proposalReferenceSha256="0".repeat(64);state.seal!.receiptText=JSON.stringify(receipt);state.seal!.receiptSha256=hash(state.seal!.receiptText);
  expect(()=>verifySynthesisThematicStagingState(plan,state)).toThrow("checksum differs");
 });
});

describe("fresh original replay before native thematic staging",()=>{
 it("stages exact batches with signals, seals once and replays originals on resume",async()=>{
  const f=await transport(),first=await f.run();expect(first.state.seal).not.toBeNull();
  expect(f.calls.map(c=>c.name)).toEqual(["prepare_engagement_synthesis_thematic_plan","stage_engagement_synthesis_thematic_frames","seal_engagement_synthesis_thematic_plan"]);
  expect(f.calls[0].args).toEqual({p_request:f.plan.header.requestId,p_header_text:f.plan.headerText});
  expect(f.calls[1].args).toEqual({p_request:f.plan.header.requestId,p_start:0,p_previous_sha256:f.plan.seedSha256,p_frames_text:JSON.stringify(f.plan.entries.map(e=>e.canonical))});
  expect(f.calls[2].args).toEqual({p_request:f.plan.header.requestId,p_header_sha256:f.plan.headerSha256});
  expect(f.calls.every(c=>c.signal instanceof AbortSignal)).toBe(true);
  const reads=f.f.options.inventoryReads;await f.run();expect(f.f.options.inventoryReads).toBeGreaterThan(reads);expect(f.calls.slice(3).map(c=>c.name)).toEqual(["prepare_engagement_synthesis_thematic_plan"]);
  f.f.options.missingTarget=f.f.metadata()[0].targetRecordId;await expect(f.run()).rejects.toThrow();expect(f.calls).toHaveLength(4);
 });
 it.each(["prepare","stage","seal"])("recovers an unacknowledged %s without replacing retained work",async phase=>{
  const f=await transport();f.options.drop=`${phase}_engagement_synthesis_thematic_${phase==="stage"?"frames":"plan"}`;
  await expect(f.run()).rejects.toThrow("acknowledgement unavailable");const cursor=f.state.nextIndex;f.options.drop="";const before=f.calls.length;
  const result=await f.run();expect(result.state.seal).not.toBeNull();
  expect(f.calls.slice(before).filter(c=>c.name.startsWith("stage_")).every(c=>Number(c.args.p_start)>=cursor)).toBe(true);
 });
 it("checks each native acknowledgement against reconstructed originals",async()=>{
  const f=await transport();f.options.change=value=>{value.tailSha256="0".repeat(64);};
  await expect(f.run()).rejects.toThrow("prefix differs");expect(f.calls).toHaveLength(1);
 });
 it("refuses a stale write acknowledgement and missing completion receipt",async()=>{
  const stale=await transport();stale.options.stale=true;await expect(stale.run()).rejects.toThrow("did not retain");
  const missing=await transport();missing.options.missingSeal=true;await expect(missing.run()).rejects.toThrow("receipt is missing");
 });
 it.each(["prepare","stage"])("stops fresh work after native cancellation during %s",async phase=>{
  const f=await transport();f.options.cancel=`${phase}_engagement_synthesis_thematic_${phase==="stage"?"frames":"plan"}`;
  const result=await f.run();expect(result.state.cancelled).toBe(true);expect(result.state.seal).toBeNull();expect(f.calls.some(c=>c.name.startsWith("seal_"))).toBe(false);
 });
 it("rejects an abort after the final write acknowledgement",async()=>{
  const f=await transport();f.options.abort="seal_engagement_synthesis_thematic_plan";
  await expect(f.run()).rejects.toThrow();expect(f.state.seal).not.toBeNull();
 });
 it("stops after an aborted write and inspects custody through a separately scoped read",async()=>{
  const f=await transport();f.options.abort="stage_engagement_synthesis_thematic_frames";await expect(f.run()).rejects.toThrow();expect(f.calls.some(c=>c.name.startsWith("seal_"))).toBe(false);
  const status=await transport();await status.run();expect(await status.read()).toEqual(status.state);
  status.options.change=value=>{value.workspaceId="00000000-0000-4000-8000-000000000099";};await expect(status.read()).rejects.toThrow("scope differs");
  status.options.change=null;status.options.drop="read_engagement_synthesis_thematic_plan";await expect(status.read()).rejects.toThrow("custody unavailable");
 });
});
