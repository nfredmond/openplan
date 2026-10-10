// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGtfsOwnedAttempt, type GtfsOwnedWork } from "@/lib/gtfs/managed-worker-attempt";
import type { GtfsDurableMutation } from "@/lib/gtfs/managed-worker-dispatch";
const id=(n:number)=>`ea000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const versionId=id(1), workspaceId=id(2),feedId=id(3),actorId=id(4);
const date="2026-10-09T12:00:00+00:00", until="2026-10-09T12:02:00+00:00";
const terminal=()=>({operation:"fail" as const,input:{code:"partial_write" as const,detail:"Synthetic failure"}});
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"openplan-gtfs-attempt-"));dirs.push(directory);
 const controller=new AbortController();const identity=async()=>JSON.parse(await readFile(join(directory,"pending.json"),"utf8"));
 const command=async(slot:string)=>JSON.parse(await readFile(join(directory,`command-${slot}`,"pending.json"),"utf8"));
 const claim=(token:string)=>({token,version_id:versionId,attempt:1,claimed_at:date,initial_lease_until:until});
 const snapshot=(token:string)=>({schemaVersion:1,versionId,workspaceId,feedId,actorId,requestId:id(5),state:"running",stage:"pending",attempts:1,claim:claim(token),active:true,prepared:false,
  source:{kind:"url",provisionalName:"Synthetic feed",sourceUrl:"https://example.invalid/feed.zip",normalizedSourceUrl:"https://example.invalid/feed.zip"},archive:null,archiveConfirmed:false,plan:null,tract:null,completion:null});
 const native=(rpc:string,args:Record<string,unknown>):unknown=>{
  switch(rpc){
   case "claim_gtfs_ingest":return {claim:claim(String(args.p_token)),active:true};
   case "read_gtfs_ingest_attempt":return snapshot(String(args.p_token));
   case "renew_gtfs_ingest":return true;
   case "stage_gtfs_ingest":return {versionId,stage:args.p_stage};
   case "fail_gtfs_ingest":return {command:args.p_command,version:versionId,state:"failed",closure:{recorded:true,feedStatusChanged:false},cleanupPending:false,closedAt:date};
   case "complete_gtfs_ingest":return {command:args.p_command,version:versionId,status:"ready",routeRows:1,stopRows:1,
    tractOutcome:{command:id(8),version:versionId,computed:true,rows:0,computedAt:date,errorCode:null,errorDetail:null}};
   default:throw new Error("unexpected RPC");
  }
 };
 const respond=vi.fn(async(rpc:string,args:Record<string,unknown>):Promise<unknown>=>native(rpc,args));
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const rpc=String(input).split("/").at(-1)!,args=JSON.parse(String(init?.body));
  expect(args.p_version).toBe(versionId);expect(args.p_token).toBe((await identity()).token);
  return new Response(JSON.stringify(await respond(rpc,args)),{headers:{"Content-Type":"application/json"}});
 });
 const service=createClient("http://127.0.0.1:54321","synthetic-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
 const work=vi.fn<(owned:GtfsOwnedWork)=>Promise<Extract<GtfsDurableMutation,{operation:"complete"|"fail"}>>>(async owned=>{await owned.deliver("stage",{operation:"stage",input:"fetching"});return terminal();});
 const options={directory,target:"http://127.0.0.1:54321",installationId:id(6),versionId,maxCommandBytes:65536,signal:controller.signal,service,renewEveryMs:60_000,work};
 const run=()=>runGtfsOwnedAttempt(options);
 const calls=()=>respond.mock.calls.map(([name])=>name);
 return {directory,controller,identity,command,claim,snapshot,native,respond,fetcher,service,work,options,run,calls};
}
describe("owned GTFS attempt execution",()=>{
 it("delivers explicit completion with its retained artifact and tract evidence",async()=>{
  const f=await fixture();f.work.mockResolvedValue({operation:"complete",input:{
   archive:{path:`${workspaceId}/${feedId}/${versionId}.zip`,sha256:"a".repeat(64),bytes:100},
   plan:{sha256:"b".repeat(64),bytes:100,routeRows:1,stopRows:1,routeBatches:1,stopBatches:1},
   manifest:[{kind:"route",ordinal:0,rows:1,hash:"c".repeat(64)},{kind:"stop",ordinal:0,rows:1,hash:"d".repeat(64)}],
   metadata:{agency_count:1,route_count:1,stop_count:1,trip_count:1,stop_time_row_count:1,calendar_service_count:1,frequency_trip_count:0,scheduled_trip_count:1,parse_warnings:[]},
   tract:{command:id(8),version:versionId,computed:true,rows:0,computedAt:date,errorCode:null,errorDetail:null}
  }});
  await expect(f.run()).resolves.toMatchObject({state:"finished",operation:"complete",result:{receipt:{status:"ready"}}});
  expect((await f.command("terminal")).resolved).toBe(true);expect(f.calls()).not.toContain("fail_gtfs_ingest");
 });
 it("confirms current ownership before work and renewal before a durable terminal write",async()=>{
  const f=await fixture();await expect(f.run()).resolves.toMatchObject({state:"finished",operation:"fail"});
  expect(f.calls()).toEqual(["claim_gtfs_ingest","read_gtfs_ingest_attempt","renew_gtfs_ingest","stage_gtfs_ingest","renew_gtfs_ingest","fail_gtfs_ingest"]);
  const sent=f.respond.mock.calls.at(-1)![1];expect(sent.p_command).toBe((await f.command("terminal")).commandId);
  expect(f.work.mock.calls[0][0].signal.aborted).toBe(true);
 });
 it("does not process an unavailable claim or allocate a replacement token",async()=>{
  const f=await fixture();f.respond.mockResolvedValue(null);expect(await f.run()).toEqual({state:"unavailable"});const original=await f.identity();
  expect(await f.run()).toEqual({state:"unavailable"});expect(await f.identity()).toEqual(original);expect(f.work).not.toHaveBeenCalled();expect(f.calls()).toEqual(["claim_gtfs_ingest","claim_gtfs_ingest"]);
 });
 it.each(["claim","snapshot"])("does not use an inactive %s as ownership",async kind=>{
  const f=await fixture();f.respond.mockImplementation(async(rpc,args)=>{
   const value=f.native(rpc,args);return rpc===(kind==="claim"?"claim_gtfs_ingest":"read_gtfs_ingest_attempt")?{...(value as object),active:false}:value;
  });expect(await f.run()).toMatchObject({state:"not_active"});expect(f.work).not.toHaveBeenCalled();expect(f.calls()).toHaveLength(2);
 });
 it.each(["failed","cancelled","ready"])("observes %s history without processing, renewal or adoption",async state=>{
  const f=await fixture();f.respond.mockImplementation(async(rpc,args)=>{
   if(rpc==="claim_gtfs_ingest")return {claim:f.claim(String(args.p_token)),active:false};
   if(rpc!=="read_gtfs_ingest_attempt")return f.native(rpc,args);
   const value={...f.snapshot(String(args.p_token)),state,stage:state==="ready"?"ready":"failed",active:false};
   if(state!=="ready")return value;
   const tract={command:id(8),version:versionId,computed:true,rows:0,computedAt:date,errorCode:null,errorDetail:null};
   return {...value,archive:{path:`${workspaceId}/${feedId}/${versionId}.zip`,sha256:"a".repeat(64),bytes:100},archiveConfirmed:true,
    plan:{sha256:"a".repeat(64),bytes:100,routeRows:1,stopRows:1,routeBatches:1,stopBatches:1},tract,
    completion:{command:id(9),version:versionId,status:"ready",routeRows:1,stopRows:1,tractOutcome:tract}};
  });expect(await f.run()).toMatchObject({state:"observed_terminal",snapshot:{state}});expect(f.work).not.toHaveBeenCalled();expect(f.calls()).toHaveLength(2);
 });
 it("rejects a changed permanent claim before renewal",async()=>{
  const f=await fixture();f.respond.mockImplementation(async(rpc,args)=>rpc==="read_gtfs_ingest_attempt"?{...f.snapshot(String(args.p_token)),claim:{...f.claim(String(args.p_token)),claimed_at:"2026-10-09T12:00:01+00:00"}}:f.native(rpc,args));
  await expect(f.run()).rejects.toThrow("live claim receipt changed");expect(f.work).not.toHaveBeenCalled();expect(f.calls()).toHaveLength(2);
 });
 it.each([false,null,"error"])("does not begin work after unconfirmed initial renewal %s",async value=>{
  const f=await fixture();f.respond.mockImplementation(async(rpc,args)=>{if(rpc!=="renew_gtfs_ingest")return f.native(rpc,args);if(value==="error")throw new Error("lost reply");return value;});
  await expect(f.run()).rejects.toThrow();expect(f.work).not.toHaveBeenCalled();expect(f.calls()).not.toContain("fail_gtfs_ingest");
 });
 it.each([false,null,"error"])("aborts work on periodic renewal uncertainty %s without inventing failure",async value=>{
  const f=await fixture();f.options.renewEveryMs=5;let renewals=0, observedAbort=false;
  f.respond.mockImplementation(async(rpc,args)=>{if(rpc!=="renew_gtfs_ingest" || ++renewals===1)return f.native(rpc,args);if(value==="error")throw new Error("lost reply");return value;});
  f.work.mockImplementation(async owned=>{await Promise.race([new Promise<void>(resolve=>owned.signal.addEventListener("abort",()=>resolve(),{once:true})),new Promise(resolve=>setTimeout(resolve,100))]);observedAbort=owned.signal.aborted;return terminal();});
  await expect(f.run()).rejects.toThrow();expect(f.calls()).not.toContain("fail_gtfs_ingest");expect(observedAbort).toBe(true);
 });
 it("waits for an in-flight renewal before final renewal and completion",async()=>{
  const f=await fixture();f.options.renewEveryMs=5;let renewals=0;const reached=deferred<void>(),release=deferred<boolean>();
  f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="renew_gtfs_ingest" && ++renewals===2){reached.resolve();return release.promise;}return f.native(rpc,args);});
  f.work.mockImplementation(async()=>{await reached.promise;return terminal();});
  const pending=f.run();await reached.promise;await new Promise(resolve=>setTimeout(resolve,20));
  try {expect(f.calls()).not.toContain("fail_gtfs_ingest");expect(renewals).toBe(2);}
  finally {release.resolve(true);await pending.catch(()=>{});}
  await expect(pending).resolves.toMatchObject({state:"finished"});expect(renewals).toBe(3);
 });
 it("refuses terminal coordination bypass during work",async()=>{
  const f=await fixture();f.work.mockImplementation(async owned=>{await owned.deliver("other",terminal() as never);return terminal();});
  await expect(f.run()).rejects.toThrow("cannot bypass terminal coordination");expect(f.calls()).not.toContain("fail_gtfs_ingest");
 });
 it("reserves the terminal command slot",async()=>{
  const f=await fixture();f.work.mockImplementation(async owned=>{await owned.deliver("terminal",{operation:"stage",input:"fetching"});return terminal();});
  await expect(f.run()).rejects.toThrow("cannot bypass terminal coordination");expect(f.calls()).not.toContain("stage_gtfs_ingest");
 });
 it("refuses work-phase delivery while final renewal is pending",async()=>{
  const f=await fixture();const reached=deferred<void>(),release=deferred<boolean>();let renewals=0,owned:GtfsOwnedWork|undefined;
  f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="renew_gtfs_ingest" && ++renewals===2){reached.resolve();return release.promise;}return f.native(rpc,args);});
  f.work.mockImplementation(async value=>{owned=value;return terminal();});const pending=f.run();await reached.promise;
  try {await expect(owned!.deliver("late",{operation:"stage",input:"fetching"})).rejects.toThrow("work phase is closed");}
  finally {release.resolve(true);await pending;}
 });
 it("cancels unfinished work commands before any terminal write",async()=>{
  const f=await fixture();const reached=deferred<void>();
  f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="stage_gtfs_ingest"){reached.resolve();return new Promise(()=>{});}return f.native(rpc,args);});
  f.work.mockImplementation(async owned=>{void owned.deliver("stage",{operation:"stage",input:"fetching"}).catch(()=>{});await reached.promise;return terminal();});
  await expect(f.run()).rejects.toThrow("unsettled commands");expect(f.calls()).not.toContain("fail_gtfs_ingest");expect((await f.command("stage")).resolved).toBe(false);
 });
 it("requires an explicit valid terminal outcome",async()=>{
  const f=await fixture();f.work.mockResolvedValue({operation:"adopt",input:{routeCount:1,stopCount:1}} as never);
  await expect(f.run()).rejects.toThrow("terminal outcome is invalid");expect(f.calls()).toHaveLength(3);
 });
 it("keeps the terminal input unchanged while renewal settles",async()=>{
  const f=await fixture();const reached=deferred<void>(),release=deferred<boolean>();let renewals=0;const result=terminal();
  f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="renew_gtfs_ingest" && ++renewals===2){reached.resolve();return release.promise;}return f.native(rpc,args);});
  f.work.mockResolvedValue(result);const pending=f.run();await reached.promise;result.input.detail="changed";release.resolve(true);await pending;
  expect(f.respond.mock.calls.at(-1)![1].p_detail).toBe("Synthetic failure");
 });
 it("releases ownership on a work exception without recording a failure",async()=>{
  const f=await fixture();f.work.mockRejectedValueOnce(new Error("artifact unavailable"));await expect(f.run()).rejects.toThrow("artifact unavailable");
  expect(f.calls()).not.toContain("fail_gtfs_ingest");await expect(f.run()).resolves.toMatchObject({state:"finished"});
  const claims=f.respond.mock.calls.filter(([name])=>name==="claim_gtfs_ingest");expect(claims[0][1]).toEqual(claims[1][1]);
 });
 it("retains the terminal command after an unknown acknowledgement",async()=>{
  const f=await fixture();let failed=false;f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="fail_gtfs_ingest"&&!failed){failed=true;throw new Error("lost finish");}return f.native(rpc,args);});
  await expect(f.run()).rejects.toThrow("acknowledgement unavailable");const saved=await f.command("terminal");expect(saved.resolved).toBe(false);
  await f.run();const endings=f.respond.mock.calls.filter(([name])=>name==="fail_gtfs_ingest");expect(endings[0][1]).toEqual(endings[1][1]);expect(f.work).toHaveBeenCalledTimes(1);
 });
 it.each([0,-1,60_001,NaN,Infinity])("refuses unsafe renewal interval %s before claim",async renewEveryMs=>{
  const f=await fixture();f.options.renewEveryMs=renewEveryMs;await expect(f.run()).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled();await expect(f.identity()).rejects.toMatchObject({code:"ENOENT"});
 });
 it("recovers a lost terminal response after the database closes the attempt",async()=>{
  const f=await fixture();let closed=false;
  f.respond.mockImplementation(async(rpc,args)=>{
   if(rpc==="fail_gtfs_ingest"&&!closed){closed=true;throw new Error("lost after commit");}
   if(closed&&rpc==="claim_gtfs_ingest")return {claim:f.claim(String(args.p_token)),active:false};
   if(closed&&rpc==="read_gtfs_ingest_attempt")return {...f.snapshot(String(args.p_token)),state:"failed",stage:"failed",active:false};
   return f.native(rpc,args);
  });
  await expect(f.run()).rejects.toThrow("acknowledgement unavailable");const saved=await f.command("terminal"), offset=f.calls().length;
  await expect(f.run()).resolves.toMatchObject({state:"recovered_terminal",operation:"fail",snapshotBeforeDelivery:{state:"failed"},result:{retained:false,commandId:saved.commandId}});
  expect(f.calls().slice(offset)).toEqual(["claim_gtfs_ingest","read_gtfs_ingest_attempt","fail_gtfs_ingest"]);
  expect((await f.command("terminal")).resolved).toBe(true);expect(f.work).toHaveBeenCalledTimes(1);
 });
 it("keeps an acknowledged receipt separate from the newly observed snapshot",async()=>{
  const f=await fixture();await f.run();const offset=f.calls().length;
  await expect(f.run()).resolves.toMatchObject({state:"recovered_terminal",operation:"fail",snapshotBeforeDelivery:{state:"running"},result:{retained:true}});
  expect(f.calls().slice(offset)).toEqual(["claim_gtfs_ingest","read_gtfs_ingest_attempt"]);expect(f.work).toHaveBeenCalledTimes(1);
 });
 it.each(["context","operation","input"])("refuses changed retained terminal %s before renewal or delivery",async kind=>{
  const f=await fixture();f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="fail_gtfs_ingest")throw new Error("lost");return f.native(rpc,args);});
  await expect(f.run()).rejects.toThrow();const saved=await f.command("terminal");
  if(kind==="context")saved.payload.arguments.context.actorId=id(99);
  if(kind==="operation")saved.payload.operation="stage";
  if(kind==="input")saved.payload.arguments.input.detail="";
  await writeFile(join(f.directory,"command-terminal","pending.json"),JSON.stringify(saved));const offset=f.calls().length;
  if(kind==="context")await expect(f.run()).rejects.toThrow("retained terminal context differs");else await expect(f.run()).rejects.toThrow();
  expect(f.calls().slice(offset)).toEqual(["claim_gtfs_ingest","read_gtfs_ingest_attempt"]);expect(f.work).toHaveBeenCalledTimes(1);
 });

 it.each([false,null,"error"])("preserves an unresolved terminal command after uncertain recovery renewal %s",async value=>{
  const f=await fixture();f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="fail_gtfs_ingest")throw new Error("lost");return f.native(rpc,args);});
  await expect(f.run()).rejects.toThrow();const saved=await f.command("terminal"),offset=f.calls().length;
  f.respond.mockImplementation(async(rpc,args)=>{if(rpc==="renew_gtfs_ingest"){if(value==="error")throw new Error("lost renewal");return value;}return f.native(rpc,args);});
  await expect(f.run()).rejects.toThrow();
  expect(f.calls().slice(offset)).toEqual(["claim_gtfs_ingest","read_gtfs_ingest_attempt","renew_gtfs_ingest"]);
  expect(await f.command("terminal")).toEqual(saved);expect(f.work).toHaveBeenCalledTimes(1);
 });
 it("does not return cached success when the retained claim becomes unavailable",async()=>{
  const f=await fixture();await f.run();const offset=f.calls().length;f.respond.mockResolvedValue(null);
  expect(await f.run()).toEqual({state:"unavailable"});expect(f.calls().slice(offset)).toEqual(["claim_gtfs_ingest"]);
  expect(f.work).toHaveBeenCalledTimes(1);
 });

});
