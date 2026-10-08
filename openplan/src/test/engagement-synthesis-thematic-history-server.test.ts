// @vitest-environment node
import * as continuation from "@/lib/engagement/synthesis-thematic-continuation";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesisThematicHistoryFixture as fixture } from "./fixtures/engagement/synthesis-thematic-history";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

afterEach(() => vi.restoreAllMocks());

describe("current-staff thematic original proposal history", () => {
  it("does not use output with a changed predecessor to assess later task bytes", async () => {
    const f = await fixture(), second = f.history[1];
    second.output.uncertainties.push(...Array.from({ length: 18 }, () => "😀".repeat(1900)));
    second.recapture();
    const valid = await f.load(2);
    expect(valid.resourceAssessment?.taskIndex).toBe(2);
    second.input.predecessor_selection_id = randomUUID();
    const changed = await f.load(2);
    expect(changed.entries[1].status).toBe("predecessor_changed");
    expect(changed.resourceAssessment).toBeNull();
    expect(changed.entries[1].captureSha256).toBe(second.outputRow.capture_sha256);
  });

  it("measures retained Unicode output before any next attempt and drops it when its selection is cleared", async () => {
    const f = await fixture(), first = f.history[0];
    first.output.uncertainties = Array.from({ length: 20 }, () => "😀".repeat(1900));
    first.recapture();
    const value = await f.load(1);
    expect(value.entries[0].status).toBe("verified");
    expect(value.entries[1].status).toBe("unselected");
    expect(value.resourceAssessment?.taskIndex).toBe(1);
    expect(value.resourceAssessment?.requiredTaskBytes).toBeGreaterThan(value.resourceAssessment?.taskByteLimit ?? Infinity);
    expect(value.entries[0].capture?.capture.outputText).toBe(JSON.stringify(first.output));
    Object.assign(first.selection, { attemptId: null, origin: "staff", authorizationId: null, previousSelectionId: randomUUID() });
    const cleared = await f.load(1);
    expect(cleared.entries[0].status).toBe("cleared");
    expect(cleared.resourceAssessment).toBeNull();
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });

  it.each([0, 1])("assesses the next oversized task after %i selected outputs without replacing attempt state", async selectedCount => {
    const f = await fixture();
    const create = continuation.replaySynthesisThematicContinuation;
    vi.spyOn(continuation, "replaySynthesisThematicContinuation").mockImplementation((...args) => {
      const processor = create(...args);
      return { ...processor, next: () => {
        const next = processor.next();
        return next.status === "ready" && next.taskIndex === selectedCount
          ? { status: "resource_limit" as const, taskIndex: selectedCount, requiredTaskBytes: 68699,
            taskByteLimit: 65536, previousResultSha256: next.previousResultSha256, stage: next.stage }
          : next;
      } };
    });
    const value = await f.load(selectedCount);
    expect(value.resourceAssessment).toEqual({ taskIndex: selectedCount, requiredTaskBytes: 68699, taskByteLimit: 65536 });
    expect(value.entries[selectedCount].status).toBe("unselected");
    expect(value.entries[selectedCount].attemptId).toBeNull();
    expect(value.manifest.entries[selectedCount]).not.toHaveProperty("resourceAssessment");
    expect(value.sha256).toBe(hash(value.canonical));
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });

  it("replays every original frame and final proposal without current execution scope", async () => {
    const f = await fixture(), pending = f.load(); await expect(pending).resolves.toMatchObject({manifest:{status:"proposal_complete"}}); const result = await pending;
    expect(result.manifest.status).toBe("proposal_complete"); expect(result.manifest.verifiedTaskCount).toBe(f.plan.header.taskCount);
    expect(result.entries).toHaveLength(f.plan.header.taskCount); expect(result.entries.every(entry => entry.status === "verified")).toBe(true);
    expect(result.finalOutputText).toBe(JSON.stringify(f.final.output)); expect(result.proposal?.content.unassignedSourceIds).toEqual(f.prepared.input.contexts.map(row => row.sourceId));
    expect(result.interpretation).toBe("machine_unreviewed"); expect(result.sha256).toBe(hash(result.canonical));
    expect(f.serviceRpc).not.toHaveBeenCalled();
  });
  it("preserves a cancelled request while replaying its original proposal", async () => {
    const f = await fixture(); f.cancel(); const result = await f.load();
    expect(result.manifest.status).toBe("proposal_complete"); expect(result.request.state.cancellation).toEqual(f.request.cancellation);
    expect(result.plan?.continuation.content.request.state.cancellation).toEqual(f.request.cancellation);
  });
  it("keeps fixed history pagination and explicit original projections", async () => {
    const f=await fixture();f.historyOptions.pageSize=1;const result=await f.load();
    const pages=f.calls.filter(call=>call.name==="read_engagement_synthesis_generation_selection_history"&&call.parameters.p_request===f.scope.requestId);
    expect(pages).toHaveLength(f.plan.header.taskCount);
    expect(pages.map(call=>call.parameters.p_after_task_index)).toEqual(Array.from({length:f.plan.header.taskCount},(_,index)=>index-1));
    expect(pages[0].parameters).toEqual({p_campaign:f.scope.campaignId,p_request:f.scope.requestId,p_through_sequence:null,p_after_task_index:-1,p_limit:128});
    expect(pages.slice(1).every(call=>call.parameters.p_through_sequence===f.plan.header.taskCount)).toBe(true);
    expect(result.manifest.status).toBe("proposal_complete");
    const expected={engagement_synthesis_generation_attempts:"id,request_id,authorization_id,task_index,previous_attempt_id,worker_id,binding_text",
      engagement_synthesis_thematic_attempt_inputs:"attempt_id,task_text,task_sha256,task_bytes,predecessor_attempt_id,predecessor_selection_id,predecessor_capture_sha256,previous_result_sha256",
      engagement_synthesis_generation_dispatches:"attempt_id,expires_at,receipt_text,receipt_sha256",engagement_synthesis_generation_outputs:"attempt_id,capture_text,capture_sha256"};
    for(const [table,columns] of Object.entries(expected)){
      const reads=f.trace.filter(row=>row.table===table);expect(reads).toHaveLength(f.plan.header.taskCount);
      expect(reads.every(row=>row.columns===columns)).toBe(true);
      expect(reads.map(row=>row.filters)).toEqual(f.history.map(entry=>({[table.endsWith("attempts")?"id":"attempt_id"]:entry.attempt.id})));
    }
  });
  it("requires the final proposal even when all evidence frames are verified",async()=>{
    const f=await fixture(),result=await f.load(f.plan.header.frameCount);
    expect(result.manifest.status).toBe("incomplete");expect(result.manifest.verifiedTaskCount).toBe(f.plan.header.frameCount);
    expect(result.entries.at(-1)?.status).toBe("unselected");expect(result.proposal).toBeNull();expect(result.finalOutputText).toBeNull();
  });
  it.each(["claimed","awaiting_output","provider_incomplete","invalid_output","predecessor_changed","cleared"])("preserves %s final state without a proposal",async state=>{
    const f=await fixture(),attemptId=f.final.attempt.id;
    if(state==="claimed"||state==="awaiting_output")f.rows.set("engagement_synthesis_generation_outputs",f.rows.get("engagement_synthesis_generation_outputs")!.filter(row=>row.attempt_id!==attemptId));
    if(state==="claimed")f.rows.set("engagement_synthesis_generation_dispatches",f.rows.get("engagement_synthesis_generation_dispatches")!.filter(row=>row.attempt_id!==attemptId));
    if(state==="provider_incomplete")f.final.recapture(undefined,"stop",500);
    if(state==="invalid_output")f.final.recapture('{"status":"complete"}');
    if(state==="predecessor_changed")f.final.input.predecessor_selection_id=randomUUID();
    if(state==="cleared"){f.final.selection.attemptId=null;f.final.selection.origin="staff";f.final.selection.authorizationId=null;f.final.selection.previousSelectionId=randomUUID();}
    const pending=f.load();await expect(pending).resolves.toMatchObject({manifest:{status:"incomplete"}});const result=await pending;expect(result.manifest.status).toBe("incomplete");expect(result.entries.at(-1)?.status).toBe(state);
    expect(result.proposal).toBeNull();expect(result.finalOutputText).toBeNull();
  });
  it("authenticates later output even when its predecessor is incomplete",async()=>{
    const f=await fixture();f.history[0].recapture("invalid json");const result=await f.load();
    expect(result.entries[0].status).toBe("invalid_output");expect(result.entries.at(-1)?.status).toBe("blocked_by_predecessor");
    expect(result.entries.at(-1)?.captureSha256).toBe(f.final.outputRow.capture_sha256);expect(result.proposal).toBeNull();
    f.final.outputRow.capture_sha256="0".repeat(64);await expect(f.load()).rejects.toThrow();
  });
  it("rechecks current staff permission after all original captures",async()=>{
    const f=await fixture();f.historyOptions.denyRequestRead=5;
    await expect(f.load()).rejects.toThrow("Thematic request unavailable");
    expect(f.trace.some(row=>row.table==="engagement_synthesis_generation_outputs"&&row.filters.attempt_id===f.final.attempt.id)).toBe(true);
  });
  it("returns cancellation arriving during inspection without clearing history",async()=>{
    const f=await fixture();f.historyOptions.before=name=>{if(name==="read_engagement_synthesis_thematic_request"&&f.historyOptions.requestReads===4)f.cancel();};
    const result=await f.load();expect(result.manifest.status).toBe("proposal_complete");expect(result.request.state.cancellation).not.toBeNull();
  });
  it.each(["requestId","afterTaskIndex","throughSequence","empty-more","checksum","taskIndex","actorId","origin","origin-grant","duplicate-sequence","duplicate-attempt"])("refuses changed selection history %s",async field=>{
    const f=await fixture();f.historyOptions.change=(name,data)=>{
      if(name!=="read_engagement_synthesis_generation_selection_history"||(data as {requestId:string}).requestId!==f.scope.requestId)return data;
      const page=data as {requestId:string;afterTaskIndex:number;throughSequence:number;hasMore:boolean;entries:Array<{receiptText:string;receiptSha256:string}>};
      if(field==="requestId")page.requestId=randomUUID();else if(field==="afterTaskIndex")page.afterTaskIndex=100;
      else if(field==="throughSequence")page.throughSequence++;else if(field==="empty-more"){page.hasMore=true;page.entries=[];}
      else if(field==="checksum")page.entries[0].receiptSha256="0".repeat(64);
      else {const index=field.startsWith("duplicate")?1:0,receipt=JSON.parse(page.entries[index].receiptText);
        if(field==="taskIndex")receipt.taskIndex=f.plan.header.taskCount;
        if(field==="actorId")receipt.actorId=randomUUID();if(field==="origin")receipt.previousSelectionId=randomUUID();if(field==="origin-grant")receipt.authorizationId=null;
        if(field==="duplicate-sequence")receipt.sequence=1;if(field==="duplicate-attempt")receipt.attemptId=f.history[0].selection.attemptId;
        page.entries[index].receiptText=JSON.stringify(receipt);page.entries[index].receiptSha256=hash(page.entries[index].receiptText);}
      return page;
    };await expect(f.load(f.plan.header.taskCount)).rejects.toThrow("Historical thematic execution differs");
  });
  it.each(["attempt-request","attempt-index","attempt-binding","grant-predecessor","input-id","input-hash","input-bytes","input-predecessor","dispatch-id","dispatch-expiry","dispatch-budget","output-id","output-hash"])("refuses changed original %s",async field=>{
    const f=await fixture(),row=f.final;
    if(field==="attempt-request")row.attempt.request_id=randomUUID();if(field==="attempt-index")row.attempt.task_index=0;
    if(field==="attempt-binding")row.attempt.binding_text=JSON.stringify({...row.binding,taskSha256:"0".repeat(64)});
    if(field==="grant-predecessor")row.attempt.previous_attempt_id=randomUUID();
    if(field==="input-id")f.options.returnedPatch={table:"engagement_synthesis_thematic_attempt_inputs",key:"attempt_id",value:row.attempt.id,patch:{attempt_id:randomUUID()}};
    if(field==="input-hash")row.input.task_sha256="0".repeat(64);if(field==="input-bytes")row.input.task_bytes=1;
    if(field==="input-predecessor")row.input.predecessor_attempt_id=null;
    if(field==="dispatch-id")f.options.returnedPatch={table:"engagement_synthesis_generation_dispatches",key:"attempt_id",value:row.attempt.id,patch:{attempt_id:randomUUID()}};
    if(field==="dispatch-expiry")row.dispatchRow.expires_at="2098-01-01T00:00:00Z";
    if(field==="dispatch-budget"){row.dispatch.maxOutputTokens++;row.recapture();}
    if(field==="output-id")f.options.returnedPatch={table:"engagement_synthesis_generation_outputs",key:"attempt_id",value:row.attempt.id,patch:{attempt_id:randomUUID()}};
    if(field==="output-hash")row.outputRow.capture_sha256="0".repeat(64);
    await expect(f.load()).rejects.toThrow();
  });

});
