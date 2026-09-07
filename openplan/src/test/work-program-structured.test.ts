import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { workProgramDraftSchema, type WorkProgramDraft } from "@/lib/programs/work-program/schema";
import { emptyStructuredPreparation, reconcileStructuredWorkProgram } from "@/lib/programs/work-program/reconciliation";
import { recoverWorkProgramDraft, upgradeWorkProgramDraft } from "@/lib/programs/work-program/draft-recovery";
import { selectWorkProgramSources, validateWorkProgramSources, workProgramCoverage } from "@/lib/programs/work-program/source-review";
import type { WorkProgramSource } from "@/lib/programs/work-program/types";

function example() {
  const sourceId = randomUUID(), elementId = randomUUID(), fundId = randomUUID();
  const ref = { sourceId, extractionVersionId: null, elementKey: null, pageFrom: 1, pageTo: 1, tableLabel: "Synthetic arithmetic fixture" };
  const identity = () => ({ id: randomUUID(), sourceRefs: [ref] });
  const draft: WorkProgramDraft = { schemaVersion: 1, documentKind: "owp", agency: "Synthetic test agency", responsibleAuthority: "Test only", authorityBasis: "Fixture", periodStart: "2026-07-01", periodEnd: "2027-06-30", introduction: "", staffing: "", financialNotes: "", currency: "USD", priorBalance: null, priorBalanceBasis: "", elements: [{ id: elementId, source: ref, code: "A", title: "Synthetic work", disposition: "continuing", decisionNote: "Fixture only", objective: "Preserve edited text", discussion: "", responsible: "", schedule: "", personMonths: null, budgetTreatment: "included", budgetTreatmentNote: "", tasks: [], products: [], budget: [], projectId: null }], preparation: emptyStructuredPreparation() };
  const p = draft.preparation!;
  p.funds.push({ ...identity(), id: fundId, name: "Planning", vintage: "2026", periodStart: draft.periodStart, periodEnd: draft.periodEnd, kind: "proposed", amount: 100, basis: "proposed", note: "Fixture only" });
  p.allocations.push({ ...identity(), elementId, taskId: null, fundId, amount: 100, matchForFundId: null, note: "Fixture only" });
  p.costs.push({ ...identity(), elementId, taskId: null, label: "Direct costs", category: "direct", amount: 100, contractId: null, indirectPoolId: null, note: "Fixture only" });
  const source: WorkProgramSource = { id: sourceId, document_id: randomUUID(), document_checksum: "a".repeat(64), source_role: "predecessor", source_url: null, page_count: 2, extraction_json: { parser: "manual-page-review", pageCount: 2, elements: [], warnings: [] }, created_at: "2026-09-06", title: "Synthetic original", versions: [] };
  return { draft, p, identity, ref, source, elementId, fundId };
}
const codes = (draft: WorkProgramDraft) => reconcileStructuredWorkProgram(draft).issues.map((issue) => issue.code);

