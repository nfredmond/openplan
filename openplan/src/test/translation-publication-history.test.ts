// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadTranslationHistory } from "@/lib/engagement/translation-history-server";
import { translationHistoryEntrySchema } from "@/lib/engagement/translation-history";
import { encodeTranslationGenerationDelivery } from "@/lib/engagement/translation-generation-delivery";
import { translationGenerationPacketCanonical } from "@/lib/engagement/translation-generation";
const id = (n: number) => `75000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(offset=0) {
  const campaignId=id(1), workspaceId=id(2), publisher=id(3), actorId=id(4), requestId=id(5+offset), writeId=id(6+offset);
  const source="  SYNTHETIC history source  ", model="synthetic-model", lease="2026-09-13T12:00:00.000Z";
  const fields=["title","summary"].map((field,index)=>{
    const fieldId=id(10+index+offset), attemptId=id(20+index+offset), reservationId=id(30+index+offset);
    const packetCanonical=translationGenerationPacketCanonical({schemaVersion:1,workspaceId,campaignId,fieldId,sourceText:source,targetLanguage:"es"});
    const text=`  SYNTHETIC retained wording ${index}  `;
    const delivery=encodeTranslationGenerationDelivery({status:"completed",output:text,receipt:{schemaVersion:1,provider:"anthropic",workspaceId,campaignId,requestId,fieldId,attemptId,reservationId,
      credentialId:id(40+offset),configurationHash:sha("configuration"),packetHash:sha(packetCanonical),leaseExpiresAt:lease,model,credentialSource:"env",recipeVersion:1,targetLanguage:"es",
      sourceHash:sha(source),outputHash:sha(text),finishReason:"stop",responseId:"synthetic\0id",reportedModel:"synthetic\ud800model",inputTokens:null,outputTokens:4}});
    return {id:fieldId,address:{entityType:offset ? "category" : "campaign",entityId:offset ? id(80+offset+index) : campaignId,field:offset ? "label" : field,expectedSource:{text:source,sourceLocale:null,available:true},expectedTranslation:null},packetCanonical,packetHash:sha(packetCanonical),state:"completed",attemptId,reservationId,leaseExpiresAt:lease,failureCode:null,output:{...delivery,acceptedState:"completed"}};
  });
  const generation={schema:1,requestId,campaignId,workspaceId,actorId,locale:"es",createdAt:lease,credential:{id:id(40+offset),configurationHash:sha("configuration"),model,source:"env"},count:2,fields};
  const payload={schema:1,campaignId,actorId:publisher,requestId:writeId,operation:"publish_generated",locale:"es",reason:"SYNTHETIC publication decision",entries:fields.map(field=>({...structuredClone(field.address),generation:{requestId,fieldId:field.id,attemptId:field.attemptId,deliveryDigest:field.output.digest}}))};
  const result={campaignId,requestId:writeId,operation:"publish_generated",locale:"es",replayed:false,entries:fields.map((field,index)=>({revision:1,removed:false,generation:{...payload.entries[index].generation,actorId,outputHash:JSON.parse(field.output.bindingCanonical).outputHash},
    entry:{id:id(50+index+offset),campaign_id:campaignId,workspace_id:workspaceId,entity_type:field.address.entityType,entity_id:field.address.entityId,field:field.address.field,locale:"es",translated_text:JSON.parse(field.output.outputJson),source:"machine",machine_model:model,source_text_hash:sha(source.trim()),created_by:publisher,created_at:lease,updated_at:lease}}))};
  const payload_text=JSON.stringify(payload),result_text=JSON.stringify(result);
  const snapshot={schema:2,campaignId,count:2,receiptCount:1,receipts:[{request_id:writeId,actor_id:publisher,payload_text,payload_sha256:sha(payload_text),result_text,result_sha256:sha(result_text)}],
    entries:result.entries.map((saved,index)=>{const record_text=JSON.stringify(saved.entry);return{id:id(60+index+offset),campaign_id:campaignId,translation_id:saved.entry.id,revision:1,actor_id:publisher,recorded_at:lease,event:"created",write_request_id:writeId,record_text,record_sha256:sha(record_text)};})};
  return {campaignId,workspaceId,publisher,actorId,generation,payload,result,snapshot};
}
function rehash(f:ReturnType<typeof fixture>){const r=f.snapshot.receipts[0];r.payload_text=JSON.stringify(f.payload);r.payload_sha256=sha(r.payload_text);r.result_text=JSON.stringify(f.result);r.result_sha256=sha(r.result_text);}
async function read(f:ReturnType<typeof fixture>,error=false){
  const rpc=vi.fn((name:string,args:Record<string,unknown>)=>{
    if(name==="read_engagement_translation_history"){expect(args).toEqual({p_campaign:f.campaignId});return Promise.resolve({data:f.snapshot,error:null});}
    expect(name).toBe("read_translation_generation_request");expect(args).toEqual({p_campaign:f.campaignId,p_request:f.generation.requestId});
    return {abortSignal:(signal:AbortSignal)=>{expect(signal).toBeInstanceOf(AbortSignal);return Promise.resolve({data:error?null:f.generation,error:error?{code:"42501"}:null});}};
  });
  return {answer:await loadTranslationHistory({rpc} as never,f.campaignId,f.workspaceId),rpc};
}
describe("publication history custody",()=>{
  it("joins one batch to exact generated words and preserves both actors",async()=>{
    const f=fixture(), {answer,rpc}=await read(f);expect(answer.error).toBeNull();expect(answer.rows).toHaveLength(2);expect(rpc).toHaveBeenCalledTimes(2);
    answer.rows.forEach((row,index)=>{expect(row.actor_id).toBe(f.publisher);expect(row.record.source).toBe("machine");expect(row.change).toMatchObject({operation:"publish_generated",generation:{actorId:f.actorId,fieldId:f.generation.fields[index].id,deliveryDigest:f.generation.fields[index].output.digest}});expect(translationHistoryEntrySchema.safeParse(row).success).toBe(true);});
  });
  it("reuses a generation read across independently published fields",async()=>{
    const f=fixture(), originalReceipt=f.snapshot.receipts[0];
    f.snapshot.receiptCount=2;f.snapshot.receipts=f.payload.entries.map((entry,index)=>{const payload_text=JSON.stringify({...f.payload,requestId:id(70+index),entries:[entry]});const result_text=JSON.stringify({...f.result,requestId:id(70+index),entries:[f.result.entries[index]]});f.snapshot.entries[index].write_request_id=id(70+index);return{...originalReceipt,request_id:id(70+index),payload_text,payload_sha256:sha(payload_text),result_text,result_sha256:sha(result_text)};});
    const {answer,rpc}=await read(f);expect(answer.error).toBeNull();expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("bounds concurrent evidence reads without omitting requests",async()=>{
    const pieces=Array.from({length:9},(_,index)=>fixture((index+1)*100));const f=pieces[0];
    f.payload.entries=pieces.flatMap(piece=>piece.payload.entries);f.result.entries=pieces.flatMap(piece=>piece.result.entries);
    f.snapshot.entries=pieces.flatMap(piece=>piece.snapshot.entries.map(row=>({...row,write_request_id:f.payload.requestId})));f.snapshot.count=f.snapshot.entries.length;rehash(f);
    const generation=new Map(pieces.map(piece=>[piece.generation.requestId,piece.generation]));let active=0,peak=0,reads=0;
    const rpc=(name:string,args:Record<string,unknown>)=>{
      if(name==="read_engagement_translation_history")return Promise.resolve({data:f.snapshot,error:null});
      expect(name).toBe("read_translation_generation_request");expect(args.p_campaign).toBe(f.campaignId);
      return{abortSignal:async()=>{reads++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return{data:generation.get(String(args.p_request)),error:null};}};
    };
    const answer=await loadTranslationHistory({rpc} as never,f.campaignId,f.workspaceId);
    expect(answer.error).toBeNull();expect(answer.rows).toHaveLength(18);expect(reads).toBe(9);expect(peak).toBeLessThanOrEqual(8);expect(peak).toBeGreaterThan(1);
  });
  it.each(["missing_revision","generation_actor","generation_digest","words","scope","source_hash","replayed","missing_output"])("refuses incomplete or altered publication evidence %s",async kind=>{
    const f=fixture();
    if(kind==="missing_revision"){f.snapshot.entries.pop();f.snapshot.count=1;}
    if(kind==="generation_actor")f.result.entries[0].generation.actorId=f.publisher;
    if(kind==="generation_digest")f.result.entries[0].generation.deliveryDigest=sha("different");
    if(kind==="words")f.result.entries[0].entry.translated_text="Different words";
    if(kind==="scope")f.payload.campaignId=id(99);
    if(kind==="source_hash"){f.result.entries[0].entry.source_text_hash=sha("different");f.snapshot.entries[0].record_text=JSON.stringify(f.result.entries[0].entry);f.snapshot.entries[0].record_sha256=sha(f.snapshot.entries[0].record_text);}
    if(kind==="replayed")f.result.replayed=true;
    if(kind==="missing_output")Object.assign(f.generation.fields[0],{output:null});
    rehash(f);const{answer}=await read(f);expect(answer.error).not.toBeNull();expect(answer.rows).toEqual([]);
  });
  it("does not return partial history when retained generation access is lost",async()=>{const{answer}=await read(fixture(),true);expect(answer.error).not.toBeNull();expect(answer.rows).toEqual([]);});
  it("requires generation evidence only on publication history entries",async()=>{
    const{answer}=await read(fixture());const row=answer.rows[0];expect(row).toBeDefined();const missing=structuredClone(row);delete missing.change!.generation;
    expect(translationHistoryEntrySchema.safeParse(missing).success).toBe(false);
    const unrelated=structuredClone(row);unrelated.change!.operation="save";expect(translationHistoryEntrySchema.safeParse(unrelated).success).toBe(false);
  });
});
