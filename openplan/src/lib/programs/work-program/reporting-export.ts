import { reimbursementTotals } from "./reimbursement";
import { utils, type WorkBook } from "xlsx";
import { summarizeReport, type PeriodReport, type ReportRollup } from "./reporting";
import { writeWorkProgramWorkbook } from "./export";
import { renderReportPdf } from "@/lib/reports/pdf";
const escape = (value: unknown) => String(value ?? "Unresolved").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type Cell = string | number | null;
export function reportTables(report: PeriodReport): { name: string; rows: Cell[][] }[] {
 const s = report.snapshot, totals = summarizeReport(s);
 const packet = s.reimbursement;
 const tables: { name: string; rows: Cell[][] }[] = [{ name: "Identity", rows: [
  [packet ? "Reimbursement supporting packet" : "Internal management report", packet?.title ?? s.period.name], ["Retained report sequence", report.version], ["Issued", report.issued_at], ["Period start", s.period.starts_on], ["Period end", s.period.ends_on], ["Source cutoff", s.period.source_cutoff],
  ["Known-hours completeness", totals.unknownHours ? `${totals.unknownHours} opening balances have unspecified hours; hour totals are incomplete.` : "All included labor and opening entries have explicit hours."], ["Currency", s.baseline.content_json.currency], ["Baseline revision", s.baseline.revision], ["Baseline ID", s.baseline.id], ["Baseline SHA256", s.baseline.content_sha256], ["Report ID", report.id], ["Snapshot SHA256", report.snapshot_hash], ["Corrects report", report.corrects_report_id ?? "Original issue"],
  ["Preparation sources", s.baseline.source_ids?.join(", ") || "No attached preparation sources"], ["Review note", s.reviewNote], ["Issue note", s.issueNote ?? "Draft review"],
  ["Scope", packet ? "Private reimbursement supporting packet. Reviewed amounts and evidence do not establish agency form compatibility, external submission, acceptance, payment or spending authority. Receipts are separate retained events." : "Internal management only. No funder reimbursement, payroll replacement, spending authority, accepted work or forecast finish date is established."],
  ["Amounts", "Incurred costs, commitments, billed amounts and payments are separate. Opening balances enter cumulative totals only. Unrecorded source costs are unknown; totals cover the retained source register."],
 ] }];
 function rows(values: ReportRollup[], scope: "period" | "cumulative"): Cell[][] { return [["Work / source", "Incurred", "Commitments", "Billed", "Payments", "Known hours"], ...values.map(r => [r.label, r[scope].incurred, r[scope].commitments, r[scope].billed, r[scope].payments, r[scope].hours])]; }
 for (const scope of ["period", "cumulative"] as const) for (const [name, values] of [["Total", [totals.total]], ["Elements", totals.byElement], ["Tasks", totals.byTask], ["Staff", totals.byStaff], ["Sources", totals.bySource]] as const) tables.push({ name: `${name} ${scope}`, rows: rows([...values], scope) });
 tables.push({ name: "Budget position", rows: [["Element", "Adopted budget", "Incurred", "Budget remaining", "Remaining estimate", "Actual plus remaining"], ...totals.budget.map(b => [b.label, b.approved, b.incurred, b.budgetRemaining, b.remainingEstimate, b.actualPlusRemaining])] });
 tables.push({ name: "Progress", rows: [["Element / task", "As of", "Completed products", "Outstanding work", "Issues", "Remaining hours", "Remaining cost", "Estimate basis"], ...s.period.progress.map(p => [(() => { const e = s.baseline.content_json.elements.find(e => e.id === p.elementId); return `${e?.code ?? p.elementId} ${e?.title ?? ""}${p.taskId ? ` / ${e?.tasks.find(t => t.id === p.taskId)?.description ?? p.taskId}` : ""}`; })(), p.asOf, p.completed, p.outstanding, p.issues, p.remainingHours, p.remainingCost, p.estimateBasis])] });
 tables.push({ name: "Source records", rows: [["Source key", "Date", "Kind / status", "Amount", "Hours", "Valuation", "Source reference", "Description", "Opening coverage", "Reconciliation", "Linked billing / cash reference"], ...s.actuals.map(v => [v.source_key, v.entry_date, `${v.kind} / ${v.status}`, v.amount, v.hours, v.costRate ? `${v.valuation_basis}: ${v.costRate.hourly_cost}/hour; ${v.costRate.starts_on}–${v.costRate.ends_on}; ${v.costRate.source_reference}; rate ${v.costRate.id}` : v.valuation_basis, v.detail.sourceReference, v.detail.description, v.kind === "opening" ? `${v.detail.openingStart} to ${v.detail.openingEnd}: ${v.detail.openingBasis}` : "Not applicable", v.detail.reconciliationNote, v.detail.linkedRecordReference])] });
 tables.push({ name: "Unresolved and excluded", rows: [["Source", "Status", "Reason"], ...totals.unresolved.map(v => [v.source_key, v.status, v.detail.correctionNote || "Unallocated or unvalued"])] });
 tables.push({ name: "Correction history", rows: [["Source", "Version", "Recorded", "Status", "Amount", "Hours", "Valuation", "Reason"], ...s.valuationHistory.map(v => [v.source_key, v.version, v.created_at, v.status, v.amount, v.hours, v.valuation_basis, v.detail.correctionNote || "Original record"])] });
 if (packet) {
  const reconstructed = reimbursementTotals(packet, report);
  for (const key of ["totalCost", "eligibleTotal", "reimbursementTotal", "matchTotal"] as const) if (reconstructed[key] !== packet[key]) throw new Error("Retained reimbursement totals do not reconcile");
  tables.unshift({ name: "Reimbursement packet", rows: [
   ["Field", "Value"], ["Title", packet.title], ["Claim ID", packet.claimId], ["Packet version", packet.packetVersion], ["Corrects packet report", report.corrects_report_id ?? "Original packet"],
   ["Source report ID", packet.reportId], ["Source report SHA256", packet.sourceReportHash], ["Reviewed by", packet.reviewedBy], ["Reviewed at", packet.reviewedAt], ["Review evidence", packet.reviewNote],
   ["Funding authority", packet.authorityEvidence], ["Prescribed packet review", packet.formEvidence], ["Source cost", packet.totalCost], ["Eligible cost", packet.eligibleTotal], ["Reimbursement requested", packet.reimbursementTotal], ["Match", packet.matchTotal],
   ["Version meaning", "This version replaces the prior packet request. Never add historical packet versions. Return retains source reservations; external receipts and acceptance are separate from this frozen review and do not record cash."],
  ] });
  tables.push({ name: "Packet history", rows: [["Sequence", "Action", "Packet report ID", "Recorded at", "Actor ID", "Evidence"], ...packet.history.map(e => [e.sequence, e.kind, e.report_id, e.created_at, e.actor_id, e.note])] });
  tables.push({ name: "Eligibility decisions", rows: [["Source key", "Entry ID", "Actual version ID", "Source cost", "Eligible cost", "Eligibility evidence"], ...packet.costs.map(c => { const a = s.actuals.find(v => v.id === c.actualVersionId)!; return [a.source_key, a.entry_id, a.id, a.amount, c.eligibleAmount, c.eligibilityEvidence]; })] });
  tables.push({ name: "Funding shares", rows: [["Actual version ID", "Fund ID", "Fund", "Vintage", "Treatment", "Amount", "Share evidence"], ...packet.costs.flatMap(c => c.shares.map(share => { const f = s.baseline.content_json.preparation?.funds.find(f => f.id === share.fundId); return [c.actualVersionId, share.fundId, f?.name ?? "Unknown", f?.vintage ?? "Unknown", share.treatment, share.amount, share.evidence]; }))] });
  tables.push({ name: "Cost work links", rows: [["Actual version ID", "Project ID", "Contract ID", "Time entry ID", "Spend entry ID", "Element ID", "Task ID", "Deliverable ID", "Amount", "Hours"], ...packet.costs.flatMap(c => { const v = s.actuals.find(v => v.id === c.actualVersionId)!; return v.allocations.map(a => [c.actualVersionId, v.detail.projectId, v.detail.contractId, v.time_entry_id ?? null, v.spend_entry_id ?? null, a.element_id, a.task_id, a.deliverable_id, a.amount, a.hours]); })] });
  tables.push({ name: "Shared contract costs", rows: [["Contract actual version ID", "Contract ID", "Approved retained source"], ...(packet.contractCosts ?? []).map(v => [String(v.id), String(v.engagement_id), JSON.stringify(v)])] });
  tables.push({ name: "Deliverable evidence", rows: [["Deliverable ID", "Record kind", "Retained record"], ...packet.deliverables.map(d => [String(d.id), "Product at packet review", JSON.stringify(d)]), ...packet.deliverableEvents.map(e => [String(e.deliverable_id), "Contract product review event", JSON.stringify(e)])] });
 }
 return tables;
}
export function buildPeriodReportHtml(report: PeriodReport) {
 const tables = reportTables(report);
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(report.snapshot.period.name)}</title><style>@page{size:A4 landscape;margin:14mm}body{font:11px Arial,sans-serif;color:#17323e}h1{font-size:25px}h2{font-size:17px;margin-top:25px}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{padding:7px;border:1px solid #cad4d8;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#24515f;color:white}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}section{margin-top:18px}.record{border-bottom:1px solid #cad4d8;padding:10px 0;break-inside:avoid}.record p{margin:5px 0}</style></head><body><h1>${escape(report.snapshot.period.name)}</h1><p>${report.snapshot.reimbursement ? "Reimbursement supporting packet" : "Internal management report"} · version ${report.snapshot.reimbursement?.packetVersion ?? report.version} · ${escape(report.snapshot.baseline.content_json.currency)}</p>${tables.map(t => `<section><h2>${escape(t.name)}</h2>${t.rows[0].length > 6 ? t.rows.slice(1).map(row => `<div class="record">${row.map((value, i) => `<p><strong>${escape(t.rows[0][i])}:</strong> ${escape(value)}</p>`).join("")}</div>`).join("") || "<p>No records.</p>" : `<table><thead><tr>${t.rows[0].map(v => `<th>${escape(v)}</th>`).join("")}</tr></thead><tbody>${t.rows.slice(1).map(row => `<tr>${row.map(v => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`}</section>`).join("")}</body></html>`;
}
export function buildPeriodReportWorkbook(report: PeriodReport): WorkBook {
 const book = utils.book_new();
 for (const table of reportTables(report)) {
  const widths = table.rows[0].map((_, i) => i === 0 ? 40 : (table.name === "Identity" || table.name === "Reimbursement packet" || ((table.name === "Shared contract costs" || table.name === "Deliverable evidence") && i === 2)) ? 95 : /Progress|records|history/.test(table.name) ? 35 : 20);
  const rows = table.rows.flatMap((row, index) => {
   const parts = row.map((value, column) => {
    const v = value ?? "Unresolved";
    if (index > 0 && /^(Incurred|Commitments|Billed|Payments|Known hours|Adopted budget|Budget remaining|Remaining estimate|Actual plus remaining|Remaining hours|Remaining cost|Amount|Hours|Source cost|Eligible cost)$/.test(String(table.rows[0][column])) && typeof v === "string" && /^-?\d+\.\d{2}$/.test(v) && Math.abs(Number(v)) < 1e12) return [Number(v)];
    if (typeof v !== "string") return [v];
    // Continuation rows preserve long notes without exceeding Excel's row height.
    const chunks: string[] = []; let chunk = "", lines = 1, columns = 0;
    for (const character of v) {
     if (columns >= widths[column] - 3) { lines++; columns = 0; }
     if (lines > 12) { chunks.push(chunk); chunk = ""; lines = 1; }
     chunk += character;
     if (character === "\n") { lines++; columns = 0; } else columns++;
    }
    chunks.push(chunk); return chunks;
   });
   return Array.from({ length: Math.max(...parts.map(p => p.length)) }, (_, i) => parts.map(p => p[i] ?? ""));
  });
  const sheet = utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map(wch => ({ wch }));
  sheet["!rows"] = rows.map(row => ({ hpt: Math.max(30, ...row.map((v, i) => 16 * String(v).split("\n").reduce((lines, part) => lines + Math.max(1, Math.ceil(part.length / (widths[i] - 3))), 0))) }));
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  for (const key of Object.keys(sheet).filter(k => !k.startsWith("!"))) if (sheet[key].t === "n") sheet[key].z = "#,##0.00;[Red](#,##0.00)";
  utils.book_append_sheet(book, sheet, table.name);
 }
 return book;
}
export async function renderPeriodReport(report: PeriodReport, format: "pdf" | "xlsx") {
 if (format === "xlsx") return { bytes: Buffer.from(await writeWorkProgramWorkbook(buildPeriodReportWorkbook(report))), engine: "sheetjs" };
 const pdf = await renderReportPdf(buildPeriodReportHtml(report), { title: report.snapshot.period.name, generatedAt: report.issued_at, footerLabel: `${report.snapshot.reimbursement ? "Reimbursement packet" : "Internal management"} v${report.snapshot.reimbursement?.packetVersion ?? report.version}` });
 return { bytes: Buffer.from(pdf.bytes), engine: pdf.engine };
}
