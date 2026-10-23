/** Synthetic structural fixture. No observed place, crash, CMF or scientific claim. */
import { createHash } from "node:crypto";
import { SAFETY_COMPARISON_MEMBER_FIELDS, type SafetyComparisonInputs, type SafetyComparisonRecord } from "@/lib/safety/candidate-comparison";
export const comparisonId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const comparisonRevision = "2026-10-19T12:00:00.123456+00:00";
export function comparisonInputs(): SafetyComparisonInputs {
  const unknown = { state:"unknown" as const,reason:"Synthetic missing fact." };
  const polygon = { type:"Polygon" as const,coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]] as [number,number][][] };
  return { title:"Synthetic input review",acquisitionId:comparisonId(5),siteLabel:"Synthetic site",siteIdentity:unknown,
    influenceArea:polygon,analysisGeometry:polygon,influenceRationale:"Synthetic explicit rectangle.",selectedYears:[2020],severities:["fatal"],involvement:"all",siteFacts:[],
    alternatives:["no_build","treatment"].map((kind,index)=>({ id:comparisonId(10+index),kind:kind as "no_build"|"treatment",name:kind,scope:"Synthetic scope.",operatingAssumptions:"Synthetic operating assumptions.",treatmentDescription:"Synthetic description, no CMF.",proposedTimeRange:unknown,applicability:"unknown",applicabilityRationale:"No sourced match.",conditions:[],cost:{kind:"missing",reason:"No estimate."},effect:"unassessed",effectReason:"No qualified primary CMF/site record." })),findings:"Synthetic incomplete review." };
}
export function comparisonFixture(): SafetyComparisonRecord {
  const payload: SafetyComparisonRecord["payload"] = { version:"openplan.safety-comparison.v2",inputs:comparisonInputs(),
    source:{ acquisition:{id:comparisonId(5),workspace_id:comparisonId(2),project_id:comparisonId(3),evidence_revision:"1",status:"ready",
      min_lon:0,min_lat:0,max_lon:1,max_lat:1,source_id:"synthetic",source_label:"Synthetic source",attribution:"Synthetic fixture, not observations",coverage_state:"source_unavailable",severity_completeness:"fatal_only",years_requested:[2020],crash_count:0,geocoded_count:0,stored_count:null,truncated:false,created_at:comparisonRevision,updated_at:comparisonRevision,dimension_coverage:{},party_completeness:"not_supported",party_count:null,involvement_basis:null,published_through:null,published_through_provenance:null},
      acquisitionHash:"b".repeat(64),projectId:comparisonId(3),projectName:"Synthetic project",projectRevision:comparisonRevision,reportRevision:comparisonRevision,geometryHash:"c".repeat(64),analysisGeometryHash:"d".repeat(64),vocabularyVersion:"neutral-crash-storage-20260812",catalog:"descriptive-only-no-numerical-cmf-consumed",legacyDerivedFrom:null,rawSourceHash:null,rawSourceState:"unavailable",roadContext:"unassessed_no_road_geometry_consumed" },
    capture:{method:"postgis-covers-wgs84-v1",unit:"crash",projection:[...SAFETY_COMPARISON_MEMBER_FIELDS],membersHash:"a".repeat(64),stored:0,included:0,excluded:0,indeterminate:0,reasonCounts:{},populationCoverage:"unassessed",coverageReason:"Synthetic zero stored matches does not prove population coverage."},
    costs:[],effect:"unassessed",programBasis:"missing_exact_fy_nofo",authorship:"human_entered_source_review" };
  return {id:comparisonId(6),workspace_id:comparisonId(2),project_id:comparisonId(3),report_id:comparisonId(4),parent_revision_id:null,created_by:comparisonId(1),created_at:comparisonRevision,
    content_text:JSON.stringify(payload),content_hash:createHash("sha256").update(JSON.stringify(payload)).digest("hex"),payload};
}
export function rehashComparison(row: SafetyComparisonRecord) {
  row.content_text=JSON.stringify(row.payload);row.content_hash=createHash("sha256").update(row.content_text).digest("hex");return row;
}

export function comparisonCostFixture(status: "stored" | "ready" = "stored"): SafetyComparisonRecord["payload"]["costs"][number] {
  return { alternativeId: comparisonId(11), originProjectId: comparisonId(3), amount: "100.01", currency: "USD", priceYear: null, recordedAt: null, recordedBy: null,
    sourceDocument: { id: comparisonId(80), title: "Synthetic retained estimate.xlsx", checksum: "e".repeat(64), updatedAt: comparisonRevision, status },
    scopeRelationship: "context_only", estimatingBasis: { state: "unknown", reason: "Synthetic missing basis" }, includedElements: { state: "unknown", reason: "Synthetic missing elements" },
    precision: "retained_database_decimal_not_historical_precision_recovery", normalizedComparison: "unassessed" };
}
