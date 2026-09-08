import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { actualCommandSchema, cents, decimalText, summarizeReport, type ActualCommand, type ActualVersion, type ReportSnapshot } from "@/lib/programs/work-program/reporting";
import { previewActualCsv } from "@/lib/programs/work-program/reporting-import";
import { buildPeriodReportWorkbook, buildPeriodReportHtml } from "@/lib/programs/work-program/reporting-export";
import { utils } from "xlsx";
import JSZip from "jszip";
import { writeWorkProgramWorkbook } from "@/lib/programs/work-program/export";
function fixture() {
 const element = randomUUID(), task = randomUUID();
 const command: ActualCommand = actualCommandSchema.parse({ requestId: randomUUID(), entryId: randomUUID(), expectedVersion: 0, revisionId: randomUUID(), kind: "labor", status: "approved", entryDate: "2026-08-01", sourceKey: "synthetic-1", sourceReference: "Synthetic payroll source", description: "Engineering fixture, no agency spending", hours: "1.00", amount: "12.35", basis: "recorded", allocations: [{ elementId: element, taskId: task, share: 10000 }] });
 const actual: ActualVersion = { id: randomUUID(), entry_id: command.entryId, version: 1, revision_id: command.revisionId, source_key: command.sourceKey, entry_date: command.entryDate, kind: command.kind, staff_id: randomUUID(), staffName: "Synthetic staff", amount: command.amount, hours: command.hours, status: "approved", valuation_basis: "recorded", detail: command, created_at: "2026-09-01T00:00:00Z", allocations: [{ element_id: element, task_id: task, deliverable_id: null, share: 10000, amount: command.amount, hours: command.hours }] };
 const snapshot: ReportSnapshot = { schemaVersion: 1, period: { id: randomUUID(), name: "Synthetic August", starts_on: "2026-08-01", ends_on: "2026-08-31", baseline_id: command.revisionId, source_cutoff: "2026-09-01T01:00:00Z", version: 1, state: "review", progress: [{ elementId: element, taskId: null, asOf: "2026-08-31", completed: "First draft", outstanding: "Review", issues: "None reported", remainingCost: "20.01", remainingHours: "2.00", estimateBasis: "Synthetic remaining work estimate" }], note: "Synthetic", review_snapshot: null }, baseline: { id: command.revisionId, revision: 1, content_sha256: "a".repeat(64), source_ids: [], content_json: { schemaVersion: 1, documentKind: "owp", agency: "Synthetic agency", responsibleAuthority: "Synthetic board", authorityBasis: "No agency authority", periodStart: "2026-07-01", periodEnd: "2027-06-30", introduction: "", staffing: "", financialNotes: "", currency: "USD", priorBalance: null, priorBalanceBasis: "", elements: [{ id: element, source: null, code: "100", title: "Synthetic work", disposition: "continuing", decisionNote: "Continue synthetic work", objective: "", discussion: "", responsible: "", schedule: "", personMonths: null, budgetTreatment: "included", budgetTreatmentNote: "", tasks: [{ id: task, description: "Draft", responsible: "", schedule: "" }], products: [], budget: [{ id: randomUUID(), kind: "cost", label: "Cost", amount: 100.01, fundingYear: "2026", basis: "proposed", note: "" }], projectId: null }] } }, actuals: [actual], valuationHistory: [actual], reviewNote: "Synthetic review" };
 return { command, actual, snapshot, element, task };
}
describe("OWP report source reconciliation", () => {
 it("separates incurred cost from billed amounts, payments, commitments and remaining work", () => {
  const { snapshot, actual } = fixture();
  snapshot.actuals.push(...(["billed", "payment", "commitment"] as const).map(kind => ({ ...actual, id: randomUUID(), source_key: kind, kind, amount: "10.00", hours: null, allocations: actual.allocations.map(a => ({ ...a, amount: "10.00", hours: null })) })));
  const result = summarizeReport(snapshot);
  expect(result.total.cumulative).toEqual({ incurred: "12.35", billed: "10.00", payments: "10.00", commitments: "10.00", hours: "1.00" });
  expect(result.budget[0]).toMatchObject({ approved: "100.01", incurred: "12.35", budgetRemaining: "87.66", remainingEstimate: "20.01", actualPlusRemaining: "32.36" });
  for (const view of [result.byElement, result.byTask, result.byStaff, result.bySource]) expect(view.reduce((sum, v) => sum + cents(v.cumulative.incurred), BigInt(0))).toBe(BigInt(1235));
 });
 it("handles more than 1,000 sources and exact decimal totals beyond safe number arithmetic", () => {
  const { snapshot, actual } = fixture();
  snapshot.actuals = Array.from({ length: 1501 }, (_, i) => ({ ...actual, source_key: `source-${i}` }));
  expect(summarizeReport(snapshot).total.cumulative.incurred).toBe("18537.35");
  expect(decimalText(cents("9999999999999999.99") + cents("0.01"))).toBe("10000000000000000.00");
 });
 it("keeps opening balances cumulative and missing estimates incomplete", () => {
  const { snapshot, actual } = fixture();
  snapshot.actuals.push({ ...actual, kind: "opening", source_key: "opening", entry_date: "2026-08-01", hours: "0.00", allocations: actual.allocations.map(a => ({ ...a, hours: "0.00" })) });
  snapshot.period.progress[0].remainingCost = null;
  const result = summarizeReport(snapshot);
  expect(result.total.period.incurred).toBe("12.35");
  expect(result.total.cumulative.incurred).toBe("24.70");
  expect(result.budget[0].actualPlusRemaining).toBeNull();
 });
 it("keeps unknown opening hours explicit instead of claiming zero historical effort", () => {
  const { snapshot } = fixture();
  snapshot.actuals[0].kind = "opening"; snapshot.actuals[0].hours = null; snapshot.actuals[0].allocations[0].hours = null;
  const result = summarizeReport(snapshot); expect(result.unknownHours).toBe(1); expect(result.total.cumulative.hours).toBe("0.00");
 });
 it("refuses missing valuations, incorrect allocations and foreign task identities", () => {
  for (const broken of ["valuation", "split", "task"] as const) {
   const { snapshot } = fixture();
   if (broken === "valuation") snapshot.actuals[0].amount = null;
   if (broken === "split") snapshot.actuals[0].allocations[0].amount = "12.34";
   if (broken === "task") snapshot.actuals[0].allocations[0].task_id = randomUUID();
   expect(() => summarizeReport(snapshot)).toThrow();
  }
 });
 it("preserves excluded records without counting them and rejects invented precision or dates", () => {
  const { snapshot, command } = fixture();
  snapshot.actuals[0].status = "excluded";
  const result = summarizeReport(snapshot);
  expect(result.total.cumulative.incurred).toBe("0.00"); expect(result.unresolved).toHaveLength(1);
  expect(actualCommandSchema.safeParse({ ...command, amount: "1.001" }).success).toBe(false);
  expect(actualCommandSchema.safeParse({ ...command, entryDate: "2026-02-30" }).success).toBe(false);
 });
 it("maps CSV with quoted fields, preserves source hashes, and detects duplicate and invalid records", () => {
  const { command } = fixture();
  const preview = previewActualCsv('key,date,description,amount\nretained,2026-08-01,"quoted, description",12.35\nnew,2026-08-01,New,12.35\nnew,2026-08-01,Duplicate,12.35\nbad,2026-02-30,Bad date,1.00', "synthetic.csv", { sourceKey: "key", entryDate: "date", description: "description", amount: "amount" }, command, ["retained"]);
  expect(preview.rows.map(r => r.duplicate)).toEqual([true, false, true, false]);
  expect(preview.rows[1].command?.sourceReference).toContain(`sha256:${preview.hash}; CSV data row 2`);
  expect(preview.rows[3].errors.join(" ")).toContain("actual calendar date");
  expect(preview.rows.filter(r => r.command)).toHaveLength(1);
 });
 it("exports the same totals, baseline, source references and correction history into HTML and XLSX", () => {
  const { snapshot } = fixture();
  snapshot.actuals[0].detail.description = '<script>alert("x")</script>';
  const report = { id: randomUUID(), period_id: snapshot.period.id, version: 2, snapshot, snapshot_hash: "b".repeat(64), issued_at: "2026-09-01T01:00:00Z", corrects_report_id: randomUUID() };
  const html = buildPeriodReportHtml(report), workbook = buildPeriodReportWorkbook(report);
  expect(html).toContain("12.35"); expect(html).toContain("32.36"); expect(html).toContain(report.snapshot_hash); expect(html).not.toContain('<script>');
  const total = utils.sheet_to_json(workbook.Sheets["Total cumulative"], { header: 1 });
  expect(total[1]).toEqual(["Total", 12.35, 0, 0, 0, 1]);
  expect(utils.sheet_to_json(workbook.Sheets["Source records"], { header: 1 }).flat()).toContain("Synthetic payroll source");
  expect(workbook.SheetNames).toContain("Correction history");
 });
 it("retains long notes across wrapped continuation rows and styles the issued workbook", async () => {
  const { snapshot } = fixture();
  const note = Array.from({ length: 250 }, (_, i) => `Synthetic line ${i}: retained source detail\n`).join("");
  snapshot.actuals[0].detail.description = note;
  const report = { id: randomUUID(), period_id: snapshot.period.id, version: 1, snapshot, snapshot_hash: "b".repeat(64), issued_at: "2026-09-01T01:00:00Z", corrects_report_id: null };
  const workbook = buildPeriodReportWorkbook(report);
  const rows = utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Source records"], { header: 1 });
  expect(rows.slice(1).map(row => row[7]).join("")).toBe(note);
  expect(workbook.Sheets["Source records"]["!rows"]!.every(row => row.hpt! <= 220)).toBe(true);
  const zip = await JSZip.loadAsync(await writeWorkProgramWorkbook(workbook));
  expect(await zip.file("xl/styles.xml")!.async("string")).toContain('wrapText="1"');
  expect(await zip.file("xl/worksheets/sheet1.xml")!.async("string")).toContain('state="frozen"');
 });

});
