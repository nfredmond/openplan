// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import * as artifacts from "@/lib/gtfs/managed-worker-artifact";
import { processGtfsRetainedArchive, publishGtfsParsedArtifact } from "@/lib/gtfs/managed-worker-publication";
import type { GtfsOwnedWork } from "@/lib/gtfs/managed-worker-attempt";
import { gtfsWorkerFixture } from "./helpers/gtfs-worker-fixture";

const id=(n:number)=>`ed000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function fixture(){
 const source=await gtfsWorkerFixture(),directory=await mkdtemp(join(tmpdir(),"openplan-gtfs-publication-"));
 cleanup.push(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,"parsed.json"),encoded=Buffer.from(JSON.stringify(source.parsed));await writeFile(path,encoded,{mode:0o600});
 const output=await open(path,"r");cleanup.push(()=>output.close());
 const artifact={output,receipt:{byteSize:encoded.length,sha256:sha(encoded),parsed:true}};
 const snapshot:GtfsOwnedWork["snapshot"]={schemaVersion:1,versionId:id(1),workspaceId:id(2),feedId:id(3),actorId:id(4),requestId:id(5),
  state:"running",stage:"parsing",attempts:1,active:true,prepared:false,
  claim:{token:id(6),version_id:id(1),attempt:1,claimed_at:"2026-10-09T12:00:00Z",initial_lease_until:"2026-10-09T12:02:00Z"},
  source:{kind:"url",provisionalName:"Test feed",sourceUrl:"https://example.invalid/feed.zip",normalizedSourceUrl:"https://example.invalid/feed.zip"},
  archive:{path:`${id(2)}/${id(3)}/${id(1)}.zip`,sha256:sha(source.bytes),bytes:source.bytes.length},archiveConfirmed:true,plan:null,tract:null,completion:null};
 const controller=new AbortController();let sequence=10,computed=true;
 const deliver=vi.fn<GtfsOwnedWork["deliver"]>(async(_slot,mutation)=>{
  const commandId=id(sequence++);
  if(mutation.operation==="prepare_output")return {commandId,retained:false,receipt:{version:id(1),token:id(6),plan:mutation.input,removedRoutes:0,removedStops:0,removedTracts:0}};
  if(mutation.operation==="batch")return {commandId,retained:false,receipt:{command:commandId,rows:mutation.input.rows.length,hash:sha(JSON.stringify(mutation.input.rows))}};
  if(mutation.operation==="tracts")return {commandId,retained:false,receipt:{command:commandId,version:id(1),computed,rows:computed?0:null,computedAt:computed?"2026-10-09T12:00:00Z":null,errorCode:computed?null:"08006",errorDetail:computed?null:"Synthetic unavailable join"}};
  throw new Error("Unexpected mutation");
 });
 const owned={snapshot,signal:controller.signal,deliver},options={maxOutputBytes:65536,batchSize:3};
 const run=()=>publishGtfsParsedArtifact(owned,artifact,options);
 const save=async(value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value));await writeFile(path,bytes);artifact.receipt.byteSize=bytes.length;artifact.receipt.sha256=sha(bytes);};
 return {source,path,artifact,snapshot,controller,deliver,owned,options,run,save,failedTracts:()=>{computed=false;}};
}
describe("GTFS artifact row publication",()=>{
 it("writes complete ordered batches and keeps parser counts separate from service rows",async()=>{
  const f=await fixture(),result=await f.run();expect(result.terminal.operation).toBe("complete");if(result.terminal.operation!=="complete")return;
  const input=result.terminal.input;
  expect(f.deliver.mock.calls.map(c=>c[0])).toEqual(["prepare-output","route-0","route-1","route-2","route-3","route-4","stop-0","stop-1","stop-2","tracts"]);
  expect(input.plan).toEqual({sha256:f.artifact.receipt.sha256,bytes:f.artifact.receipt.byteSize,routeRows:14,stopRows:7,routeBatches:5,stopBatches:3});
  expect(input.manifest.map(x=>[x.kind,x.ordinal,x.rows])).toEqual([["route",0,3],["route",1,3],["route",2,3],["route",3,3],["route",4,2],["stop",0,3],["stop",1,3],["stop",2,1]]);
  const batches=f.deliver.mock.calls.flatMap(([,m])=>m.operation==="batch"?[m.input]:[]);
  expect(input.manifest.map(x=>x.hash)).toEqual(batches.map(b=>sha(JSON.stringify(b.rows))));
  expect(batches.flatMap(b=>b.rows).every(row=>row.workspace_id===id(2)&&row.feed_version_id===id(1))).toBe(true);
  expect(batches.flatMap(b=>b.kind==="stop"?b.rows:[]).every(row=>row.latitude===13.4443&&row.longitude===144.7937)).toBe(true);
  expect(input.metadata).toMatchObject({route_count:1,stop_count:1,agency_count:1,calendar_service_count:1,feed_info_start_date:"20260101",parse_warnings:f.source.parsed.feed.warnings});
  expect(input.tract).toMatchObject({computed:true,rows:0,errorCode:null});
  expect(result.summary).toEqual({routeCount:1,stopCount:1,displayName:"Test publisher",routeServiceLevelRows:14,stopServiceLevelRows:7,droppedForMissingCoordinates:0});
  expect(f.deliver.mock.calls.some(([,m])=>["complete","fail","adopt"].includes(m.operation))).toBe(false);
 });
 it("keeps a failed tract join distinct from zero",async()=>{
  const f=await fixture();f.failedTracts();const result=await f.run();expect(result.terminal).toMatchObject({operation:"complete",input:{tract:{computed:false,rows:null,computedAt:null,errorCode:"08006"}}});
 });
 it("returns the original parser refusal without preparing or writing rows",async()=>{
  const f=await fixture();await f.save({ok:false,code:"missing_required_file",detail:"stops.txt is missing"});f.artifact.receipt.parsed=false;
  expect(await f.run()).toEqual({terminal:{operation:"fail",input:{code:"missing_required_file",detail:"stops.txt is missing"}},summary:null});expect(f.deliver).not.toHaveBeenCalled();
 });
 it.each(["routeServiceLevels","stopServiceLevels"] as const)("refuses an empty mapped %s outcome without deleting existing rows",async field=>{
  const f=await fixture();f.source.parsed.feed[field]=[];await f.save(f.source.parsed);
  expect(await f.run()).toMatchObject({terminal:{operation:"fail",input:{code:"no_usable_service"}},summary:null});expect(f.deliver).not.toHaveBeenCalled();
 });
 it("refuses corrupt file content before any database command",async()=>{
  const f=await fixture();const bytes=Buffer.from(JSON.stringify(f.source.parsed));bytes[0]^=1;await writeFile(f.path,bytes);
  await expect(f.run()).rejects.toThrow("artifact content differs");expect(f.deliver).not.toHaveBeenCalled();
 });
 it("refuses a different file size before any database command",async()=>{
  const f=await fixture();await writeFile(f.path,"{}");await expect(f.run()).rejects.toThrow("artifact size differs");expect(f.deliver).not.toHaveBeenCalled();
 });
 it("refuses a short descriptor read",async()=>{
  const f=await fixture();vi.spyOn(f.artifact.output,"read").mockResolvedValueOnce({bytesRead:0,buffer:Buffer.alloc(0)});
  await expect(f.run()).rejects.toThrow("artifact read is incomplete");expect(f.deliver).not.toHaveBeenCalled();
 });
 it("validates metadata before preparing any replacement output",async()=>{
  const f=await fixture();f.source.parsed.feed.stats.tripRows=2_147_483_648;await f.save(f.source.parsed);
  await expect(f.run()).rejects.toThrow();expect(f.deliver).not.toHaveBeenCalled();
 });
 it("refuses a receipt that calls a parsed feed a failure",async()=>{
  const f=await fixture();f.artifact.receipt.parsed=false;await expect(f.run()).rejects.toThrow("parsed outcome differs");expect(f.deliver).not.toHaveBeenCalled();
 });
 it.each(["command","rows"])("refuses a mismatched batch receipt %s before tract computation",async kind=>{
  const f=await fixture(),normal=f.deliver.getMockImplementation()!;
  f.deliver.mockImplementation(async(slot,m)=>{const result=await normal(slot,m);if(m.operation==="batch")return {...result,receipt:{command:kind==="command"?id(99):result.commandId,rows:kind==="rows"?999:m.input.rows.length,hash:"a".repeat(64)}};return result;});
  await expect(f.run()).rejects.toThrow("batch receipt differs");expect(f.deliver.mock.calls.some(([,m])=>m.operation==="tracts")).toBe(false);
 });
 it("refuses a mismatched tract receipt",async()=>{
  const f=await fixture(),normal=f.deliver.getMockImplementation()!;
  f.deliver.mockImplementation(async(slot,m)=>{const result=await normal(slot,m);return m.operation==="tracts"?{...result,receipt:{command:result.commandId,version:id(99),computed:true,rows:0,computedAt:"2026-10-09T12:00:00Z",errorCode:null,errorDetail:null}}:result;});
  await expect(f.run()).rejects.toThrow("tract scope differs");
 });
 it("preserves an unknown write outcome without inventing a terminal failure",async()=>{
  const f=await fixture(),normal=f.deliver.getMockImplementation()!;
  f.deliver.mockImplementation(async(slot,m)=>{if(slot==="route-1")throw new Error("unknown batch outcome");return normal(slot,m);});
  await expect(f.run()).rejects.toThrow("unknown batch outcome");expect(f.deliver.mock.calls.map(c=>c[0])).toEqual(["prepare-output","route-0","route-1"]);
 });
 it("stops later publication after cancellation during a batch",async()=>{
  const f=await fixture(),normal=f.deliver.getMockImplementation()!;
  f.deliver.mockImplementation(async(slot,m)=>{const result=await normal(slot,m);if(slot==="route-1")f.controller.abort(new Error("ownership lost"));return result;});
  await expect(f.run()).rejects.toThrow("ownership lost");expect(f.deliver.mock.calls.map(c=>c[0])).toEqual(["prepare-output","route-0","route-1"]);
 });
 it("does not publish after an already cancelled attempt",async()=>{
  const f=await fixture();f.controller.abort();await expect(f.run()).rejects.toThrow();expect(f.deliver).not.toHaveBeenCalled();
 });
 it.each([0,1001,-1,NaN])("refuses invalid batch size %s before publication",async batchSize=>{
  const f=await fixture();f.options.batchSize=batchSize;await expect(f.run()).rejects.toThrow();expect(f.deliver).not.toHaveBeenCalled();
 });
 it("enforces the configured output byte bound before reading",async()=>{
  const f=await fixture();f.options.maxOutputBytes=1;const reading=vi.spyOn(f.artifact.output,"read");
  await expect(f.run()).rejects.toThrow();expect(reading).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled();
 });
 it("propagates artifact-lock cancellation through the composed pipeline",async()=>{
  const f=await fixture();const aborted=new AbortController();aborted.abort(new Error("artifact lock lost"));
  const factory=vi.spyOn(artifacts,"withGtfsParsedArtifact").mockImplementation(async(_options,consume)=>consume({...f.artifact,retained:true},aborted.signal));
  try {
   await expect(processGtfsRetainedArchive({directory:f.path,installationId:id(9),target:"http://127.0.0.1:54321",parserBuild:"a".repeat(40),owned:f.owned,
    service:createClient("http://127.0.0.1:54321","synthetic-key"),batchSize:3,
    parser:{maxOutputBytes:65536,maxOldSpaceMb:128,renewEveryMs:100,renewTimeoutMs:100,maxRuntimeMs:8000,terminationGraceMs:100}})).rejects.toThrow("artifact lock lost");
   expect(f.deliver).not.toHaveBeenCalled();
  } finally {factory.mockRestore();}
 });

});
