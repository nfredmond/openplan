import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildWorkProgramHtml, buildWorkProgramWorkbook, writeWorkProgramWorkbook } from "@/lib/programs/work-program/export";
import { proposeSourceElement, validateWorkProgramSources } from "@/lib/programs/work-program/source-review";
import type { WorkProgramSource, WorkProgramRevision } from "@/lib/programs/work-program/types";
import { describe, expect, it } from "vitest";
import { workProgramDraftSchema, reconcileWorkProgram, type WorkProgramDraft } from "@/lib/programs/work-program/schema";
import { extractWorkProgramSource } from "@/lib/programs/work-program/source-extraction";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function draft(): WorkProgramDraft {
  return {
    schemaVersion: 1, documentKind: "owp", agency: "Synthetic planning agency", responsibleAuthority: "Synthetic board",
    authorityBasis: "Exercise only", periodStart: "2026-07-01", periodEnd: "2027-06-30", introduction: "", staffing: "", financialNotes: "",
    currency: "USD", priorBalance: null, priorBalanceBasis: "", elements: [{
      id: id(1), source: { sourceId: id(20), elementKey: "100:page-19", pageFrom: 19, pageTo: 19, tableLabel: "Work element budget" }, code: "100", title: "Program administration",
      disposition: "continuing", decisionNote: "Propose another annual reporting cycle; prior completion remains in the source.",
      objective: "", discussion: "", responsible: "", schedule: "", personMonths: null, tasks: [], products: [], projectId: null,
      budgetTreatment: "included", budgetTreatmentNote: "",
      budget: [{ id: id(2), kind: "revenue", label: "Planning funds", amount: 51.75, fundingYear: "2026-27", basis: "proposed", note: "" },
        { id: id(3), kind: "cost", label: "Agency work", amount: 51.75, fundingYear: "2026-27", basis: "proposed", note: "" }],
    }],
  };
}

describe("work-program preparation boundaries", () => {
  it("reconciles proposed figures in cents while retaining an unresolved prior balance", () => {
    const value = workProgramDraftSchema.parse(draft());
    expect(reconcileWorkProgram(value)).toEqual({ revenue: 51.75, cost: 51.75, difference: 0, unresolvedDecisions: 0, missingBudgetElements: 0, missingAmounts: 0, unresolvedBudgetTreatments: 0, priorBalanceUnresolved: true });
    value.elements[0].budget[1].amount = 50;
    expect(reconcileWorkProgram(value).difference).toBe(1.75);
  });
  it("withholds a combined budget beyond exact cent arithmetic", () => {
    const value = draft();
    value.elements[0].budget = Array.from({ length: 100 }, (_, index) => ({ ...value.elements[0].budget[0], id: id(100 + index), amount: 1e12 }));
    expect(workProgramDraftSchema.safeParse(value).success).toBe(false);
    expect(reconcileWorkProgram(value).revenue).toBeNull();
  });
  it("does not turn missing figures or missing work-element budgets into zero", () => {
    const value = draft(); value.elements[0].budget[0].amount = null;
    expect(reconcileWorkProgram(value)).toMatchObject({ revenue: null, difference: null, missingAmounts: 1 });
    value.elements.push({ ...value.elements[0], id: id(4), source: null, budget: [] });
    expect(reconcileWorkProgram(value)).toMatchObject({ cost: null, difference: null, missingBudgetElements: 1 });
  });
  it("excludes completed predecessor work without erasing it", () => {
    const value = draft(); value.elements[0].disposition = "completed";
    expect(reconcileWorkProgram(value)).toMatchObject({ revenue: null, cost: null });
    expect(value.elements).toHaveLength(1);
  });
  it("refuses duplicate predecessor carriage, invented approval fields, invalid dates and unexplained decisions", () => {
    const value = draft(); value.elements.push({ ...value.elements[0], id: id(5), budget: [] });
    expect(workProgramDraftSchema.safeParse(value).success).toBe(false);
    expect(workProgramDraftSchema.safeParse({ ...draft(), approved: true }).success).toBe(false);
    expect(workProgramDraftSchema.safeParse({ ...draft(), periodStart: "2026-02-30" }).success).toBe(false);
    expect(workProgramDraftSchema.safeParse({ ...draft(), periodEnd: "2025-01-01" }).success).toBe(false);
    const unexplained = draft(); unexplained.elements[0].decisionNote = "";
    expect(workProgramDraftSchema.safeParse(unexplained).success).toBe(false);
    const fractional = draft(); fractional.elements[0].budget[0].amount = 1.001;
    expect(workProgramDraftSchema.safeParse(fractional).success).toBe(false);
  });
});

