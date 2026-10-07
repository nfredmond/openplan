import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlanWithContext } from "@/lib/land-use-plans/create-store";
import { matchesPlanCreation, planCreationCommandSchema, serializePlanCreation, type PlanCreationResult } from "@/lib/land-use-plans/create-command";
import { savedPlanContextSchema } from "@/lib/land-use-plans/plan-context";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { placeOfRecordFromBoundary, placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/geographies/place-resolver", () => ({ resolvePlaceBoundary: mocks.resolve }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope = { actorId: id(1), workspaceId: id(2) };
const geometry = { type: "Polygon" as const, coordinates: [[[0,0],[1,0],[1,1],[0,0]]] as [number,number][][] };
const neutral = getJurisdictionPlanDescriptor("local-unconfigured")!;
function command() { return { commandId: id(3), title: "SYNTHETIC plan", authorityLabel: "SYNTHETIC display body", descriptorId: neutral.id,
  planKindKey: "community", expectedDescriptorHash: hashFrozenRecord(neutral), place: { mode: "uploaded" as const, label: "SYNTHETIC area", geometry },
  assessment: { authorities: [{ id: id(4),label:"SYNTHETIC body",role:"Sponsor",kind:"tribal_government",jurisdiction:null,sourceUrls:[] }],
    applicability:{status:"unresolved" as const,explanation:"SYNTHETIC unresolved authority. No legal finding."} } }; }
function receipt(): PlanCreationResult { const c=command();return { replayed:false,commandId:c.commandId,...scope,planId:id(5),versionId:id(6),
  context:{schemaVersion:1,place:savedPlanContextSchema.shape.place.parse(placeOfRecordFromCapturedArea(c.place)),assessment:c.assessment,savedBy:scope.actorId,savedAt:"2026-10-07T12:00:00.123456Z"},
  contextHash:"a".repeat(64),descriptorHash:c.expectedDescriptorHash,descriptorId:c.descriptorId,planKindKey:c.planKindKey,title:c.title,authorityLabel:c.authorityLabel }; }
const from=vi.fn(),rpc=vi.fn();
const client={from,rpc} as unknown as Parameters<typeof createPlanWithContext>[0];
let lookup:{data:null|{command_id:string};error:null|{code:string}},queries:{table:string;projection:string;filters:[string,unknown][]}[];
beforeEach(()=>{vi.clearAllMocks();lookup={data:null,error:null};queries=[];
 from.mockImplementation((table:string)=>{if(table!=="land_use_plan_creation_commands")throw Error("Unexpected workspace-home or unrelated read: "+table);
  const query={table,projection:"",filters:[] as [string,unknown][]};queries.push(query);
  const chain={select:(p:string)=>{query.projection=p;return chain;},eq:(k:string,v:unknown)=>{query.filters.push([k,v]);return chain;},maybeSingle:async()=>lookup};return chain;});
 rpc.mockResolvedValue({data:receipt(),error:null});mocks.resolve.mockRejectedValue(Error("lookup unavailable"));
});
describe("atomic plan creation preparation",()=>{
 it("keeps exact normalized bytes and prepares unresolved multiple-body context without reading workspace home",async()=>{
  const c=command();c.assessment.authorities.push({...c.assessment.authorities[0],id:id(7),label:"Second sovereign body"});
  const outcome=receipt();outcome.context.assessment=c.assessment;rpc.mockResolvedValue({data:outcome,error:null});const raw=" \n"+serializePlanCreation(c)+"\n";
  expect(await createPlanWithContext(client,scope,raw)).toEqual(outcome);expect(queries).toEqual([{table:"land_use_plan_creation_commands",projection:"command_id",filters:[["workspace_id",scope.workspaceId],["command_id",c.commandId]]}]);
  expect(rpc).toHaveBeenCalledWith("create_land_use_plan_with_context",expect.objectContaining({p_workspace_id:scope.workspaceId,p_actor_id:scope.actorId,p_command_id:c.commandId,p_command_text:raw,p_prepared_context:expect.objectContaining({assessment:c.assessment,place:outcome.context.place})}));
  const args=rpc.mock.calls[0][1];expect(JSON.parse(args.p_descriptor_text)).toEqual(neutral);expect(mocks.resolve).not.toHaveBeenCalled();
 });
 it("uses assessed plan authority for configured rules without a workspace-home read",async()=>{
  const ca=getJurisdictionPlanDescriptor("us-ca-general-plan")!;const c={...command(),descriptorId:ca.id,planKindKey:"comprehensive",expectedDescriptorHash:hashFrozenRecord(ca),assessment:{authorities:[{id:id(4),label:"SYNTHETIC California body",role:"Plan sponsor",kind:"county",jurisdiction:{country:"US",subdivision:"CA"},sourceUrls:["https://example.test/authority"]}],applicability:{status:"staff_assessed" as const,explanation:"SYNTHETIC scope exercise only",sourceUrls:["https://example.test/assessment"],authorityIds:[id(4)]}}};
  const result={...receipt(),descriptorId:c.descriptorId,planKindKey:c.planKindKey,descriptorHash:c.expectedDescriptorHash,context:{...receipt().context,assessment:c.assessment}};rpc.mockResolvedValue({data:result,error:null});
  expect(await createPlanWithContext(client,scope,serializePlanCreation(c))).toEqual(result);expect(from).toHaveBeenCalledTimes(1);
 });
 it("refuses unresolved authority for configured rules before any write",async()=>{
  const d=getJurisdictionPlanDescriptor("us-ca-general-plan")!;
  await expect(createPlanWithContext(client,scope,serializePlanCreation({...command(),descriptorId:d.id,planKindKey:"comprehensive",expectedDescriptorHash:hashFrozenRecord(d)}))).rejects.toMatchObject({kind:"conflict"});expect(rpc).not.toHaveBeenCalled();
 });
 it("refuses changed descriptor rules and unknown plan kinds",async()=>{
  for(const c of [{...command(),expectedDescriptorHash:"b".repeat(64)},{...command(),planKindKey:"absent"},{...command(),descriptorId:"absent"}])await expect(createPlanWithContext(client,scope,serializePlanCreation(c))).rejects.toMatchObject({kind:"conflict"});expect(rpc).not.toHaveBeenCalled();
 });
 it("refuses malformed or unnormalized commands and retained boundaries before lookup",async()=>{
  for(const raw of ["not json",JSON.stringify({...command(),title:" padded "}),JSON.stringify({...command(),place:{mode:"retained"}}),JSON.stringify({...command(),extra:true})])await expect(createPlanWithContext(client,scope,raw)).rejects.toMatchObject({kind:"invalid"});expect(from).not.toHaveBeenCalled();
  expect(planCreationCommandSchema.parse({...command(),title:" trimmed "}).title).toBe("trimmed");
 });
 it("refuses an unreadable or mismatched command lookup",async()=>{
  lookup={data:null,error:{code:"unavailable"}};await expect(createPlanWithContext(client,scope,serializePlanCreation(command()))).rejects.toMatchObject({kind:"unavailable"});
  lookup={data:{command_id:id(9)},error:null};await expect(createPlanWithContext(client,scope,serializePlanCreation(command()))).rejects.toMatchObject({kind:"unavailable"});expect(rpc).not.toHaveBeenCalled();
 });
 it("fails a fresh selected-place request when boundary lookup fails",async()=>{
  const c={...command(),place:{mode:"place" as const,kind:"county" as const,geoid:"06067",label:"SYNTHETIC area"}};
  await expect(createPlanWithContext(client,scope,serializePlanCreation(c))).rejects.toMatchObject({kind:"unavailable"});expect(mocks.resolve).toHaveBeenCalledWith("county","06067");expect(rpc).not.toHaveBeenCalled();
 });
 it("creates a selected place from the resolved boundary and keeps its source identity",async()=>{
  const c={...command(),place:{mode:"place" as const,kind:"county" as const,geoid:"06067",label:"SYNTHETIC area"}};
  const boundary={kind:"county" as const,geoid:"06067",label:"Synthetic resolved place",bbox:{minLon:0,minLat:0,maxLon:1,maxLat:1},geojson:geometry};
  mocks.resolve.mockResolvedValue(boundary);const r=receipt();r.context.place=savedPlanContextSchema.shape.place.parse(placeOfRecordFromBoundary(boundary,c.place.label));rpc.mockResolvedValue({data:r,error:null});
  expect(await createPlanWithContext(client,scope,serializePlanCreation(c))).toEqual(r);expect(rpc.mock.calls[0][1].p_prepared_context.place).toEqual(r.context.place);
 });
 it("replays original context before changed installed rules or unavailable boundary lookup",async()=>{
  const c={...command(),descriptorId:"retired-descriptor",expectedDescriptorHash:"b".repeat(64),place:{mode:"place" as const,kind:"county" as const,geoid:"06067",label:"SYNTHETIC area"}};
  const result={...receipt(),replayed:true,descriptorId:c.descriptorId,descriptorHash:c.expectedDescriptorHash,context:{...receipt().context,place:{...receipt().context.place,source:"tigerweb",kind:"county",ref:"06067",countryCode:"US",subdivisionCode:"CA"}}};
  lookup={data:{command_id:c.commandId},error:null};rpc.mockResolvedValue({data:result,error:null});const raw=serializePlanCreation(c);
  expect(await createPlanWithContext(client,scope,raw)).toEqual(result);expect(mocks.resolve).not.toHaveBeenCalled();expect(rpc.mock.calls[0][1]).toMatchObject({p_command_text:raw,p_prepared_context:null,p_descriptor_text:null});
 });
 it.each([["42501","forbidden"],["PT409","conflict"],["PT400","invalid"],["XX000","unavailable"]])("preserves native %s refusal",async(code,kind)=>{rpc.mockResolvedValue({data:null,error:{code}});await expect(createPlanWithContext(client,scope,serializePlanCreation(command()))).rejects.toMatchObject({kind});});
 it("rejects a fresh outcome for a known replay",async()=>{lookup={data:{command_id:id(3)},error:null};await expect(createPlanWithContext(client,scope,serializePlanCreation(command()))).rejects.toMatchObject({kind:"unavailable"});});
 it.each(["actorId","workspaceId","commandId","descriptorId","planKindKey","descriptorHash","title","authorityLabel"] as const)("rejects substituted %s in a receipt",async key=>{rpc.mockResolvedValue({data:{...receipt(),[key]:key.endsWith("Id")?id(9):"b".repeat(64)},error:null});await expect(createPlanWithContext(client,scope,serializePlanCreation(command()))).rejects.toMatchObject({kind:"unavailable"});});
 it("rejects changed authority, boundary, attribution and malformed receipts",async()=>{
  for(const alter of [(r:PlanCreationResult)=>{r.context.assessment.authorities[0].label="Changed";},(r:PlanCreationResult)=>{r.context.place.label="Changed";},(r:PlanCreationResult)=>{r.context.savedBy=id(9);},(r:PlanCreationResult)=>{r.planId="not uuid";}]){const r=receipt();alter(r);rpc.mockResolvedValue({data:r,error:null});await expect(createPlanWithContext(client,scope,serializePlanCreation(command()))).rejects.toMatchObject({kind:"unavailable"});}
 });
 it("verifies selected-place identity without claiming a later service boundary",()=>{
  const c={...command(),place:{mode:"place" as const,kind:"county" as const,geoid:"06067",label:"SYNTHETIC area"}};
  const r=receipt();r.context.place={...r.context.place,source:"tigerweb",kind:"county",ref:"06067",countryCode:"US",subdivisionCode:"CA"};expect(matchesPlanCreation(r,c,scope)).toBe(true);
  for(const key of ["source","kind","ref","countryCode","subdivisionCode","label"] as const){const changed=structuredClone(r);changed.context.place[key]="WRONG";expect(matchesPlanCreation(changed,c,scope),key).toBe(false);}
 });
});
