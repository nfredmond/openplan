// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, chmod, rename, symlink, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withGtfsParsedArtifact, type GtfsArtifactOptions } from "@/lib/gtfs/managed-worker-artifact";
import type { GtfsOwnedWork } from "@/lib/gtfs/managed-worker-attempt";
import { superviseGtfsParse } from "@/lib/gtfs/parse-supervisor";

const io=vi.hoisted(()=>({syncs:[] as string[],zeroRead:false}));
vi.mock("node:fs/promises",async importOriginal=>{
 const actual=await importOriginal<typeof import("node:fs/promises")>();
 return {...actual,open:async(...args:Parameters<typeof actual.open>)=>{
  const file=await actual.open(...args),sync=file.sync.bind(file);
  file.sync=async()=>{io.syncs.push(String(args[0]));await sync();};
  if(io.zeroRead&&String(args[0]).endsWith("archive.zip")){io.zeroRead=false;vi.spyOn(file,"read").mockResolvedValueOnce({bytesRead:0,buffer:Buffer.alloc(0)});}
  return file;
 }};
});
vi.mock("@/lib/gtfs/parse-supervisor",()=>({superviseGtfsParse:vi.fn()}));
const parse=vi.mocked(superviseGtfsParse);
const id=(n:number)=>`eb000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const directories:string[]=[];
afterEach(async()=>{for(const d of directories.splice(0))await rm(d,{recursive:true,force:true});vi.clearAllMocks();io.syncs=[];io.zeroRead=false;});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"openplan-gtfs-artifact-"));directories.push(directory);
 const bytes=Buffer.from("synthetic archive"), encoded=Buffer.from(JSON.stringify({ok:false,code:"not_a_zip",detail:"Synthetic refusal"}));
 const archive={path:`${id(2)}/${id(3)}/${id(1)}.zip`,sha256:sha(bytes),bytes:bytes.length};
 const controller=new AbortController();
 const snapshot: GtfsOwnedWork["snapshot"]={schemaVersion:1,versionId:id(1),workspaceId:id(2),feedId:id(3),actorId:id(4),requestId:id(5),state:"running",stage:"pending",attempts:1,
  claim:{token:id(6),version_id:id(1),attempt:1,claimed_at:"2026-10-09T12:00:00Z",initial_lease_until:"2026-10-09T12:02:00Z"},active:true,prepared:false,
  source:{kind:"url",provisionalName:"Synthetic feed",sourceUrl:"https://example.invalid/feed.zip",normalizedSourceUrl:"https://example.invalid/feed.zip"},archive,archiveConfirmed:false,plan:null,tract:null,completion:null};
 const calls:string[]=[];
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);calls.push(url);
  if(url.endsWith('/rpc/renew_gtfs_ingest')){
   expect(JSON.parse(String(init?.body))).toEqual({p_version:id(1),p_token:id(6)});
   return new Response('true',{headers:{'Content-Type':'application/json'}});
  }
  expect(url).toBe(`http://127.0.0.1:54321/storage/v1/object/gtfs-uploads/${archive.path}`);
  expect(JSON.parse(await readFile(join(directory,"pending.json"),"utf8")).binding.archive).toEqual(archive);
  return new Response(bytes,{headers:{'Content-Type':'application/zip'}});
 });
 const service=createClient("http://127.0.0.1:54321","synthetic-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
 const deliver=vi.fn<GtfsOwnedWork["deliver"]>(async()=>({commandId:id(7),receipt:{versionId:id(1),stage:"parsing"},retained:false}));
 const owned={snapshot,signal:controller.signal,deliver};
 const options:GtfsArtifactOptions={directory,installationId:id(8),target:"http://127.0.0.1:54321",parserBuild:"a".repeat(40),owned,service,env:{},
  parser:{maxOutputBytes:65536,maxOldSpaceMb:128,renewEveryMs:30_000,renewTimeoutMs:1000,maxRuntimeMs:8000,terminationGraceMs:100}};
 parse.mockImplementation(async value=>{
  expect(await value.archive.readFile()).toEqual(bytes);
  expect(await value.renew(value.signal)).toBe(true);
  await value.output.writeFile(encoded);
  return {ok:true,receipt:{byteSize:encoded.length,sha256:sha(encoded),parsed:false}};
 });
 const consume=vi.fn(async({output,receipt,retained}:Parameters<Parameters<typeof withGtfsParsedArtifact>[1]>[0],signal:AbortSignal)=>{
  expect(signal.aborted).toBe(false);expect((await output.stat()).mode&0o777).toBe(0o600);
  return {content:await output.readFile("utf8"),receipt,retained};
 });
 const run=()=>withGtfsParsedArtifact(options,consume);
 const saved=async()=>JSON.parse(await readFile(join(directory,"pending.json"),"utf8"));
 const save=async(value:unknown)=>writeFile(join(directory,"pending.json"),JSON.stringify(value));
 return {directory,bytes,encoded,archive,controller,snapshot,fetcher,calls,deliver,options,consume,run,saved,save};
}