describe("structured work-program proposal", () => {
  it.each([["2027-07-01", "2026-06-30"], ["2020-07-01", "2021-06-30"], ["2026-08-01", "2027-06-30"]])("withholds funding outside the proposal cycle %s to %s", (start, end) => {
    const { draft, p } = example();
    p.funds[0].periodStart = start; p.funds[0].periodEnd = end;
    const result = reconcileStructuredWorkProgram(draft);
    expect(result.revenue).toBeNull(); expect(result.byFund[0].available).toBeNull();
    expect(codes(draft)).toContain("fund_period");
    p.funds[0].periodStart = "2025-07-01"; p.funds[0].periodEnd = "2028-06-30";
    expect(reconcileStructuredWorkProgram(draft).revenue).toBe(100);
  });

  it.each([["percent_funded_amount", 5, 0.7, 0.04], ["percent_total_cost", 0.11, 12, 0.02]] as const)("rounds exact fractional-cent match once for %s", (basis, funded, percent, expected) => {
    const { draft, p } = example();
    Object.assign(p.funds[0], { amount: funded, matchBasis: basis, matchValue: percent, matchNote: "Explicit synthetic requirement" });
    p.allocations[0].amount = funded;
    expect(reconcileStructuredWorkProgram(draft).byFund[0].requiredMatch).toBe(expected);
    p.funds[0].sourceRefs = [];
    expect(reconcileStructuredWorkProgram(draft).byFund[0].requiredMatch).toBeNull();
  });

  it("reconciles exact cents from allocations and costs, without adding prior authority or balances", () => {
    const { draft, p, identity } = example();
    p.funds.push({ ...p.funds[0], ...identity(), kind: "prior_authority", amount: 999999, basis: "reference" }, { ...p.funds[0], ...identity(), kind: "prior_balance", amount: 444, basis: "reference" });
    expect(reconcileStructuredWorkProgram(draft)).toMatchObject({ revenue: 100, cost: 100, difference: 0 });
    p.allocations[0].amount = 0.3; p.funds[0].amount = 0.3;
    p.costs[0].amount = 0.1; p.costs.push({ ...p.costs[0], ...identity(), amount: 0.2 });
    expect(reconcileStructuredWorkProgram(draft)).toMatchObject({ revenue: 0.3, cost: 0.3, difference: 0 });
    expect(workProgramDraftSchema.safeParse(draft).success).toBe(true);
  });
  it("keeps funding vintages separate, detects duplicate allocations and over-allocation", () => {
    const { draft, p, identity } = example();
    p.funds.push({ ...p.funds[0], ...identity(), vintage: "2025 carryover", kind: "carryover", amount: 50 });
    p.allocations.push({ ...p.allocations[0], ...identity(), amount: 25 });
    const result = reconcileStructuredWorkProgram(draft);
    expect(result.byFund[0]).toMatchObject({ allocated: 125, remainder: -25 });
    expect(result.byFund[1]).toMatchObject({ allocated: 0, remainder: 50 });
    expect(codes(draft)).toEqual(expect.arrayContaining(["duplicate_allocation", "fund_overallocated", "fund_unallocated", "funding_gap"]));
  });
  it("preserves missing money and refuses reference balances as proposed funding", () => {
    const { draft, p } = example();
    p.costs[0].amount = null;
    expect(reconcileStructuredWorkProgram(draft)).toMatchObject({ revenue: 100, cost: null, difference: null });
    p.funds[0].kind = "prior_balance";
    expect(reconcileStructuredWorkProgram(draft).revenue).toBeNull();
    expect(codes(draft)).toContain("reference_allocation");
  });
  it("requires a separate match source and a source-linked indirect pool counted once", () => {
    const { draft, p, identity } = example();
    p.allocations[0].matchForFundId = p.funds[0].id;
    expect(codes(draft)).toContain("invalid_match");
    const pool = { ...identity(), name: "Indirect", amount: 20, note: "Allocated once" };
    p.indirectPools.push(pool); p.costs[0].amount = 80;
    p.costs.push({ ...p.costs[0], ...identity(), category: "indirect", amount: 20, indirectPoolId: pool.id });
    expect(reconcileStructuredWorkProgram(draft).cost).toBe(100);
    expect(codes(draft)).not.toContain("indirect_reconciliation");
    p.costs[1].amount = 21;
    expect(codes(draft)).toContain("indirect_reconciliation");
    p.costs[1].indirectPoolId = null;
    expect(codes(draft)).toContain("indirect_basis");
  });
  it("never treats billing rates as labor cost or invents FTE capacity", () => {
    const { draft, p, identity, elementId } = example(); p.costs = [];
    p.staffing.push({ ...identity(), elementId, taskId: null, staffId: null, role: "Unfilled planner", periodStart: draft.periodStart, periodEnd: draft.periodEnd, quantity: 0.5, unit: "fte", capacityHours: null, capacityBasis: "", costTreatment: "calculate", rate: 10.01, rateBasis: "billing", rateStart: draft.periodStart, rateEnd: draft.periodEnd, rateNote: "Source assumption", includesIndirect: false });
    expect(reconcileStructuredWorkProgram(draft).cost).toBeNull();
    expect(codes(draft)).toEqual(expect.arrayContaining(["labor_rate", "staff_capacity"]));
    p.staffing[0].hoursPerUnit = 10; p.staffing[0].capacityHours = 10; p.staffing[0].capacityBasis = "Ten-hour synthetic capacity"; p.staffing[0].rateBasis = "labor_cost";
    expect(reconcileStructuredWorkProgram(draft).cost).toBe(50.05);
    p.staffing[0].rateStart = "2026-08-01";
    expect(reconcileStructuredWorkProgram(draft).cost).toBeNull();
  });
  it("detects staff over-allocation and double labor or indirect costs", () => {
    const { draft, p, identity, elementId } = example();
    p.staffing.push({ ...identity(), elementId, taskId: null, staffId: null, role: "Planner", periodStart: draft.periodStart, periodEnd: draft.periodEnd, quantity: 101, unit: "hours", capacityHours: 100, capacityBasis: "Fixture capacity", costTreatment: "calculate", rate: 10, rateBasis: "labor_cost", rateStart: draft.periodStart, rateEnd: draft.periodEnd, rateNote: "Fixture", includesIndirect: true });
    p.costs[0].category = "labor_summary";
    p.costs.push({ ...p.costs[0], ...identity(), category: "indirect" });
    expect(codes(draft)).toEqual(expect.arrayContaining(["staff_overallocated", "double_labor", "double_indirect"]));
  });
  it("keeps unexplained amendments, split/merged mappings and source conflicts unresolved", () => {
    const { draft, p, identity, source } = example();
    p.amendments.push({ ...identity(), amendmentSourceId: source.id, modifiesSourceId: source.id, status: "applies", note: "" });
    p.mappings.push({ ...identity(), disposition: "split", targetIds: [], note: "Fixture split" }, { ...identity(), disposition: "merged", targetIds: [], note: "Fixture merge" });
    p.conflicts.push({ ...identity(), description: "Printed total differs", status: "resolved", resolution: "" });
    expect(codes(draft)).toEqual(expect.arrayContaining(["amendment_unresolved", "split_targets", "merge_sources", "source_conflict"]));
  });
  it("selects immutable source versions without rewriting corrections and rejects foreign versions", () => {
    const { draft, p, source } = example();
    const original = JSON.stringify(source.extraction_json);
    const versionId = randomUUID();
    source.versions!.push({ id: versionId, source_id: source.id, document_extraction_id: randomUUID(), extraction_json: { ...source.extraction_json, warnings: ["new version"] }, content_sha256: "b".repeat(64), page_count: 3, created_at: "2026-09-07" });
    p.extractionSelections.push({ sourceId: source.id, versionId });
    expect(selectWorkProgramSources(draft, [source])[0].extraction_json.warnings).toEqual(["new version"]);
    expect(JSON.stringify(source.extraction_json)).toBe(original);
    expect(draft.elements[0].objective).toBe("Preserve edited text");
    expect(validateWorkProgramSources(draft, [source])).toBeNull();
    p.costs[0].sourceRefs[0] = { ...p.costs[0].sourceRefs[0], extractionVersionId: randomUUID() };
    expect(validateWorkProgramSources(draft, [source])).toContain("outside this retained source");
  });
  it("reports every uncovered original page instead of treating comparison sources as complete", () => {
    const { draft, source } = example(); source.source_role = "comparison";
    expect(workProgramCoverage(draft, [source])[0].uncoveredPages).toEqual([2]);
    draft.preparation!.sourceSections.push({ id: randomUUID(), sourceRefs: [{ ...draft.elements[0].source!, pageFrom: 2, pageTo: 2 }], title: "Appendix", status: "reference_only", note: "Retained source authority, not new authority" });
    expect(workProgramCoverage(draft, [source])[0].uncoveredPages).toEqual([]);
  });
  it("recovers incomplete edits, rejects corrupt nested content, and retains the pending request identity", () => {
    const { draft } = example(); const requestId = randomUUID();
    const raw = JSON.stringify({ draft, baseRevision: 2, pending: { expectedRevision: 2, requestId, draft } });
    expect(recoverWorkProgramDraft(raw)?.pending?.requestId).toBe(requestId);
    draft.elements[0].decisionNote = "";
    expect(recoverWorkProgramDraft(JSON.stringify({ draft, baseRevision: 2, pending: null }))?.draft.elements[0].decisionNote).toBe("");
    const broken = JSON.parse(raw); broken.draft.elements[0].tasks = null;
    expect(recoverWorkProgramDraft(JSON.stringify(broken))).toBeNull();
    expect(recoverWorkProgramDraft("{" )).toBeNull();
    broken.draft = draft; broken.baseRevision = -1;
    expect(recoverWorkProgramDraft(JSON.stringify(broken))).toBeNull();
  });
  it("converts a new proposal without mutating historical JSON or inferring historical funding details", () => {
    const { draft, identity } = example(); delete draft.preparation;
    draft.elements[0].budget.push({ id: identity().id, kind: "revenue", label: "Legacy fund", amount: 100, fundingYear: "", basis: "proposed", note: "Legacy note" });
    const old = JSON.stringify(draft); const converted = upgradeWorkProgramDraft(draft);
    expect(JSON.stringify(draft)).toBe(old);
    expect(converted.preparation?.formatVersion).toBe(2);
    expect(converted.preparation?.funds[0]).toMatchObject({ amount: 100, basis: "unresolved", vintage: "" });
    expect(reconcileStructuredWorkProgram(converted).revenue).toBeNull();
  });
});
