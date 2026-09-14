// @vitest-environment node
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), audit: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: mocks.audit }));
import { POST, GET } from "@/app/api/engagement/campaigns/[campaignId]/translations/generation/route";
import { TRANSLATION_GENERATION_BODY_LIMIT, type TranslationGenerationRequest } from "@/lib/engagement/translation-generation-request";
import { queueTranslationGeneration, TRANSLATION_GENERATION_REPLAY_COLUMNS, TRANSLATION_GENERATION_RESOLUTION_COLUMNS } from "@/lib/engagement/translation-generation-queue";
import { encodeTranslationGenerationDelivery } from "@/lib/engagement/translation-generation-delivery";
import { translationGenerationPacketCanonical } from "@/lib/engagement/translation-generation";
import { readTranslationGenerationRequest } from "@/lib/engagement/translation-generation-read";

const id = (n: number) => `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId=id(1),workspaceId=id(2),actorId=id(3),requestId=id(4),fieldId=id(5);
const context={params:Promise.resolve({campaignId})};
const hash=(s: string)=>createHash("sha256").update(s).digest("hex");
function intent(): TranslationGenerationRequest { return {requestId,locale:"es",fields:[{id:fieldId,address:{entityType:"campaign",entityId:campaignId,field:"title",
  expectedSource:{text:"  PRIVATE source words.  ",sourceLocale:null,available:true},expectedTranslation:null}}]}; }
function packet() { return translationGenerationPacketCanonical({schemaVersion:1,workspaceId,campaignId,fieldId,sourceText:intent().fields[0].address.expectedSource.text!,targetLanguage:"es"}); }
function retainedIntent() { return {requestId,actorId,campaignId,locale:"es",fields:[{...intent().fields[0],packetCanonical:packet()}]}; }
function retained() { return {id:requestId,workspace_id:workspaceId,campaign_id:campaignId,actor_id:actorId,locale:"es",intent:retainedIntent()}; }
function rawRead() {
  const binding={workspaceId,campaignId,requestId,fieldId,attemptId:id(6),reservationId:id(7),credentialId:id(8),configurationHash:hash("synthetic-config"),packetHash:hash(packet()),leaseExpiresAt:"2026-09-13T12:00:00.000Z"};
  const value=encodeTranslationGenerationDelivery({status:"completed",output:"  PRIVATE generated words.  ",receipt:{schemaVersion:1,provider:"anthropic",...binding,
    model:"synthetic-model",credentialSource:"env",recipeVersion:1,targetLanguage:"es",sourceHash:hash(intent().fields[0].address.expectedSource.text!),outputHash:hash("  PRIVATE generated words.  "),
    finishReason:"stop",responseId:"synthetic\0id",reportedModel:"synthetic\ud800model",inputTokens:null,outputTokens:7}});
  return {schema:1,requestId,campaignId,workspaceId,actorId,locale:"es",createdAt:"2026-09-13T11:59:00Z",count:1,
    credential:{id:id(8),configurationHash:binding.configurationHash,model:"synthetic-model",source:"env"},
    fields:[{id:fieldId,address:intent().fields[0].address,packetCanonical:packet(),packetHash:hash(packet()),state:"completed",attemptId:id(6),reservationId:id(7),
      leaseExpiresAt:"2026-09-13T12:00:00+00:00",failureCode:null,output:{...value,acceptedState:"completed"}}]};
}
function request(body: unknown=intent(),headers: Record<string,string>={}) {return new NextRequest("http://localhost/api/translations/generation",{method:"POST",headers:{"content-type":"application/json",host:"localhost",origin:"http://localhost",...headers},body:JSON.stringify(body)});}
function fixture() {
  const lookup=vi.fn(async (table:string):Promise<{data:unknown;error:{code:string}|null}>=>({data:table==="workspace_integration_keys"?[]:null,error:null}));
  const queries:Array<{table:string;calls:Array<[string,...unknown[]]>}>=[];
  const from=vi.fn((table:string)=>{
    const trace={table,calls:[] as Array<[string,...unknown[]]>};queries.push(trace);
    const q:Record<string,unknown>={};for(const name of ["select","eq","limit","abortSignal"])q[name]=(...a:unknown[])=>{trace.calls.push([name,...a]);return q;};
    q.maybeSingle=()=>lookup(table);q.then=(ok:(v:unknown)=>unknown,bad:(e:unknown)=>unknown)=>lookup(table).then(ok,bad);return q;
  });
  const create=vi.fn(async (_args:Record<string,unknown>):Promise<{data:unknown;error:{code:string}|null}>=>({data:{requestId,created:true},error:null}));
  const rpc=vi.fn((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{expect(name).toBe("create_translation_generation_request");return create(args);}}));
  const read=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:rawRead() as unknown,error:null as {code:string}|null}));
  const userClient={auth:{getUser:mocks.user},rpc:(name:string,args:Record<string,unknown>)=>({abortSignal:(signal:AbortSignal)=>{signal.throwIfAborted();return read(name,args);}})};
  const service={from,rpc} as unknown as Parameters<typeof queueTranslationGeneration>[0];
  mocks.client.mockResolvedValue(userClient);mocks.service.mockReturnValue(service);
  return {lookup,queries,from,create,rpc,read,userClient,service};
}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET","SYNTHETIC-QUEUE-ROUTE-SECRET-0123456789");vi.stubEnv("ANTHROPIC_API_KEY","SYNTHETIC-ROUTE-KEY");vi.stubEnv("OPENPLAN_ENGAGEMENT_TRANSLATION_MODEL","synthetic-model");
  mocks.audit.mockReturnValue({info:mocks.info,warn:mocks.warn});mocks.user.mockResolvedValue({data:{user:{id:actorId}}});mocks.access.mockResolvedValue({campaign:{id:campaignId,workspace_id:workspaceId},allowed:true,error:null});});
afterEach(()=>vi.unstubAllEnvs());
describe("staff generation queue routes",()=>{
  it("binds the authenticated scope and exact source packet without calling a model",async()=>{
    const f=fixture();const response=await POST(request(),context);expect(response.status).toBe(202);expect(await response.json()).toEqual({requestId,created:true});
    expect(response.headers.get("cache-control")).toBe("private, no-store");expect(mocks.access).toHaveBeenCalledWith(f.userClient,campaignId,actorId,"engagement.write");
    expect(f.create).toHaveBeenCalledOnce();expect(f.create.mock.calls[0][0]).toMatchObject({p_request:requestId,p_actor:actorId,p_campaign:campaignId,p_locale:"es",p_fields:retainedIntent().fields,p_selected_hash:null,
      p_credential:{workspaceId,requestId,source:"env",configuration:{provider:"anthropic",modelId:"synthetic-model",recipeVersion:1}}});
    expect(JSON.stringify(f.create.mock.calls)).not.toContain("SYNTHETIC-ROUTE-KEY");expect(JSON.stringify([mocks.info.mock.calls,mocks.warn.mock.calls])).not.toContain("PRIVATE");
    expect(TRANSLATION_GENERATION_REPLAY_COLUMNS).toBe("id,workspace_id,campaign_id,actor_id,locale,intent");
    expect(f.queries[0]).toEqual({table:"engagement_translation_generation_requests",calls:[["select",TRANSLATION_GENERATION_REPLAY_COLUMNS],["eq","id",requestId],["eq","workspace_id",workspaceId],["eq","campaign_id",campaignId],["eq","actor_id",actorId],["abortSignal",expect.any(AbortSignal)]]});
  });
  it("refuses a resolved absent request before credential reads using only permitted metadata",async()=>{
    const f=fixture();vi.stubEnv("ANTHROPIC_API_KEY","");
    f.lookup.mockImplementation(async table=>({data:table==="engagement_translation_generation_resolutions"?{request_id:requestId,workspace_id:workspaceId,campaign_id:campaignId,actor_id:actorId}:null,error:null}));
    const response=await POST(request(),context);expect(response.status).toBe(409);expect(f.create).not.toHaveBeenCalled();
    expect(TRANSLATION_GENERATION_RESOLUTION_COLUMNS).toBe("request_id,workspace_id,campaign_id,actor_id");
    expect(f.queries[1]).toEqual({table:"engagement_translation_generation_resolutions",calls:[["select",TRANSLATION_GENERATION_RESOLUTION_COLUMNS],["eq","request_id",requestId],["eq","workspace_id",workspaceId],["eq","campaign_id",campaignId],["eq","actor_id",actorId],["limit",1],["abortSignal",expect.any(AbortSignal)]]});
    expect(f.lookup.mock.calls.map(([table])=>table)).toEqual(["engagement_translation_generation_requests","engagement_translation_generation_resolutions"]);
  });
  it.each(["request_id","workspace_id","campaign_id","actor_id"])("does not trust mismatched resolution metadata %s",async key=>{
    const f=fixture();f.lookup.mockImplementation(async table=>({data:table==="engagement_translation_generation_resolutions"?{request_id:requestId,workspace_id:workspaceId,campaign_id:campaignId,actor_id:actorId,[key]:id(99)}:null,error:null}));
    const response=await POST(request(),context);expect(response.status).toBe(503);expect(f.create).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledTimes(2);
  });
  it("preserves resolution lookup failure instead of preparing a fallback credential",async()=>{
    const f=fixture();f.lookup.mockImplementation(async table=>({data:null,error:table==="engagement_translation_generation_resolutions"?{code:"FETCH_ERROR"}:null}));
    const response=await POST(request(),context);expect(response.status).toBe(503);expect(f.create).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledTimes(2);
  });
  it("confirms the same request after lost acknowledgement and key removal without preparing another key",async()=>{
    const f=fixture();f.create.mockRejectedValueOnce(new Error("Synthetic response loss"));expect((await POST(request(),context)).status).toBe(503);
    const first=f.create.mock.calls[0][0];vi.stubEnv("ANTHROPIC_API_KEY","");f.lookup.mockResolvedValueOnce({data:retained(),error:null});f.create.mockResolvedValueOnce({data:{requestId,created:false},error:null});
    const response=await POST(request(),context);expect(response.status).toBe(200);expect(await response.json()).toEqual({requestId,created:false});
    expect(f.create.mock.calls[1][0]).toEqual({...first,p_credential:null,p_selected_hash:null});expect(f.lookup.mock.calls.filter(([t])=>t==="workspace_integration_keys")).toHaveLength(1);
  });
  it.each(["id","workspace_id","campaign_id","actor_id","locale","intent"])("refuses a retained request with changed %s before key reads or creation",async key=>{
    const f=fixture();f.lookup.mockResolvedValueOnce({data:{...retained(),[key]:key==="intent"?{...retainedIntent(),fields:[]}:key==="locale"?"fr":id(99)},error:null});
    expect((await POST(request(),context)).status).toBe(409);expect(f.create).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledOnce();
  });
  it.each(["unauthenticated","denied","missing","error"])("refuses %s before creating a service client",async kind=>{
    fixture();if(kind==="unauthenticated")mocks.user.mockResolvedValue({data:{user:null}});
    else mocks.access.mockResolvedValue({campaign:kind==="missing"?null:{id:campaignId,workspace_id:workspaceId},allowed:kind!=="denied",error:kind==="error"?{}:null});
    expect((await POST(request(),context)).status).toBe({unauthenticated:401,denied:403,missing:404,error:503}[kind]);expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-assistant-execution-source","x-openplan-assistant-input-hash","x-openplan-assistant-approval-id"])("refuses unregistered agent execution marked by %s",async key=>{
    fixture();expect((await POST(request(intent(),{[key]:"synthetic"}),context)).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled();expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["origin","sec-fetch-site"])("refuses cross-origin generation marked by %s before authentication",async key=>{
    fixture();expect((await POST(request(intent(),{[key]:key==="origin"?"https://synthetic.invalid":"cross-site"}),context)).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["actorId","workspaceId","modelId","credential"])("does not accept a caller-supplied %s",async key=>{
    fixture();expect((await POST(request({...intent(),[key]:id(90)}),context)).status).toBe(400);expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["unavailable","duplicate_id","duplicate_address","oversize","unsupported_language","nul","unpaired"])("refuses %s source requests without touching credentials",async kind=>{
    fixture();const body=intent();
    if(kind==="unavailable")body.fields[0].address.expectedSource.available=false;
    if(kind==="duplicate_id")body.fields.push({...body.fields[0],address:{...body.fields[0].address,field:"summary"}});
    if(kind==="duplicate_address")body.fields.push({...body.fields[0],id:id(90)});
    if(kind==="oversize")body.fields[0].address.expectedSource.text="x".repeat(32001);
    if(kind==="unsupported_language")body.locale="nv";
    if(kind==="nul")body.fields[0].address.expectedSource.text="words\0";
    if(kind==="unpaired")body.fields[0].address.expectedSource.text="words\ud800";
    expect((await POST(request(body),context)).status).toBe(400);expect(mocks.service).not.toHaveBeenCalled();
  });
  it("cancels an oversized body without reading its tail or authenticating",async()=>{
    fixture();let reads=0;const cancel=vi.fn();const stream=new ReadableStream<Uint8Array>({pull(controller){reads++;if(reads===1)controller.enqueue(new Uint8Array(TRANSLATION_GENERATION_BODY_LIMIT+1));else controller.error(new Error("Tail read"));},cancel},{highWaterMark:0});
    const init={method:"POST",headers:{host:"localhost",origin:"http://localhost"},body:stream,duplex:"half" as const};
    const response=await POST(new NextRequest("http://localhost/generation",init),context);
    expect(response.status).toBe(413);expect(reads).toBe(1);expect(cancel).toHaveBeenCalledOnce();expect(mocks.client).not.toHaveBeenCalled();
  });
  it("keeps key-read errors unavailable and does not create a request with an ambient fallback",async()=>{
    const f=fixture();f.lookup.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:[],error:{code:"FETCH_ERROR"}});
    const response=await POST(request(),context);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({kind:"credential_unavailable"});expect(f.create).not.toHaveBeenCalled();
  });
  it.each(["wrong_id","false_replay"])("does not confirm a %s acknowledgement",async kind=>{
    const f=fixture();if(kind==="false_replay")f.lookup.mockResolvedValueOnce({data:retained(),error:null});
    f.create.mockResolvedValueOnce({data:{requestId:kind==="wrong_id"?id(99):requestId,created:true},error:null});
    expect((await POST(request(),context)).status).toBe(503);
  });
  it("reads verified retained output through the user RPC without service credentials",async()=>{
    const f=fixture();const response=await GET(new NextRequest(`http://localhost/generation?requestId=${requestId}`),context);
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({requestId,fields:[{id:fieldId,state:"completed",output:{text:"  PRIVATE generated words.  ",model:"synthetic-model",status:"completed"}}]});
    expect(f.read).toHaveBeenCalledWith("read_translation_generation_request",{p_campaign:campaignId,p_request:requestId});expect(mocks.service).not.toHaveBeenCalled();
  });
  it("does not expose output when staff read permission is lost",async()=>{
    const f=fixture();mocks.access.mockResolvedValue({campaign:{id:campaignId,workspace_id:workspaceId},allowed:false,error:null});
    expect((await GET(new NextRequest(`http://localhost/generation?requestId=${requestId}`),context)).status).toBe(403);expect(f.read).not.toHaveBeenCalled();
  });
  it("reports access lost during the database read as forbidden",async()=>{
    const f=fixture();f.read.mockResolvedValueOnce({data:null,error:{code:"42501"}});
    expect((await GET(new NextRequest(`http://localhost/generation?requestId=${requestId}`),context)).status).toBe(403);
  });

});
describe("retained generation read validation",()=>{
  it("accepts equivalent timestamp spelling and exposes only checked staff display fields",()=>{
    const result=readTranslationGenerationRequest(rawRead(),{requestId,campaignId,workspaceId});expect(result.fields[0].output?.text).toBe("  PRIVATE generated words.  ");expect(result).not.toHaveProperty("credential");
  });
  it.each(["requestId","workspaceId","campaignId","count","field_id","source","digest","state","missing_output","partial_claim"])("rejects a mismatched %s before exposing generated words",kind=>{
    const raw=rawRead();if(["requestId","workspaceId","campaignId"].includes(kind)) {
      // A coherent queued result from another scope has no receipt whose own
      // binding could accidentally substitute for the requested-scope check.
      Object.assign(raw,{[kind]:id(99)});
      const foreignPacket=JSON.parse(raw.fields[0].packetCanonical);if(kind!=="requestId")foreignPacket[kind]=id(99);
      if(kind==="campaignId")raw.fields[0].address.entityId=id(99);
      Object.assign(raw.fields[0],{state:"queued",attemptId:null,reservationId:null,leaseExpiresAt:null,output:null,
        packetCanonical:JSON.stringify(foreignPacket),packetHash:hash(JSON.stringify(foreignPacket))});
    }
    if(kind==="count")raw.count=2;if(kind==="field_id")raw.fields[0].id=id(99);
    if(kind==="source")raw.fields[0].address.expectedSource.text="Changed source";
    if(kind==="digest")raw.fields[0].output.digest="a".repeat(64);
    if(kind==="state")raw.fields[0].state="cancelled";
    if(kind==="missing_output")Object.assign(raw.fields[0],{output:null});
    if(kind==="partial_claim")Object.assign(raw.fields[0],{attemptId:null,leaseExpiresAt:null,state:"queued",output:null});
    expect(()=>readTranslationGenerationRequest(raw,{requestId,campaignId,workspaceId})).toThrow();
  });
});
