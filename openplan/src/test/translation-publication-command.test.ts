// @vitest-environment node
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeTranslationGenerationDelivery } from "@/lib/engagement/translation-generation-delivery";
import { translationGenerationPacketCanonical } from "@/lib/engagement/translation-generation";
import { publishRetainedTranslations } from "@/lib/engagement/translation-publication-server";
import { loadTranslationGenerationRequest } from "@/lib/engagement/translation-generation-read";
import type { TranslationPublicationIntent } from "@/lib/engagement/translation-publication";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), audit: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: mocks.audit }));
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/translations/commands/route";
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
  const { schema: _schema, campaignId: _campaign, actorId: _actor, ...intent } = payload;
  return {campaignId,workspaceId,publisher,actorId,generation,intent,result};
}

function setup(pieces=[fixture()]) {
  const f=pieces[0];
  const write=vi.fn(async():Promise<{data:unknown;error:{code:string}|null}>=>({data:f.result,error:null}));
  const read=vi.fn(async(requestId:string):Promise<{data:unknown;error:{code:string}|null}>=>({data:pieces.find(piece=>piece.generation.requestId===requestId)?.generation,error:null}));
  const rpc=vi.fn((name:string,args:Record<string,unknown>)=>({abortSignal:async(signal:AbortSignal)=>{
    signal.throwIfAborted();
    if(name==="write_engagement_translations")return write();
    expect(name).toBe("read_translation_generation_request");expect(args.p_campaign).toBe(f.campaignId);
    return read(String(args.p_request));
  }}));
  const client={auth:{getUser:mocks.user},rpc};
  mocks.client.mockResolvedValue(client);mocks.user.mockResolvedValue({data:{user:{id:f.publisher}}});
  mocks.access.mockResolvedValue({campaign:{id:f.campaignId,workspace_id:f.workspaceId},allowed:true,error:null});
  mocks.audit.mockReturnValue({info:mocks.info,warn:mocks.warn,error:mocks.error});
  return {...f,write,read,rpc,client};
}
function request(body:unknown,headers:Record<string,string>={}) { return new NextRequest("http://localhost/commands",{method:"POST",headers:{origin:"http://localhost","content-type":"application/json",...headers},body:JSON.stringify(body)}); }
function send(f:ReturnType<typeof setup>,body:unknown=f.intent,headers:Record<string,string>={}) { return POST(request(body,headers),{params:Promise.resolve({campaignId:f.campaignId})}); }
beforeEach(()=>vi.resetAllMocks());
afterEach(()=>vi.restoreAllMocks());
describe("publication command integration",()=>{
  it("publishes once with the authenticated publisher and exact references, then verifies raw retained output",async()=>{
    const f=setup(),response=await send(f);expect(response.status).toBe(200);expect(await response.json()).toEqual(f.result);
    expect(response.headers.get("cache-control")).toBe("private, no-store");expect(f.write).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledExactlyOnceWith(f.generation.requestId);
    expect(f.rpc.mock.calls[0]).toEqual(["write_engagement_translations",{p_campaign:f.campaignId,p_request:f.intent.requestId,p_operation:"publish_generated",p_locale:f.intent.locale,p_reason:f.intent.reason,p_entries:f.intent.entries}]);
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(f.client,f.campaignId,f.publisher,"engagement.write");expect(mocks.service).not.toHaveBeenCalled();
    expect(JSON.stringify([mocks.info.mock.calls,mocks.warn.mock.calls,mocks.error.mock.calls])).not.toContain("SYNTHETIC");
  });
  it("recovers the exact request after a lost write acknowledgement without another generation",async()=>{
    const f=setup();f.write.mockRejectedValueOnce(new Error("SYNTHETIC lost acknowledgement"));
    expect((await send(f)).status).toBe(503);expect(f.read).not.toHaveBeenCalled();
    f.result.replayed=true;const response=await send(f);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({requestId:f.intent.requestId,replayed:true});
    const writes=f.rpc.mock.calls.filter(([name])=>name==="write_engagement_translations");expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(f.read).toHaveBeenCalledOnce();
  });
  it.each(["42501","PT503","throws"])("keeps a committed publication unconfirmed after evidence read %s",async code=>{
    const f=setup();if(code==="throws")f.read.mockRejectedValueOnce(new Error("SYNTHETIC read loss"));else f.read.mockResolvedValueOnce({data:null,error:{code}});
    const response=await send(f);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({kind:"unavailable"});expect(f.write).toHaveBeenCalledOnce();
    f.result.replayed=true;expect((await send(f)).status).toBe(200);expect(f.write).toHaveBeenCalledTimes(2);
  });
  it.each([["PT409",409],["42501",403],["22023",400],["PT503",503]] as const)("preserves transaction refusal %s without evidence reads",async(code,status)=>{
    const f=setup();f.write.mockResolvedValue({data:f.result,error:{code}});const response=await send(f);expect(response.status).toBe(status);expect(await response.json()).not.toHaveProperty("entries");expect(f.read).not.toHaveBeenCalled();expect(f.write).toHaveBeenCalledOnce();
  });
  it.each(["words","publisher","generation_actor","source","digest","source_checksum"])("withholds a receipt when %s does not match verified evidence",async kind=>{
    const f=setup();if(kind==="words")f.result.entries[0].entry.translated_text="changed";
    if(kind==="publisher")f.result.entries[0].entry.created_by=f.actorId;
    if(kind==="generation_actor")f.result.entries[0].generation.actorId=f.publisher;
    if(kind==="source")f.generation.fields[0].address.expectedSource.text="changed";
    if(kind==="source_checksum")f.result.entries[0].entry.source_text_hash=sha("changed");
    if(kind==="digest")f.generation.fields[0].output.digest=sha("changed");
    const response=await send(f);expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty("entries");expect(f.write).toHaveBeenCalledOnce();
  });
  it.each(["workspaceId","publisherId","text","model"])("refuses caller-supplied %s before any write",async key=>{
    const f=setup();const body=structuredClone(f.intent);if(key==="text"||key==="model")Object.assign(body.entries[0],{[key]:"SYNTHETIC forged"});else Object.assign(body,{[key]:id(99)});
    expect((await send(f,body)).status).toBe(400);expect(f.rpc).not.toHaveBeenCalled();
  });
  it("validates direct helper input before calling SQL",async()=>{
    const f=setup();const invalid={...f.intent,reason:" "} as TranslationPublicationIntent;
    const answer=await publishRetainedTranslations(f.client as never,{campaignId:f.campaignId,workspaceId:f.workspaceId,publisherId:f.publisher},invalid);
    expect(answer.error?.status).toBe(400);expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-assistant-execution-source","x-openplan-assistant-input-hash","x-openplan-assistant-approval-id"])("refuses even empty unregistered agent marker %s",async key=>{
    const f=setup();expect((await send(f,f.intent,{[key]:""})).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["foreign","missing","cross-site"])("refuses %s origin before authentication",async kind=>{
    const f=setup();const headers:Record<string,string>=kind==="cross-site"?{"sec-fetch-site":"cross-site"}:{origin:kind==="foreign"?"https://synthetic.invalid":""};
    const response=await send(f,f.intent,headers);expect(response.status).toBe(403);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(mocks.client).not.toHaveBeenCalled();
  });
  it("bounds concurrent evidence reads and retains every field across batches",async()=>{
    const pieces=Array.from({length:9},(_,i)=>fixture((i+1)*100));const first=pieces[0];
    first.intent.entries=pieces.flatMap(piece=>piece.intent.entries);first.result.entries=pieces.flatMap(piece=>piece.result.entries);
    const f=setup(pieces);let active=0,peak=0;
    f.read.mockImplementation(async requestId=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return{data:pieces.find(piece=>piece.generation.requestId===requestId)!.generation,error:null};});
    const response=await send(f);expect(response.status).toBe(200);expect((await response.json()).entries).toHaveLength(18);expect(f.read).toHaveBeenCalledTimes(9);expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(8);expect(f.write).toHaveBeenCalledOnce();
  });
  it("stops after the shared command deadline without starting evidence reads",async()=>{
    const f=setup();const controller=new AbortController();const timeout=vi.spyOn(AbortSignal,"timeout").mockReturnValue(controller.signal);
    f.write.mockImplementation(async()=>{controller.abort();return{data:f.result,error:null};});
    expect((await send(f)).status).toBe(503);expect(f.write).toHaveBeenCalledOnce();expect(f.read).not.toHaveBeenCalled();expect(timeout).toHaveBeenCalledWith(20000);
  });
  it("passes the same total deadline into in-flight evidence reads",async()=>{
    const f=setup();const controller=new AbortController();const timeout=vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>ms===20000?controller.signal:new AbortController().signal);
    const readSignals:AbortSignal[]=[];f.rpc.mockImplementation((name,args)=>({abortSignal:async signal=>{
      if(name==="write_engagement_translations")return f.write();
      readSignals.push(signal);const result=await f.read(String(args.p_request));controller.abort();return result;
    }}));
    expect((await send(f)).status).toBe(503);expect(readSignals).toHaveLength(1);expect(readSignals[0].aborted).toBe(true);expect(timeout.mock.calls).toEqual([[20000],[10000]]);
  });
  it("does not start a generation RPC when its caller deadline already expired",async()=>{
    const f=setup(),controller=new AbortController();controller.abort();
    await expect(loadTranslationGenerationRequest(f.client as never,{campaignId:f.campaignId,workspaceId:f.workspaceId,requestId:f.generation.requestId},controller.signal)).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
  });
});
