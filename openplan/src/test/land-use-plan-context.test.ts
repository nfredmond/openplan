import { beforeEach, describe, expect, it, vi } from "vitest";
import { planAuthorityAssessmentSchema, planApplicabilityBlocker, readSavedPlanContext, type PlanAuthorityAssessment } from "@/lib/land-use-plans/plan-context";
import { studyAreaCaptureSchema, placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { snapshotPlanDescriptor } from "@/lib/land-use-plans/descriptor-snapshot";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/geographies/place-resolver", () => ({ resolvePlaceBoundary: resolve }));
import { planContextCommandSchema, preparePlanContext } from "@/lib/land-use-plans/plan-context-server";
const id = (n: number) => `aa000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const ca = getJurisdictionPlanDescriptor("us-ca-general-plan")!, neutral = getJurisdictionPlanDescriptor("local-unconfigured")!;
const polygon = () => ({ type: "Polygon" as const, coordinates: [[[-122,38],[-121,38],[-121,39],[-122,38]]] as [number, number][][] });
const authority = (n=1) => ({ id:id(n), label:`SYNTHETIC body ${n}`, role:"Adopting body", kind:"city", jurisdiction:{country:"US",subdivision:"CA"},sourceUrls:["https://example.org/synthetic-authority"] });
const assessed = (): PlanAuthorityAssessment => ({ authorities:[authority()],applicability:{status:"staff_assessed",explanation:"SYNTHETIC staff assessment, not an agency finding",sourceUrls:["https://example.org/synthetic-assessment"],authorityIds:[id(1)]} });
const command = () => ({place:{mode:"drawn" as const,geometry:polygon(),label:"SYNTHETIC study area"},assessment:assessed()});
beforeEach(()=>vi.clearAllMocks());

describe("plan-owned applicability",()=>{
 it("accepts explicitly assessed supported authorities without any workspace-home argument",()=>{
  expect(planAuthorityAssessmentSchema.safeParse(assessed()).success).toBe(true);
  expect(planApplicabilityBlocker(assessed(),ca)).toBeNull();
 });
 it("keeps unresolved and unsupported authorities usable in the neutral workflow",()=>{
  const value=assessed();value.applicability={status:"unresolved",explanation:"Governing requirements have not been established"};
  value.authorities[0].jurisdiction=null;value.authorities[0].kind="sovereign nation";
  expect(planApplicabilityBlocker(value,neutral)).toBeNull();expect(planApplicabilityBlocker(value,ca)).toContain("Assess this plan");
 });
 it.each(["country","subdivision","kind","sources"])("refuses configured scope with unsupported authority %s",field=>{
  const value=assessed(),a=value.authorities[0];
  if(field==="country") a.jurisdiction={country:"NZ",subdivision:"CA"};
  if(field==="subdivision") a.jurisdiction={country:"US",subdivision:"OR"};
  if(field==="kind") a.kind="sovereign nation";
  if(field==="sources") a.sourceUrls=[];
  expect(planApplicabilityBlocker(value,ca)).toContain("outside this checklist");
 });
 it("checks every selected authority while preserving other responsibilities without assigning them law",()=>{
  const value=assessed();value.authorities.push({...authority(2),kind:"sovereign nation"});
  expect(planApplicabilityBlocker(value,ca)).toBeNull();
  if(value.applicability.status!=="staff_assessed") throw Error("fixture");
  value.applicability.authorityIds.push(id(2));expect(planApplicabilityBlocker(value,ca)).toContain("outside this checklist");
 });
 it("refuses missing configured authority coverage instead of accepting a country match alone",()=>{
  expect(planApplicabilityBlocker(assessed(),{...ca,authorityKinds:undefined})).toContain("no configured authority scope");
  expect(planApplicabilityBlocker(assessed(),{...ca,jurisdictionCoverage:undefined})).toContain("no configured authority scope");
 });
 it("rejects duplicate and dangling authority references",()=>{
  const duplicate=assessed();duplicate.authorities.push(authority());expect(planAuthorityAssessmentSchema.safeParse(duplicate).success).toBe(false);
  for(const ids of [[id(2)],[id(1),id(1)]]){
   const value=assessed();if(value.applicability.status==="staff_assessed")value.applicability.authorityIds=ids;
   expect(planAuthorityAssessmentSchema.safeParse(value).success).toBe(false);
  }
 });
 it("refuses source-free assessment, unsafe links and invented client attribution",()=>{
  const value=assessed();if(value.applicability.status==="staff_assessed") value.applicability.sourceUrls=[];
  expect(planAuthorityAssessmentSchema.safeParse(value).success).toBe(false);
  const unsafe=assessed();unsafe.authorities[0].sourceUrls=["javascript:alert(1)"];expect(planAuthorityAssessmentSchema.safeParse(unsafe).success).toBe(false);
  expect(planContextCommandSchema.safeParse({...command(),savedBy:id(9)}).success).toBe(false);
 });
 it("retains the adapter authority scope in the frozen descriptor",()=>{
  expect(snapshotPlanDescriptor(ca,"comprehensive").authorityKinds).toEqual(["city","county"]);
  expect(()=>snapshotPlanDescriptor({...ca,authorityKinds:[]},"comprehensive")).toThrow();
 });
});

describe("study place capture and attributed context",()=>{
 it.each(["drawn","uploaded"] as const)("keeps %s geometry without inventing legal identity",async mode=>{
  const value={...command(),place:{...command().place,mode}};
  const result=await preparePlanContext(value,ca,id(3));expect(result.ok).toBe(true);if(!result.ok)throw Error("fixture");
  expect(result.context.place).toMatchObject({source:mode==="drawn"?"drawn":"uploaded_file",kind:null,ref:null,countryCode:null,subdivisionCode:null,geometry:polygon()});
  expect(result.context.savedBy).toBe(id(3));expect(Number.isNaN(Date.parse(result.context.savedAt))).toBe(false);
  expect(resolve).not.toHaveBeenCalled();
  value.place.geometry.coordinates[0][0][0]=-123;expect(result.context.place.geometry).toEqual(polygon());
 });
 it("re-resolves a selected place and retains the server boundary and extent",async()=>{
  const boundary={kind:"county",geoid:"06067",label:"SYNTHETIC server county",geojson:polygon(),bbox:{minLon:170,minLat:38,maxLon:-170,maxLat:39}};
  resolve.mockResolvedValue(boundary);
  const result=await preparePlanContext({...command(),place:{mode:"place",kind:"county",geoid:"06067",label:"Study area"}},ca,id(3));
  expect(resolve).toHaveBeenCalledWith("county","06067");expect(result.ok).toBe(true);if(!result.ok)throw Error("fixture");
  expect(result.context.place).toMatchObject({source:"tigerweb",kind:"county",ref:"06067",countryCode:"US",subdivisionCode:"CA",bbox:boundary.bbox,geometry:polygon()});
  boundary.bbox.minLon=0;expect(result.context.place.bbox.minLon).toBe(170);
 });
 it.each(["unavailable","wrong-kind","wrong-id","error"])("refuses a %s resolver result without saving guessed geography",async fault=>{
  const boundary={kind:"county",geoid:"06067",label:"SYNTHETIC",geojson:polygon(),bbox:{minLon:-122,minLat:38,maxLon:-121,maxLat:39}};
  if(fault==="error") resolve.mockRejectedValue(Error("unavailable"));
  else resolve.mockResolvedValue(fault==="unavailable"?null:{...boundary,...(fault==="wrong-kind"?{kind:"place"}:{}),...(fault==="wrong-id"?{geoid:"41051"}:{})});
  const result=await preparePlanContext({...command(),place:{mode:"place",kind:"county",geoid:"06067",label:"Study area"}},ca,id(3));
  expect(result).toMatchObject({ok:false,status:503});
 });
 it("refuses unsupported authority before resolving the independent study place",async()=>{
  const value=command();value.assessment.authorities[0].jurisdiction={country:"US",subdivision:"OR"};
  expect(await preparePlanContext(value,ca,id(3))).toMatchObject({ok:false,status:409});expect(resolve).not.toHaveBeenCalled();
 });
 it("rejects projected coordinates, open rings and client-supplied resolver facts",()=>{
  for(const geometry of [{type:"Polygon",coordinates:[[[600000,4300000],[600100,4300000],[600100,4300100],[600000,4300000]]]},{type:"Polygon",coordinates:[[[-122,38],[-121,38],[-121,39],[-122,39]]]}]) {
   expect(studyAreaCaptureSchema.safeParse({mode:"uploaded",label:"Area",geometry}).success).toBe(false);
  }
  expect(studyAreaCaptureSchema.safeParse({...command().place,countryCode:"US"}).success).toBe(false);
 });
 it("keeps stored absence and malformed attributed context distinct from a valid copy",async()=>{
  const result=await preparePlanContext(command(),ca,id(3));if(!result.ok)throw Error("fixture");
  expect(readSavedPlanContext(result.context)).toEqual({status:"retained",context:result.context});expect(readSavedPlanContext(null)).toEqual({status:"legacy"});
  expect(readSavedPlanContext(undefined)).toEqual({status:"invalid"});
  expect(readSavedPlanContext({...result.context,savedBy:"client label"})).toEqual({status:"invalid"});
  expect(readSavedPlanContext({...result.context,place:{...result.context.place,countryCode:"US"}})).toEqual({status:"invalid"});
  expect(placeOfRecordFromCapturedArea({mode:"drawn",label:"Empty",geometry:{type:"Polygon",coordinates:[]}})).toBeNull();
 });
});
