// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { synthesisThematicHistoryFixture as fixture } from "./fixtures/engagement/synthesis-thematic-history";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";
import { createSynthesisThematicContent, reconstructSynthesisThematicContent } from "@/lib/engagement/synthesis-thematic-content";
import { createSynthesisThematicContinuation, replaySynthesisThematicContinuation } from "@/lib/engagement/synthesis-thematic-continuation";

describe("current-staff thematic historical inputs",()=>{
  it("reconstructs identical original content and keeps cancellation out of fresh work",async()=>{
    const f=await fixture();f.cancel();const pending=f.loadInputs();await expect(pending).resolves.toMatchObject({preparationStatus:"sealed"});const inputs=await pending;if(inputs.preparationStatus==="inputs_not_sealed")throw new Error("Missing input seal");
    expect(inputs.prepared.originals).toEqual(f.prepared.originals);expect(inputs.plan.headerText).toBe(f.plan.headerText);
    expect(()=>createSynthesisThematicContent(inputs.prepared)).toThrow("cancelled");
    expect(()=>createSynthesisThematicContinuation(inputs.prepared)).toThrow("cancelled");
    expect(reconstructSynthesisThematicContent(inputs.prepared).request.state.cancellation).toEqual(f.request.cancellation);
    const replay=replaySynthesisThematicContinuation(inputs.prepared,f.history.map(row=>row.result));expect(replay.next().status).toBe("proposal_complete");
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });
  it.each(["inputs_not_sealed","not_prepared","staging"])("keeps %s distinct from a completed proposal",async status=>{
    const f=await fixture();
    if(status==="inputs_not_sealed")f.historyOptions.missingSeal=true;
    else {f.rows.set("engagement_synthesis_generation_plan_seals",[]);if(status==="not_prepared")f.rows.set("engagement_synthesis_generation_plans",[]);}
    const pending=f.load(123);await expect(pending).resolves.toMatchObject({manifest:{status}});const result=await pending;expect(result.manifest.status).toBe(status);expect(result.proposal).toBeNull();expect(result.manifest.verifiedTaskCount).toBe(0);expect(result.manifest.throughSequence).toBeNull();
    if(status==="inputs_not_sealed")expect(f.trace).toHaveLength(0);
  });
  it.each(["read_engagement_synthesis_thematic_request","read_engagement_synthesis_thematic_input_seal_history","read_engagement_synthesis_sources","read_engagement_synthesis_thematic_choice","read_engagement_synthesis_thematic_input_history"])("refuses failed authenticated %s",async name=>{
    const f=await fixture();f.historyOptions.denied=name;f.historyOptions.deniedCall=1;await expect(f.loadInputs()).rejects.toThrow("unavailable");
  });
  it("rechecks current staff access after staging",async()=>{
    const f=await fixture();f.historyOptions.denyRequestRead=4;await expect(f.loadInputs()).rejects.toThrow("Thematic request unavailable");
    expect(f.trace.some(row=>row.table==="engagement_synthesis_generation_plan_tasks"&&row.filters.task_index===f.plan.header.frameCount)).toBe(true);
  });
  it("refuses request identity drift at final input recheck",async()=>{
    const f=await fixture();f.historyOptions.change=(name,data)=>{if(name==="read_engagement_synthesis_thematic_request"&&f.historyOptions.requestReads===4){const row=data as typeof f.request;row.request.actorId=randomUUID();}return data;};
    await expect(f.loadInputs()).rejects.toThrow("Historical thematic inputs differ");
  });
  it.each(["checksum","scope","vanished"])("refuses changed cancellation %s",async field=>{
    const f=await fixture();f.cancel();const row=f.request.cancellation as {receiptText:string;receiptSha256:string};
    if(field==="checksum")row.receiptSha256="0".repeat(64);
    if(field==="scope"){row.receiptText=JSON.stringify({...JSON.parse(row.receiptText),requestId:randomUUID()});row.receiptSha256=hash(row.receiptText);}
    if(field==="vanished")f.historyOptions.before=name=>{if(name==="read_engagement_synthesis_thematic_request"&&f.historyOptions.requestReads===3)f.request.cancellation=null;};
    await expect(f.loadInputs()).rejects.toThrow();
  });
  it("compares original context bytes even when the retained proof self-hash is valid",async()=>{
    const f=await fixture(),record=[...f.original.records.values()][0];record.outputText='{"notes":[],"uncertainties":["SYNTHETIC substituted"]}';record.outputSha256=hash(record.outputText);
    record.proofText=JSON.stringify({...JSON.parse(record.proofText),outputSha256:record.outputSha256});record.proofSha256=hash(record.proofText);
    Object.assign(f.seal,f.original.makeSeal());f.rows.set("engagement_synthesis_generation_plans",[]);f.rows.set("engagement_synthesis_generation_plan_seals",[]);
    await expect(f.loadInputs()).rejects.toThrow("Historical thematic inputs differ");
  });
  it.each(["createdBy","historyManifestSha256","finalCaptureSha256","finalResultSha256","selectionSequence"])("refuses pinned choice drift %s",async field=>{
    const f=await fixture(),choice=f.original.f.bundle.choice;
    if(field==="createdBy")choice.createdBy=randomUUID();else {choice.choiceText=JSON.stringify({...JSON.parse(choice.choiceText),[field]:field==="selectionSequence"?0:"0".repeat(64)});choice.choiceSha256=hash(choice.choiceText);}
    await expect(f.loadInputs()).rejects.toThrow("Historical thematic inputs differ");
  });
  it.each(["header","seal","frame-text","frame-index","frame-bytes","task-hash","task-bytes","task-chain","reference","final-text","final-bytes"])("refuses original staging drift %s",async field=>{
    const f=await fixture(),frame=f.rows.get("engagement_synthesis_thematic_frames")![0],task=f.rows.get("engagement_synthesis_generation_plan_tasks")![0],final=f.rows.get("engagement_synthesis_generation_plan_tasks")!.at(-1)!;
    if(field==="header")f.planRow.header_text+=" ";if(field==="seal")f.sealRow.receipt_sha256="0".repeat(64);
    if(field==="frame-text")frame.frame_text+=" ";if(field==="frame-index")f.options.returnedPatch={table:"engagement_synthesis_thematic_frames",key:"frame_index",value:0,patch:{frame_index:1}};
    if(field==="frame-bytes")frame.frame_bytes=1;if(field==="task-hash")task.task_sha256="0".repeat(64);if(field==="task-bytes")task.task_bytes=1;if(field==="task-chain")task.chain_sha256="0".repeat(64);
    if(field==="reference"){task.task_text=JSON.stringify({...JSON.parse(String(task.task_text)),contentManifestSha256:"0".repeat(64)});task.task_sha256=hash(String(task.task_text));task.task_bytes=Buffer.byteLength(String(task.task_text));}
    if(field==="final-text")final.task_text=String(final.task_text).replace('private','PRIVATE');if(field==="final-bytes")final.task_bytes=1;
    await expect(f.loadInputs()).rejects.toThrow();
  });
  it("refuses a gap in a sealed original frame chain",async()=>{
    const f=await fixture();f.rows.set("engagement_synthesis_thematic_frames",f.rows.get("engagement_synthesis_thematic_frames")!.slice(1));
    await expect(f.loadInputs()).rejects.toThrow();
  });
  it("observes abort before private history",async()=>{
    const f=await fixture();f.controller.abort();await expect(f.loadInputs()).rejects.toThrow();expect(f.calls).toHaveLength(0);expect(f.trace).toHaveLength(0);
  });
  it.each(["manifestText","manifestSha256","receiptText","receiptSha256"] as const)("refuses corrupt input seal %s",async field=>{
    const f=await fixture();f.seal[field]+="0";await expect(f.loadInputs()).rejects.toThrow();
  });
  it.each(["choice","input"])("refuses missing sealed %s",async kind=>{
    const f=await fixture();f.historyOptions.change=(name,data)=>name===`read_engagement_synthesis_thematic_${kind=== "choice"?"choice":"input_history"}`?null:data;
    await expect(f.loadInputs()).rejects.toThrow("sealed input is missing");
  });
  it("checks immutable input seal again after context replay",async()=>{
    const f=await fixture();let reads=0;f.historyOptions.change=(name,data)=>{if(name==="read_engagement_synthesis_thematic_input_seal_history"&&++reads===2){const seal=data as typeof f.seal;seal.receiptText=JSON.stringify({...JSON.parse(seal.receiptText),sealedAt:"2026-09-30T11:00:00Z"});seal.receiptSha256=hash(seal.receiptText);}return data;};
    await expect(f.loadInputs()).rejects.toThrow("Historical thematic inputs differ");
  });
  it("refuses storage errors before returning private inputs",async()=>{
    const f=await fixture();f.options.failTable="engagement_synthesis_thematic_frames";await expect(f.loadInputs()).rejects.toThrow("Historical thematic staging unavailable");
  });
  it("uses exact explicit original staging projections",async()=>{
    const f=await fixture();await expect(f.loadInputs()).resolves.toMatchObject({preparationStatus:"sealed"});
    const columns={engagement_synthesis_generation_plan_seals:"request_id,receipt_text,receipt_sha256",engagement_synthesis_generation_plans:"request_id,header_text,header_sha256",
      engagement_synthesis_thematic_frames:"request_id,frame_index,frame_text,frame_sha256,frame_bytes",engagement_synthesis_generation_plan_tasks:"request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256"};
    for(const [table,projection] of Object.entries(columns)){
      const reads=f.trace.filter(row=>row.table===table);expect(reads.length).toBe(table.endsWith("frames")?f.plan.header.frameCount:table.endsWith("tasks")?f.plan.header.taskCount:1);
      expect(reads.every(row=>row.columns===projection&&row.filters.request_id===f.scope.requestId)).toBe(true);
    }
    expect(f.calls.filter(row=>row.name==="read_engagement_synthesis_thematic_input_seal_history").map(row=>row.parameters)).toEqual(Array(2).fill({p_campaign:f.scope.campaignId,p_request:f.scope.requestId}));
  });

});
