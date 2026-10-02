// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { synthesisThematicWorkerFixture as fixture } from "./fixtures/engagement/synthesis-thematic-worker";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

describe("thematic worker original input reconstruction",()=>{
 it("compares every original frame and final reference and rechecks current scope",async()=>{
  const f=await fixture(),result=await f.load();expect(result.plan).toEqual(f.plan);expect(result.prepared).toEqual(f.prepared);
  expect(f.options.stateReads).toBe(2);expect(f.original.options.inventoryReads).toBeGreaterThan(0);
  const frames=f.trace.filter(row=>row.table==="engagement_synthesis_thematic_frames");
  expect(frames.map(({signal:_signal,...row})=>row)).toEqual(f.plan.entries.map(frame=>({table:"engagement_synthesis_thematic_frames",columns:"request_id,frame_index,frame_text,frame_sha256,frame_bytes",filters:{request_id:f.f.scope.requestId,frame_index:frame.index}})));
  const tasks=f.trace.filter(row=>row.table==="engagement_synthesis_generation_plan_tasks");expect(tasks).toHaveLength(f.plan.header.taskCount);
  expect(tasks.every(row=>row.columns==="request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256")).toBe(true);
  expect(tasks.at(-1)?.filters).toEqual({request_id:f.f.scope.requestId,task_index:f.plan.header.frameCount});
  expect(f.trace.every(row=>row.signal instanceof AbortSignal)).toBe(true);
 });
 it("refuses replaced request identity before using its scope",async()=>{
  const f=await fixture();f.options.returnedPatch={table:"engagement_synthesis_generation_requests",key:"id",value:f.f.scope.requestId,patch:{id:randomUUID()}};
  await expect(f.load()).rejects.toThrow("inputs differ");expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(["request_id","frame_index","frame_text","frame_sha256","frame_bytes"])("refuses incorrect original frame %s",async field=>{
  const f=await fixture();f.options.returnedPatch={table:"engagement_synthesis_thematic_frames",key:"frame_index",value:0,patch:{[field]:field==="frame_index"||field==="frame_bytes"?1:field==="request_id"?randomUUID():field==="frame_text"?"{}":"0".repeat(64)}};
  await expect(f.load()).rejects.toThrow("inputs differ");
 });
 it("refuses a self-hashed original frame replacement",async()=>{
  const f=await fixture(),frame=f.rows.get("engagement_synthesis_thematic_frames")![0];frame.frame_text='{"SYNTHETIC":"changed"}';frame.frame_sha256=hash(String(frame.frame_text));frame.frame_bytes=Buffer.byteLength(String(frame.frame_text));
  await expect(f.load()).rejects.toThrow("inputs differ");
 });
 it.each(["frameIndex","frameSha256","frameBytes","inputManifestSha256","contentManifestSha256"])("refuses rehashed frame reference %s",async field=>{
  const f=await fixture(),row=f.rows.get("engagement_synthesis_generation_plan_tasks")![0],reference=JSON.parse(String(row.task_text));reference[field]=typeof reference[field]==="number"?reference[field]+1:"0".repeat(64);
  row.task_text=JSON.stringify(reference);row.task_sha256=hash(String(row.task_text));row.task_bytes=Buffer.byteLength(String(row.task_text));await expect(f.load()).rejects.toThrow("inputs differ");
 });
 for(const slot of ["frame","proposal"] as const)it.each(["request_id","task_index","task_text","task_sha256","task_bytes","cumulative_bytes","chain_sha256"])(`refuses ${slot} ledger drift %s`,async field=>{
  const f=await fixture(),index=slot==="frame"?0:f.plan.header.frameCount,row=f.rows.get("engagement_synthesis_generation_plan_tasks")![index];
  f.options.returnedPatch={table:"engagement_synthesis_generation_plan_tasks",key:"task_index",value:index,patch:{[field]:typeof row[field]==="number"?Number(row[field])+1:field==="request_id"?randomUUID():field==="task_text"?"{}":"0".repeat(64)}};
  await expect(f.load()).rejects.toThrow();
 });
 it("refuses a same-length replacement of the original final reference",async()=>{
  const f=await fixture(),row=f.rows.get("engagement_synthesis_generation_plan_tasks")![f.plan.header.frameCount];
  const original=String(row.task_text);row.task_text=original.replace(f.plan.header.inputManifestSha256,"0".repeat(64));
  expect(row.task_text).not.toBe(original);expect(Buffer.byteLength(String(row.task_text))).toBe(row.task_bytes);
  await expect(f.load()).rejects.toThrow("inputs differ");
 });
 it.each(["cancelled","unsealed","cancelled-after-read"])("refuses %s work",async mode=>{
  const f=await fixture();if(mode==="cancelled")f.state.cancelled=true;else if(mode==="unsealed")f.state.seal=null;else f.options.cancelRead=2;
  await expect(f.load()).rejects.toThrow("active sealed plan");if(mode!=="cancelled-after-read")expect(f.trace.some(row=>row.table==="engagement_synthesis_thematic_frames")).toBe(false);
 });
 it("refuses lost current scope and missing original contribution",async()=>{
  const f=await fixture();f.options.failRpc="read_engagement_synthesis_thematic_plan";await expect(f.load()).rejects.toThrow("current scope unavailable");
  f.options.failRpc="";f.original.options.missingTarget=f.original.metadata()[0].targetRecordId;await expect(f.load()).rejects.toThrow();
 });
 it.each(["engagement_synthesis_thematic_frames","engagement_synthesis_generation_plan_tasks"])("refuses failed %s read",async table=>{
  const f=await fixture();f.options.failTable=table;await expect(f.load()).rejects.toThrow("inputs unavailable");
 });
 it("stops an interrupted original frame read",async()=>{
  const f=await fixture();f.options.abortTable="engagement_synthesis_thematic_frames";await expect(f.load()).rejects.toMatchObject({name:"AbortError"});
 });
});