describe("managed GTFS parser artifact custody",()=>{
 it("binds Storage bytes, confirms custody, parses through descriptors and reuses the checked output",async()=>{
  const f=await fixture();const first=await f.run();expect(first).toEqual({content:f.encoded.toString(),receipt:{byteSize:f.encoded.length,sha256:sha(f.encoded),parsed:false},retained:false});
  expect(f.deliver.mock.calls).toEqual([["archive-confirmation",{operation:"confirm_archive",input:f.archive}],["parsing",{operation:"stage",input:"parsing"}]]);
  expect((await stat(join(f.directory,"archive.zip"))).mode&0o777).toBe(0o600);
  const saved=await f.saved();expect(saved.output.receipt).toEqual(first.receipt);
  const offset=f.calls.length;expect(await f.run()).toEqual({...first,retained:true});
  expect(parse).toHaveBeenCalledTimes(1);expect(f.calls.slice(offset)).toEqual(["http://127.0.0.1:54321/rest/v1/rpc/renew_gtfs_ingest"]);
  expect(await f.saved()).toEqual(saved);
  await expect(f.consume.mock.calls[0][0].output.stat()).rejects.toThrow();expect(f.consume.mock.calls[0][1].aborted).toBe(true);
 });
 it("retains a successful parser artifact without declaring database completion",async()=>{
  const f=await fixture();parse.mockImplementation(async value=>{await value.output.writeFile(f.encoded);return {ok:true,receipt:{byteSize:f.encoded.length,sha256:sha(f.encoded),parsed:true}};});
  expect((await f.run()).receipt.parsed).toBe(true);expect(f.deliver.mock.calls.map(c=>c[1].operation)).toEqual(["confirm_archive","stage"]);
 });
 it.each(["token","installation","build","limits","archive"])("refuses changed %s binding on recovery",async field=>{
  const f=await fixture();await f.run();const saved=await f.saved();
  if(field==="token")saved.binding.token=id(99);if(field==="installation")saved.binding.installationId=id(99);
  if(field==="build")saved.binding.parserBuild="b".repeat(40);if(field==="limits")saved.binding.limits.parseBudgetMs++;
  if(field==="archive")saved.binding.archive.sha256="0".repeat(64);await f.save(saved);
  await expect(f.run()).rejects.toThrow("artifact binding differs");expect(parse).toHaveBeenCalledTimes(1);expect(f.consume).toHaveBeenCalledTimes(1);
 });
 it.each(["archive","output"])("rejects corrupt retained %s without refetching or reparsing",async kind=>{
  const f=await fixture();await f.run();const saved=await f.saved();const path=join(f.directory,kind==="archive"?"archive.zip":saved.output.name);
  const original=await readFile(path);original[0]^=1;await writeFile(path,original);
  const offset=f.calls.length;await expect(f.run()).rejects.toThrow("artifact content differs");
  expect(f.calls.slice(offset)).toHaveLength(1);expect(parse).toHaveBeenCalledTimes(1);expect(f.consume).toHaveBeenCalledTimes(1);
 });
 it("rejects truncated output",async()=>{
  const f=await fixture();await f.run();await writeFile(join(f.directory,(await f.saved()).output.name),"short");
  await expect(f.run()).rejects.toThrow("artifact size differs");expect(f.consume).toHaveBeenCalledTimes(1);
 });
 it.each(["public","symlink"])("refuses %s retained files",async kind=>{
  const f=await fixture();await f.run();const path=join(f.directory,(await f.saved()).output.name);
  if(kind==="public")await chmod(path,0o644);else {await rename(path,`${path}.original`);await symlink(`${path}.original`,path);}
  await expect(f.run()).rejects.toThrow();expect(f.consume).toHaveBeenCalledTimes(1);
 });
 it("does not replace a missing archive after output was committed",async()=>{
  const f=await fixture();await f.run();await rm(join(f.directory,"archive.zip"));const offset=f.calls.length;
  await expect(f.run()).rejects.toMatchObject({code:"ENOENT"});expect(f.calls.slice(offset)).toHaveLength(1);expect(parse).toHaveBeenCalledTimes(1);
 });
 it("does not replace a missing acknowledged output",async()=>{
  const f=await fixture();await f.run();await rm(join(f.directory,(await f.saved()).output.name));
  await expect(f.run()).rejects.toMatchObject({code:"ENOENT"});expect(parse).toHaveBeenCalledTimes(1);
 });
 it("leaves an interrupted parse uncommitted and restarts from its retained archive",async()=>{
  const f=await fixture();const normal=parse.getMockImplementation()!;parse.mockResolvedValueOnce({ok:false,reason:"ownership_unconfirmed"});
  await expect(f.run()).rejects.toThrow("artifact parsing was interrupted");expect((await f.saved()).output).toBeNull();expect(f.consume).not.toHaveBeenCalled();
  parse.mockImplementation(normal);await f.run();expect(f.calls.filter(url=>url.includes('/storage/'))).toHaveLength(1);
 });
 it("refuses unconfirmed Storage bytes before confirming the archive",async()=>{
  const f=await fixture();const normal=f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async(input,init)=>String(input).includes('/storage/')?new Response('changed'):normal(input,init));
  await expect(f.run()).rejects.toThrow("retained archive could not be verified");expect(f.deliver).not.toHaveBeenCalled();expect(parse).not.toHaveBeenCalled();
 });
 it("refuses an unconfirmed renewal before reading cached output",async()=>{
  const f=await fixture();await f.run();f.fetcher.mockResolvedValue(new Response('false',{headers:{'Content-Type':'application/json'}}));
  await expect(f.run()).rejects.toThrow("artifact ownership is unconfirmed");expect(f.consume).toHaveBeenCalledTimes(1);
 });
 it.each(["inactive","no-archive","cancelled"])("refuses %s work before I/O",async kind=>{
  const f=await fixture();if(kind==="inactive")f.snapshot.active=false;if(kind==="no-archive")f.snapshot.archive=null;if(kind==="cancelled")f.controller.abort();
  await expect(f.run()).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled();expect(await readdir(f.directory)).toEqual([]);
 });
 it("refuses an archive above the configured bound before I/O",async()=>{
  const f=await fixture();f.options.env={OPENPLAN_GTFS_MAX_ARCHIVE_BYTES:"1"};
  await expect(f.run()).rejects.toThrow("archive exceeds configured bound");expect(f.fetcher).not.toHaveBeenCalled();
 });
 it.each(["fresh","saved"])("refuses %s output beyond its bound",async kind=>{
  const f=await fixture();if(kind==="fresh")f.options.parser.maxOutputBytes=1;else {await f.run();const saved=await f.saved();saved.output.receipt.byteSize=65537;await f.save(saved);}
  await expect(f.run()).rejects.toThrow("output exceeds configured bound");expect(f.consume).toHaveBeenCalledTimes(kind==="fresh"?0:1);
  if(kind==="fresh")expect((await f.saved()).output).toBeNull();
 });
 it("releases descriptors and the lock when consumption throws",async()=>{
  const f=await fixture();f.consume.mockRejectedValueOnce(new Error("downstream unavailable"));await expect(f.run()).rejects.toThrow("downstream unavailable");
  await expect(f.consume.mock.calls[0][0].output.stat()).rejects.toThrow();await expect(f.run()).resolves.toMatchObject({retained:true});expect(parse).toHaveBeenCalledTimes(1);
 });
 it("refuses concurrent artifact work",async()=>{
  const f=await fixture();let reached!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>{reached=r;}),hold=new Promise<void>(r=>{release=r;});
  f.consume.mockImplementationOnce(async()=>{reached();await hold;return {content:"",receipt:{byteSize:1,sha256:"a".repeat(64),parsed:false},retained:false};});
  const pending=f.run();await Promise.race([ready,pending.then(()=>{throw new Error("consumption was not reached");})]);try{await expect(f.run()).rejects.toThrow("connector_already_running");}finally{release();await pending;}
 });
 it.each(["https://user:password@example.invalid","file:///tmp/archive"])("refuses unsupported target %s",async target=>{
  const f=await fixture();f.options.target=target;await expect(f.run()).rejects.toThrow("artifact target is invalid");expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("syncs archive and output before retaining their completion record",async()=>{
  const f=await fixture();await f.run();const names=io.syncs.map(p=>p.slice(f.directory.length+1));
  const archiveSync=names.findIndex(n=>n.startsWith("archive-")),outputSync=names.findIndex(n=>n.startsWith("parsed-"));
  const recordSync=names.findLastIndex(n=>n.startsWith("pending-"));
  expect(archiveSync).toBeGreaterThanOrEqual(0);expect(outputSync).toBeGreaterThan(archiveSync);expect(recordSync).toBeGreaterThan(outputSync);
  expect(io.syncs.slice(outputSync+1,recordSync)).toContain(f.directory);expect(io.syncs.at(-1)).toBe(f.directory);
 });
 it("rejects a short local read without substituting different bytes",async()=>{
  const f=await fixture();await f.run();io.zeroRead=true;await expect(f.run()).rejects.toThrow("artifact read is incomplete");expect(f.consume).toHaveBeenCalledTimes(1);
 });
 it("does not commit output after cancellation during parsing",async()=>{
  const f=await fixture();parse.mockImplementation(async value=>{await value.output.writeFile(f.encoded);f.controller.abort(new Error("ownership lost"));return {ok:true,receipt:{byteSize:f.encoded.length,sha256:sha(f.encoded),parsed:false}};});
  await expect(f.run()).rejects.toThrow("ownership lost");expect((await f.saved()).output).toBeNull();expect(f.consume).not.toHaveBeenCalled();
 });
 it("rejects a retained output name that leaves its private directory",async()=>{
  const f=await fixture();await f.run();const saved=await f.saved();
  const outside=await mkdtemp(join(tmpdir(),"openplan-artifact-outside-"));directories.push(outside);
  await writeFile(join(outside,"other.json"),f.encoded,{mode:0o600});
  saved.output.name=`../${outside.split("/").at(-1)}/other.json`;await f.save(saved);
  await expect(f.run()).rejects.toThrow();expect(f.consume).toHaveBeenCalledTimes(1);
 });

 it.each(["root","binding","archive","output","receipt"])("rejects unknown saved %s fields",async field=>{
  const f=await fixture();await f.run();const saved=await f.saved();
  const target=field==="root"?saved:field==="binding"?saved.binding:field==="archive"?saved.binding.archive:field==="output"?saved.output:saved.output.receipt;
  target.extra=true;await f.save(saved);await expect(f.run()).rejects.toThrow();expect(f.consume).toHaveBeenCalledTimes(1);
 });
 it.each(["installation","build","output-bound"])("rejects invalid %s configuration before I/O",async field=>{
  const f=await fixture();if(field==="installation")f.options.installationId="bad";
  if(field==="build")f.options.parserBuild="unknown";if(field==="output-bound")f.options.parser.maxOutputBytes=0;
  await expect(f.run()).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled();
 });

});