const identity = { page: 1, text: "El Dorado County Transportation Commission\nOverall Work Program and Budget" };
// Short factual source-layout fixtures; not fabricated agency evidence.
const elementPage = { page: 19, text: "WORK ELEMENT 100\nADMINISTRATION OF THE OVERALL WORK PROGRAM\nObjective\nExample objective\nDiscussion\nExample discussion\nPrevious Work Activities Completed\nPrior work\nCurrent Work Activities\nCurrent work\nEnd Products\nProduct\nCompletion Schedule\nJuly through June\nWork Element Budget\nRevenues Expenditures\nTOTALS $51,752 $51,752" };

describe("source-layout extraction", () => {
  it("recognizes plural Objectives without copying the paragraph into the title", () => {
    const plural = { ...elementPage, text: elementPage.text.replace("Objective\n", "Objectives\n") };
    expect(extractWorkProgramSource([identity, plural]).elements[0]).toMatchObject({ title: "ADMINISTRATION OF THE OVERALL WORK PROGRAM", objective: "Example objective" });
  });
  it("does not manufacture a work element from the section divider", () => {
    expect(extractWorkProgramSource([identity, { page: 15, text: "WORK ELEMENT DETAIL" }, elementPage]).elements.map((row) => row.code)).toEqual(["100"]);
  });
  it("retains the source page when PDF table text precedes its heading", () => {
    const reordered = { page: 26, text: "WORK ELEMENT 122\nExample title\nObjective\nExample\nTOTALS $28,963 $28,963\nCompletion Schedule\nJuly through June\nWork Element Budget\nRevenues Expenditures" };
    expect(extractWorkProgramSource([identity, reordered]).elements[0]).toMatchObject({ revenueTotal: 28963, costTotal: 28963, budgetText: reordered.text });
  });
  it("keeps source text, actual PDF pages and printed figures separate from the proposed program", () => {
    const result = extractWorkProgramSource([identity, elementPage]);
    expect(result.parser).toBe("edctc-work-program-v2");
    expect(result.elements[0]).toMatchObject({ code: "100", key: "100:page-19", pageFrom: 19, pageTo: 19, revenueTotal: 51752, costTotal: 51752, priorActivities: "Prior work", currentActivities: "Current work", originalText: elementPage.text });
    expect(result.elements[0].warnings.join(" ")).toContain("breakdown");
  });
  it("preserves alphanumeric work-element identifiers and multiple source pages", () => {
    const first = { page: 34, text: "WORK ELEMENT 200EIR\nENVIRONMENTAL IMPACT REPORT\nObjective\nExample" };
    const last = { page: 35, text: "Work Element Budget\nRevenues Expenditures\nTOTALS $10 $12" };
    const result = extractWorkProgramSource([identity, first, last]);
    expect(result.elements[0]).toMatchObject({ code: "200EIR", pageFrom: 34, pageTo: 35, revenueTotal: 10, costTotal: 12 });
  });
  it("withholds figures from reversed or unreadable tables and keeps unknown formats manual", () => {
    const reversed = { ...elementPage, text: elementPage.text.replace("Revenues Expenditures", "Expenditures Revenues") };
    expect(extractWorkProgramSource([identity, reversed]).elements[0]).toMatchObject({ revenueTotal: null, costTotal: null });
    const other = extractWorkProgramSource([{ page: 1, text: "Another agency work program" }, elementPage]);
    expect(other).toMatchObject({ parser: "manual-page-review", elements: [] });
    expect(other.warnings[0]).toContain("not recognized");
  });
});

function sourceRecord(): WorkProgramSource {
  return { id: id(20), document_id: id(21), document_checksum: "a".repeat(64), title: "Synthetic source", source_role: "predecessor", source_url: "https://example.test/source.pdf", page_count: 19, created_at: "2026-09-06T10:00:00Z", extraction_json: extractWorkProgramSource([identity, elementPage]) };
}
function revisionRecord(value = draft()): WorkProgramRevision {
  return { id: id(30), revision: 1, previous_revision_id: null, request_id: id(31), content_json: value, content_sha256: "b".repeat(64), source_ids: [id(20)], created_by: id(32), created_at: "2026-09-06T11:00:00Z" };
}

