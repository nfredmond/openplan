// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withGtfsAttemptJournal, type GtfsAttemptJournal } from "@/lib/gtfs/managed-worker-journal";
import { deliverGtfsJournalCommand, restoreGtfsTerminalMutation, type GtfsDurableMutation } from "@/lib/gtfs/managed-worker-dispatch";
const id=(n:number)=>`e8000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const context={workspaceId:id(1),feedId:id(2),actorId:id(3)}, versionId=id(4);
const date="2026-10-09T12:00:00.123456+00:00";
const archive={path:`${context.workspaceId}/${context.feedId}/${versionId}.zip`,sha256:"a".repeat(64),bytes:100};
const plan={sha256:"b".repeat(64),bytes:200,routeRows:1,stopRows:1,routeBatches:1,stopBatches:1};
const manifest=[{kind:"route" as const,ordinal:0,rows:1,hash:"c".repeat(64)},{kind:"stop" as const,ordinal:0,rows:1,hash:"d".repeat(64)}];
const tract={command:id(5),version:versionId,computed:true,rows:0,computedAt:date,errorCode:null,errorDetail:null};
const metadata={agency_count:1,route_count:1,stop_count:1,trip_count:1,stop_time_row_count:1,calendar_service_count:1,frequency_trip_count:0,scheduled_trip_count:1,parse_warnings:[]};
const rows=[{workspace_id:context.workspaceId,feed_version_id:versionId,route_id:"R1"}];
const cases: Array<{mutation:GtfsDurableMutation;rpc:string;extra:Record<string,unknown>}>= [
 {mutation:{operation:"stage",input:"parsing"},rpc:"stage_gtfs_ingest",extra:{p_stage:"parsing"}},
 {mutation:{operation:"prepare_archive",input:archive},rpc:"prepare_gtfs_archive",extra:{p_archive:archive}},
 {mutation:{operation:"confirm_archive",input:archive},rpc:"confirm_gtfs_archive",extra:{p_archive:archive}},
 {mutation:{operation:"prepare_output",input:plan},rpc:"prepare_gtfs_derived",extra:{p_plan:plan}},
 {mutation:{operation:"batch",input:{kind:"route",ordinal:0,rows}},rpc:"write_gtfs_ingest_batch",extra:{p_kind:"route",p_ordinal:0,p_rows:rows}},
 {mutation:{operation:"tracts",input:{plan,manifest}},rpc:"compute_managed_gtfs_tracts",extra:{p_plan:plan,p_manifest:manifest}},
 {mutation:{operation:"complete",input:{archive,plan,manifest,metadata,tract}},rpc:"complete_gtfs_ingest",extra:{p_archive:archive,p_plan:plan,p_manifest:manifest,p_metadata:metadata,p_tract_command:tract.command}},
 {mutation:{operation:"fail",input:{code:"partial_write",detail:"Synthetic failure"}},rpc:"fail_gtfs_ingest",extra:{p_code:"partial_write",p_detail:"Synthetic failure"}},
 {mutation:{operation:"adopt",input:{routeCount:1,stopCount:1}},rpc:"adopt_gtfs_ingest",extra:{p_workspace:context.workspaceId,p_actor:context.actorId,p_review:null}},
];
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
function reply(rpc:string,args:Record<string,unknown>):Record<string,unknown>{
 switch(rpc){
  case "stage_gtfs_ingest":return {versionId,stage:args.p_stage};
  case "prepare_gtfs_archive":return {versionId,archive:args.p_archive,preparedAt:date};
  case "confirm_gtfs_archive":return {versionId,archive:args.p_archive,confirmedAt:date};
  case "prepare_gtfs_derived":return {version:versionId,token:args.p_token,plan:args.p_plan,removedRoutes:0,removedStops:0,removedTracts:0};
  case "write_gtfs_ingest_batch":return {command:args.p_command,rows:1,hash:"c".repeat(64)};
  case "compute_managed_gtfs_tracts":return {...tract,command:args.p_command};
  case "complete_gtfs_ingest":return {command:args.p_command,version:versionId,status:"ready",routeRows:1,stopRows:1,tractOutcome:tract};
  case "fail_gtfs_ingest":return {command:args.p_command,version:versionId,state:"failed",closure:{recorded:true,feedStatusChanged:false},cleanupPending:true,closedAt:date};
  case "adopt_gtfs_ingest":return {command:args.p_command,version:versionId,adopted:true,alreadyCurrent:false,reviewAccepted:false,adoptedAt:date,
   basis:{feedId:context.feedId,versionId,routeCount:1,stopCount:1,previousVersionId:null,previousRouteCount:null,previousStopCount:null}};
  default:throw new Error("unexpected RPC");
 }
}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"openplan-gtfs-dispatch-"));dirs.push(directory);
 const options={directory,target:"http://127.0.0.1:54321",installationId:id(6),versionId,maxCommandBytes:65536,signal:new AbortController().signal};
 const path=join(directory,"command-operation","pending.json");
 const saved=async()=>JSON.parse(await readFile(path,"utf8"));
 const identity=async()=>JSON.parse(await readFile(join(directory,"pending.json"),"utf8"));
 const respond=vi.fn(async(rpc:string,args:Record<string,unknown>)=>reply(rpc,args));
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const rpc=String(input).split("/").at(-1)!; const args=JSON.parse(String(init?.body));
  const command=await saved();expect(command.resolved).toBe(false);expect(args.p_version).toBe(versionId);
  if("p_command" in args)expect(args.p_command).toBe(command.commandId);
  if("p_token" in args)expect(args.p_token).toBe((await identity()).token);
  return new Response(JSON.stringify(await respond(rpc,args)),{headers:{"Content-Type":"application/json"}});
 });
 const service=createClient(options.target,"synthetic-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
 const run=(mutation:GtfsDurableMutation)=>withGtfsAttemptJournal(options,j=>deliverGtfsJournalCommand(j,service,context,"operation",mutation));
 return {directory,options,path,saved,identity,respond,fetcher,service,run};
}
function corrupt(raw:Record<string,unknown>){
 return "command" in raw?{...raw,command:id(99)}:"versionId" in raw?{...raw,versionId:id(99)}:{...raw,version:id(99)};
}
describe("durable GTFS operation dispatcher",()=>{
 it.each(cases)("syncs and submits exact $rpc arguments and returns retained history without transport",async c=>{
  const f=await fixture();const pending=f.run(c.mutation);await expect(pending).resolves.toMatchObject({retained:false});
  const first=await pending;const saved=await f.saved(), identity=await f.identity();
  expect(saved.payload).toEqual({operation:c.mutation.operation,arguments:{context,input:c.mutation.input}});
  expect(saved.resolved).toBe(true);expect(first.retained).toBe(false);
  const args={p_version:versionId,...(c.mutation.operation==="adopt"?{}:{p_token:identity.token}),...c.extra,
   ...(["batch","tracts","complete","fail","adopt"].includes(c.mutation.operation)?{p_command:saved.commandId}:{})};
  expect(f.fetcher).toHaveBeenCalledTimes(1);expect(String(f.fetcher.mock.calls[0][0])).toBe(`${f.options.target}/rest/v1/rpc/${c.rpc}`);
  expect(f.fetcher.mock.calls[0][1]?.method).toBe("POST");expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body))).toEqual(args);
  expect(first.receipt).toEqual(reply(c.rpc,args));expect((await f.run(c.mutation))).toEqual({...first,retained:true});expect(f.fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(cases)("leaves an invalid fresh $rpc receipt unresolved",async c=>{
  const f=await fixture();f.respond.mockImplementation(async(rpc,args)=>corrupt(reply(rpc,args)));
  await expect(f.run(c.mutation)).rejects.toThrow();expect((await f.saved()).resolved).toBe(false);
 });
 it.each(cases)("refuses an invalid saved $rpc receipt without transport",async c=>{
  const f=await fixture();await f.run(c.mutation);const saved=await f.saved();saved.receipt=corrupt(saved.receipt);await writeFile(f.path,JSON.stringify(saved));
  await expect(f.run(c.mutation)).rejects.toThrow();expect(f.fetcher).toHaveBeenCalledTimes(1);
 });
 it("retries an uncertain batch with the exact original token, command and arguments",async()=>{
  const f=await fixture();f.respond.mockRejectedValueOnce(new Error("lost after acceptance"));
  await expect(f.run(cases[4].mutation)).rejects.toThrow("acknowledgement unavailable");const first=await f.saved();
  await f.run(cases[4].mutation);expect((await f.saved()).commandId).toBe(first.commandId);
  expect(f.fetcher.mock.calls.map(c=>c[1]?.body)).toEqual([f.fetcher.mock.calls[0][1]?.body,f.fetcher.mock.calls[0][1]?.body]);
 });
 it("validates invalid input before allocating a command",async()=>{
  const f=await fixture();await expect(f.run({operation:"stage",input:"ready" as "parsing"})).rejects.toThrow();
  await expect(stat(join(f.directory,"command-operation"))).rejects.toMatchObject({code:"ENOENT"});expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("refuses unsupported operations before allocating a command",async()=>{
  const f=await fixture();await expect(f.run({operation:"renew",input:{}} as unknown as GtfsDurableMutation)).rejects.toThrow("operation is unsupported");expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("captures caller data before asynchronous journal I/O",async()=>{
  const f2=await fixture();await withGtfsAttemptJournal(f2.options,async j=>{
   const value=structuredClone(cases[4].mutation);const ctx={...context};const pending=deliverGtfsJournalCommand(j,f2.service,ctx,"operation",value);
   if(value.operation==="batch")value.input.ordinal=99;ctx.actorId=id(99);await pending;
  });expect((await f2.saved()).payload.arguments).toEqual({context,input:cases[4].mutation.input});
  expect(JSON.parse(String(f2.fetcher.mock.calls[0][1]?.body)).p_ordinal).toBe(0);
 });
 it("refuses a journal supplying different dispatch data",async()=>{
  const f=await fixture();await expect(withGtfsAttemptJournal(f.options,async j=>{
   const changed: GtfsAttemptJournal={...j,deliver: (slot,payload,delivery)=>j.deliver(slot,payload,{...delivery,
    send:(commandId,retained,signal)=>delivery.send(commandId,{...retained,operation:"fail"},signal)})};
   return deliverGtfsJournalCommand(changed,f.service,context,"operation",cases[4].mutation);
  })).rejects.toThrow("dispatch payload differs");expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("withholds material shrinkage without inserting review acceptance",async()=>{
  const f=await fixture();f.respond.mockImplementation(async(_rpc,args)=>({command:args.p_command,version:versionId,adopted:false,withheld:true,
   basis:{feedId:context.feedId,versionId,routeCount:1,stopCount:1,previousVersionId:id(7),previousRouteCount:10,previousStopCount:10}}));
  expect((await f.run(cases[8].mutation)).receipt).toMatchObject({adopted:false,withheld:true});
  expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body)).p_review).toBeNull();
 });
});


describe("retained GTFS terminal decoding",()=>{
 const scope={...context,versionId,token:id(10)},commandId=id(11);
 const payload=(mutation:GtfsDurableMutation)=>JSON.parse(JSON.stringify({operation:mutation.operation,arguments:{context,input:mutation.input}}));
 it.each([cases[6],cases[7]])("restores validated $rpc input without transport",c=>{
  expect(restoreGtfsTerminalMutation(payload(c.mutation),scope,commandId)).toEqual(c.mutation);
 });
 it.each(["archive","plan","manifest","metadata","tract"])("rejects invalid saved completion %s",field=>{
  const saved=payload(cases[6].mutation);saved.arguments.input[field]=null;
  expect(()=>restoreGtfsTerminalMutation(saved,scope,commandId)).toThrow();
 });
 it("rejects invalid saved failure details",()=>{
  const saved=payload(cases[7].mutation);saved.arguments.input.detail="";
  expect(()=>restoreGtfsTerminalMutation(saved,scope,commandId)).toThrow();
 });
 it("rejects a different submitting actor",()=>{
  const saved=payload(cases[7].mutation);saved.arguments.context.actorId=id(99);
  expect(()=>restoreGtfsTerminalMutation(saved,scope,commandId)).toThrow("retained terminal context differs");
 });
 it.each(["operation","root","arguments","context"])("rejects unsupported retained %s",field=>{
  const saved=payload(cases[7].mutation);
  if(field==="operation")saved.operation="adopt";
  else if(field==="root")saved.extra=true;
  else if(field==="arguments")saved.arguments.extra=true;
  else saved.arguments.context.extra=true;
  expect(()=>restoreGtfsTerminalMutation(saved,scope,commandId)).toThrow();
 });
});
