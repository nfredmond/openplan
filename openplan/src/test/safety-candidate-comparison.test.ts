/** AUTHORED, UNEXECUTED. Schema/render tests cannot establish SQL, locks, source coverage or UI. */
import { describe,expect,it } from "vitest";
import { safetyComparisonInputsSchema, safetyComparisonCostSchema, SAFETY_V2_NOFO_REFUSAL } from "@/lib/safety/candidate-comparison";
import { renderSafetyComparisonCsv,renderSafetyComparisonHtml } from "@/lib/reports/safety-comparison-render";
import { comparisonFixture,comparisonInputs,comparisonId,rehashComparison,comparisonCostFixture } from "./fixtures/safety/comparison";

describe("bounded Safety input review",()=>{
  it.each(["stored", "ready"] as const)("retains an actual %s estimate source without requiring text indexing", status => {
    const cost = comparisonCostFixture(status);
    const result = safetyComparisonCostSchema.safeParse(cost);
    expect(result.success).toBe(true);
    expect(result.data?.sourceDocument?.status).toBe(status);
    expect(safetyComparisonCostSchema.safeParse({ ...cost, sourceDocument: { ...cost.sourceDocument, status: "pending" } }).success).toBe(false);
    expect(safetyComparisonCostSchema.safeParse({ ...cost, sourceDocument: { ...cost.sourceDocument, status: "failed" } }).success).toBe(false);
    expect(safetyComparisonCostSchema.safeParse({ ...cost, sourceDocument: null }).success).toBe(true);
  });
  it("saves unknown evidence and one No Build without inventing effects",()=>{
    const input=comparisonInputs();expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(true);
    input.alternatives[1].name="Harmless display label";expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(true);
    expect(safetyComparisonInputsSchema.safeParse({...input,avoidedCrashes:4}).success).toBe(false);
    expect(safetyComparisonInputsSchema.safeParse({...input,alternatives:input.alternatives.map(a=>({...a,effect:"assessed"}))}).success).toBe(false);
    expect(safetyComparisonInputsSchema.safeParse({...input,alternatives:input.alternatives.map(a=>({...a,cmf:0.9}))}).success).toBe(false);
    expect(safetyComparisonInputsSchema.safeParse({...input,alternatives:[input.alternatives[1],{...input.alternatives[1],id:comparisonId(50)}]}).success).toBe(false);
    expect(safetyComparisonInputsSchema.safeParse({...input,alternatives:[...input.alternatives,input.alternatives[1]]}).success).toBe(false);
    expect(safetyComparisonInputsSchema.safeParse({...input,alternatives:[input.alternatives[0],...Array.from({length:11},(_,n)=>({...input.alternatives[1],id:comparisonId(100+n)}))]}).success).toBe(false);
  });
  it("does not turn unsupported or unsourced conditions into a match or an exemption",()=>{
    const input=comparisonInputs();input.alternatives[1].applicability="matched";
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(false);
    input.alternatives[1].conditions=[{requiredCondition:"Synthetic published condition",siteFact:{state:"unknown",reason:"No retained source"},finding:"not_applicable",rationale:"A checkbox is not evidence"}];
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(false);
    input.alternatives[1].applicability="unknown";input.alternatives[1].conditions[0].finding="unknown";
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(true);
  });
  it("refuses unclosed and wrapped influence polygons without inventing another place resolver",()=>{
    const input=comparisonInputs();input.influenceArea.coordinates[0][4]=[0,1];
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(false);
    input.influenceArea.coordinates[0]=[[179,0],[-179,0],[-179,1],[179,1],[179,0]];
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(false);
  });
  it.each(["matched", "mismatched", "not_applicable"] as const)("requires recorded support for overall %s, while unknown stays saveable", finding => {
    const input = comparisonInputs();
    input.alternatives[1].conditions = [{ requiredCondition: "Synthetic condition", siteFact: { state: "unknown", reason: "No retained fact" }, finding: "unknown", rationale: "Not yet reviewed" }];
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(true);
    input.alternatives[1].applicability = finding;
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(false);
    input.alternatives[1].conditions[0] = { requiredCondition: "Synthetic condition", siteFact: { state: "recorded", value: "Synthetic fact", unit: null, source: "Synthetic source", locator: "Synthetic page", retainedQuotation: "Synthetic quotation", sourceUrl: null, sourceDate: null, retrievedAt: null, spatialTemporalScope: "Synthetic scope", retentionBasis: "Synthetic fixture" }, finding, rationale: "Synthetic comparison" };
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(true);
  });
  it("refuses an unsourced condition even when the overall finding remains unknown", () => {
    const input = comparisonInputs();
    input.alternatives[1].conditions = [{ requiredCondition: "Synthetic condition", siteFact: { state: "unknown", reason: "Not recorded" }, finding: "not_applicable", rationale: "Unsupported exemption" }];
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(false);
  });
  it.each(["unknown", "mismatched"] as const)("refuses an overall match with a %s required condition", finding => {
    const input = comparisonInputs();
    const fact = { state: "recorded" as const, value: "Synthetic fact", unit: null, source: "Synthetic source", locator: "Synthetic page", retainedQuotation: "Synthetic quotation", sourceUrl: null, sourceDate: null, retrievedAt: null, spatialTemporalScope: "Synthetic scope", retentionBasis: "Synthetic fixture" };
    input.alternatives[1].applicability = "matched";
    input.alternatives[1].conditions = [{ requiredCondition: "First condition", siteFact: fact, finding: "matched", rationale: "Synthetic support" }, { requiredCondition: "Second condition", siteFact: fact, finding, rationale: "Synthetic incomplete or contrary support" }];
    expect(safetyComparisonInputsSchema.safeParse(input).success).toBe(false);
  });
  it("exports exact decimal cost strings, unknown year and contextual scope without a normalized rank",()=>{
    const row=comparisonFixture();const cost={ alternativeId:row.payload.inputs.alternatives[1].id,originProjectId:row.project_id,amount:"99999999999999.91",currency:"USD",priceYear:null,recordedAt:null,recordedBy:null,sourceDocument:null,scopeRelationship:"context_only" as const,estimatingBasis:{state:"unknown" as const,reason:"No basis"},includedElements:{state:"unknown" as const,reason:"No elements"},precision:"retained_database_decimal_not_historical_precision_recovery" as const,normalizedComparison:"unassessed" as const};
    expect(safetyComparisonCostSchema.safeParse(cost).success).toBe(true);
    expect(safetyComparisonCostSchema.safeParse({...cost,amount:Number(cost.amount)}).success).toBe(false);
    expect(safetyComparisonCostSchema.safeParse({...cost,amount:"2.001"}).success).toBe(false);
    row.payload.costs=[cost];rehashComparison(row);
    const csv=renderSafetyComparisonCsv(row),html=renderSafetyComparisonHtml(row);
    expect(csv).toContain("\"'99999999999999.91\"");expect(csv).toContain('"Unknown"');
    expect(html).toContain("99,999,999,999,999.91");expect(html).toContain("Price year: Unknown");expect(html).toContain("context_only");
    expect(html).toContain(SAFETY_V2_NOFO_REFUSAL);expect(html).toContain("0 included stored mapped observations");
  });
  it("quotes source text and formula-like alternative names without leaking member identities",()=>{
    const row=comparisonFixture();row.payload.inputs.alternatives[0].name='=HYPERLINK("bad")';row.payload.inputs.findings='<script>bad()</script>';
    const html=renderSafetyComparisonHtml(row),csv=renderSafetyComparisonCsv(row);
    expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(csv).toContain("'=HYPERLINK");expect(html).not.toContain("external_id");
  });
});