describe("reviewed source references and financial treatment", () => {
  it("copies source narrative without promoting prior figures, schedule or owners", () => {
    const source = sourceRecord();
    const proposed = proposeSourceElement(source, source.extraction_json.elements[0]);
    expect(proposed).toMatchObject({ source: { sourceId: source.id, elementKey: "100:page-19", pageFrom: 19, pageTo: 19 }, disposition: "unresolved", budgetTreatment: "unresolved", responsible: "", schedule: "", personMonths: null, budget: [] });
    expect(proposed.tasks[0]).toMatchObject({ description: "Current work", responsible: "", schedule: "" });
    expect(proposed.products[0].description).toBe("Product");
  });
  it("requires real retained keys and pages, while allowing manual citations in other layouts", () => {
    const value = draft(); const sources = [sourceRecord()];
    expect(validateWorkProgramSources(value, sources)).toBeNull();
    expect(validateWorkProgramSources(value, [])).toContain("not attached");
    value.elements[0].source!.pageTo = 20;
    expect(validateWorkProgramSources(value, sources)).toContain("outside");
    value.elements[0].source!.pageTo = 19; value.elements[0].source!.elementKey = "200";
    expect(validateWorkProgramSources(value, sources)).toContain("does not match");
    value.elements[0].source!.elementKey = null; value.elements[0].source!.pageFrom = 2;
    expect(validateWorkProgramSources(value, sources)).toBeNull();
    value.elements[0].source!.pageFrom = 20;
    expect(workProgramDraftSchema.safeParse(value).success).toBe(false);
  });
  it("requires an explanation before excluding an allocated indirect schedule and does not count it twice", () => {
    const value = draft();
    value.elements.push({ ...value.elements[0], id: id(41), source: null, budgetTreatment: "informational", budgetTreatmentNote: "Allocated in element 100", budget: [{ ...value.elements[0].budget[1], id: id(42), amount: 400 }] });
    expect(workProgramDraftSchema.safeParse(value).success).toBe(true);
    expect(reconcileWorkProgram(value)).toMatchObject({ revenue: 51.75, cost: 51.75, difference: 0 });
    value.elements[1].budgetTreatmentNote = "";
    expect(workProgramDraftSchema.safeParse(value).success).toBe(false);
    value.elements[1].budgetTreatment = "unresolved";
    expect(reconcileWorkProgram(value)).toMatchObject({ revenue: null, cost: null, unresolvedBudgetTreatments: 1 });
  });
});

describe("saved proposal exports", () => {
  it("requests automatic recalculation in the delivered XLSX package", async () => {
    const bytes = await writeWorkProgramWorkbook(buildWorkProgramWorkbook(revisionRecord(), [sourceRecord()]));
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("xl/workbook.xml")!.async("string");
    expect(xml).toContain('calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"');
    expect(XLSX.read(bytes, { type: "array" }).Sheets.Reconciliation.B9.f).toContain("ISNUMBER");
  });
  it("includes the carried work, original citations, revision custody and unresolved figures in readable HTML", () => {
    const value = draft(); value.introduction = '<script>alert("bad")</script>'; value.elements[0].budget[1].amount = null;
    const html = buildWorkProgramHtml(revisionRecord(value), [sourceRecord()]);
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain('<script>');
    expect(html).toContain("PDF pages 19-19"); expect(html).toContain("a".repeat(64)); expect(html).toContain("b".repeat(64));
    expect(html).toContain("Unresolved"); expect(html).toContain("No adoption, spending authority");
    expect(html).toContain(value.elements[0].decisionNote);
  });
  it("keeps typed amounts and null cells, carries all source coverage, and writes formulas only in reconciliation cells", () => {
    const value = draft(); value.elements[0].budget[0].label = '=HYPERLINK("https://example.test")'; value.elements[0].budget[1].amount = null;
    const workbook = buildWorkProgramWorkbook(revisionRecord(value), [sourceRecord()]);
    const reopened = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellFormula: true });
    expect(reopened.Sheets["Budget lines"].F2).toMatchObject({ t: "s", v: value.elements[0].budget[0].label });
    expect(reopened.Sheets["Budget lines"].F2.f).toBeUndefined();
    expect(reopened.Sheets["Budget lines"].C2.f).toBe("'Work elements'!D2");
    expect(reopened.Sheets["Budget lines"].D2.f).toBe("'Work elements'!K2");
    expect(reopened.Sheets["Budget lines"].K2.v).toBe(value.elements[0].budget[0].id);
    expect(reopened.Sheets["Budget lines"].I2).toMatchObject({ t: "n", v: 51.75 });
    expect(reopened.Sheets["Budget lines"].I3).toBeUndefined();
    expect(reopened.Sheets.Reconciliation.B7).toMatchObject({ v: 51.75 });
    expect(reopened.Sheets.Reconciliation.B8).toMatchObject({ v: "Unresolved" });
    expect(reopened.Sheets.Reconciliation.B7.f).toContain("SUMIFS");
    expect(reopened.Sheets.Reconciliation.B9.f).toContain("ISNUMBER");
    expect(reopened.Sheets["Source coverage"].F2.v).toBe(value.elements[0].id);
    expect(reopened.Sheets.Sources.E2.v).toBe("a".repeat(64));
  });
});
