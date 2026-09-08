import { utils } from "xlsx";
import { writeWorkProgramWorkbook } from "@/lib/programs/work-program/export";
import { renderReportPdf } from "@/lib/reports/pdf";
import { reconcileSnapshot, contractMetrics, type Rollup } from "./reconciliation";
import type { ContractSnapshot } from "./schema";
const escape = (v: unknown) => String(v ?? "Unassessed").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type Cell = string | number | null;
export function contractSnapshotTables(report: ContractSnapshot): { name: string; rows: Cell[][] }[] {
 const state = report.snapshot, r = reconcileSnapshot(report);
 const tables: { name: string; rows: Cell[][] }[] = [{ name: "Identity", rows: [
  ["Internal contract management snapshot", report.title], ["Issued", report.created_at], ["Contract", state.engagement.title], ["Project ID", state.engagement.project_id], ["Contract ID", state.engagement.id], ["As of", state.asOf], ["Source cutoff", state.sourceCutoff], ["Original approved baseline", state.originalBaselineId], ["Current approved baseline", state.baselineId], ["Baseline hash", r.baseline?.content_hash ?? null], ["Snapshot ID", report.id], ["Snapshot hash", report.snapshot_hash], ["Currency", r.baseline?.content.currency ?? null], ["Coverage evidence", state.coverageEvidence], ["Coverage attestation", state.coverageComplete ? "Complete source coverage attested by issuer" : "Incomplete or unassessed"], ["Meaning", "Internal management. No accounting replacement, funder reimbursement, legal authority, accepted progress or forecast finish date is established."],
 ] }];
 function rows(values: Rollup[]): Cell[][] { return [["Work", ...contractMetrics], ...values.map(v => [v.label, ...contractMetrics.map(k => v.totals[k])])]; }
 tables.push({ name: "Contract totals", rows: rows([{ id: "total", label: "Contract", totals: r.total }]) }, { name: "Tasks", rows: rows(r.byTask) }, { name: "Staff", rows: rows(r.byStaff) }, { name: "Deliverables", rows: rows(r.byDeliverable) });
 tables.push({ name: "Budget and billing", rows: [["Measure", "Amount"], ["Approved fee", r.baseline?.content.fee ?? null], ["Approved internal cost", r.baseline?.content.cost ?? null], ["Gross billed before retention", r.grossBilled], ["Invoice retention", r.retention], ["Gross fee remaining after credits", r.grossFeeRemaining], ["Remaining cost estimate", r.remainingCost], ["Actual plus remaining", r.actualPlusRemaining], ["Unknown historical hours", r.unknownHours]] });
 tables.push({ name: "Baseline history", rows: [["Version", "State", "Identity", "Scope", "Fee", "Cost", "Hours", "Approval evidence", "Source documents", "Hash"], ...state.baselines.map(b => [b.version, b.state, b.id, b.content.scope, b.content.fee, b.content.cost, b.content.hours, b.approval_evidence, b.content.sourceDocuments.join(", "), b.content_hash])] });
 tables.push({ name: "Remaining work", rows: [["Task", "Agreed deadline", "Estimate date", "Remaining hours", "Remaining cost", "Estimate basis", "Independent progress", "Progress note"], ...r.estimates.map(e => [e.task.title, e.task.deadline, e.estimate?.command.asOf ?? null, e.estimate?.command.hours ?? null, e.estimate?.command.cost ?? null, e.estimate?.command.basis ?? null, e.estimate?.command.progress ?? null, e.estimate?.command.progressNote ?? null])] });
 tables.push({ name: "Source history", rows: [["Source", "Version", "Recorded", "Date", "Category", "Status", "Amount", "Hours", "Reference", "Correction", "Physical source", "OWP version"], ...state.actuals.map(v => [v.command.sourceKey, v.version, v.created_at, v.command.entryDate, v.command.category, v.command.status, v.amount, v.hours, v.command.sourceReference, v.command.correctionNote, v.time_entry_id ?? v.spend_entry_id, v.command.owpVersionId])] });
 tables.push({ name: "Allocations", rows: [["Source", "Version", "Task", "Deliverable", "Share (basis points)", "Amount", "Hours"], ...state.actuals.flatMap(v => v.allocations.map(a => [v.command.sourceKey, v.version, a.taskId, a.deliverableId, a.share, a.amount, a.hours]))] });
 tables.push({ name: "Unresolved", rows: [["Record", "State", "Known amount", "Known hours"], ...r.unresolved.map(v => [v.command.sourceKey, v.command.status, v.amount, v.hours]), ...state.unmappedSpend.map(v => [v.id, "Project spending not mapped to this contract", v.amount, null]), ...state.unmappedTime.map(v => [v.id, "Contract time not reviewed", null, v.hours])] });
 tables.push({ name: "Approved task budgets", rows: [["Task", "Fee", "Internal cost", "Hours", "Agreed deadline", "Scope"], ...(r.baseline?.content.tasks??[]).map(t=>[t.title,t.fee,t.cost,t.hours,t.deadline,t.scope])] });
 tables.push({ name: "Approved staff budgets", rows: [["Task", "Staff", "Hours", "Internal cost"], ...(r.baseline?.content.tasks??[]).flatMap(t=>t.staff.map(s=>[t.title,state.staff.find(p=>p.id===s.staffId)?.name??s.staffId,s.hours,s.cost]))] });
 tables.push({ name: "Billing source allocations", rows: [["Invoice", "Source entry", "Valuation version", "Billing rate", "Task", "Deliverable", "Gross fee", "Hours"], ...(state.billingSources??[]).flatMap(s=>s.lines.map(l=>[s.invoice_id,s.entry_id,s.actual_version_id,s.billing_rate_id,l.taskId,l.deliverableId,l.amount,l.hours]))] });
 tables.push({ name: "Valuation evidence", rows: [["Source", "Version", "Basis", "Cost rate", "Opening coverage", "Opening basis", "Overlap reconciliation", "Shared source state"], ...state.actuals.map(v=>[v.command.sourceKey,v.version,v.command.valuationBasis,v.command.rateId,`${v.command.openingStart??""} to ${v.command.openingEnd??""}`,v.command.openingBasis,v.command.reconciliationNote,v.shared_source_stale?"OWP correction requires reconciliation":"Retained valuation"])] });
 tables.push({ name: "Rates", rows: [["Staff", "Basis", "Effective start", "Effective end", "Rate", "Source", "Identity"], ...state.rates.map(v => [state.staff.find(s => s.id === v.staff_id)?.name ?? v.staff_id, v.basis, v.starts_on, v.ends_on, v.hourly_rate, v.source_reference, v.id])] });
 return tables;
}
export function contractSnapshotHtml(report: ContractSnapshot) {
 return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(report.title)}</title><style>@page{size:A4 landscape;margin:14mm}body{font:11px Arial;color:#17323e}h1{font-size:25px}h2{break-after:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:7px;border:1px solid #cad4d8;text-align:left;overflow-wrap:anywhere;vertical-align:top;white-space:pre-wrap}th{background:#24515f;color:white}thead{display:table-header-group}tr,.record{break-inside:avoid}.record{padding:8px;border-bottom:1px solid #cad4d8}section{margin-top:20px}</style><body><h1>${escape(report.title)}</h1>${contractSnapshotTables(report).map(t => `<section><h2>${escape(t.name)}</h2>${t.rows[0].length>6 ? t.rows.slice(1).map(row => `<div class="record">${row.map((v,i) => `<p><strong>${escape(t.rows[0][i])}:</strong> ${escape(v)}</p>`).join("")}</div>`).join("") : `<table><thead><tr>${t.rows[0].map(v => `<th>${escape(v)}</th>`).join("")}</tr></thead><tbody>${t.rows.slice(1).map(row => `<tr>${row.map(v => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`}</section>`).join("")}</body></html>`;
}
export function contractSnapshotWorkbook(report: ContractSnapshot) {
 const book = utils.book_new();
 for (const table of contractSnapshotTables(report)) {
  const widths = table.rows[0].map((_,i) => i===0 ? 36 : table.name==="Identity" ? 95 : 30);
  const rows = table.rows.flatMap(row => {
   const parts = row.map(v => typeof v === "number" ? [v] : typeof v === "string" && /^-?\d+\.\d{2}$/.test(v) && Math.abs(Number(v))<1e12 ? [Number(v)] : String(v ?? "Unassessed").match(/[\s\S]{1,250}/g) ?? [""]);
   return Array.from({ length: Math.max(...parts.map(p=>p.length)) }, (_,i) => parts.map(p=>p[i]??""));
  });
  const sheet = utils.aoa_to_sheet(rows); sheet["!cols"] = widths.map(wch=>({wch}));
  sheet["!rows"] = rows.map(row=>({hpt:Math.min(360,Math.max(30,...row.map((v,i)=>16*(String(v).split("\n").length+Math.ceil(String(v).length/(widths[i]-3))))))}));
  for(const key of Object.keys(sheet).filter(k=>!k.startsWith("!"))) if(sheet[key].t==="n")sheet[key].z="#,##0.00;[Red](#,##0.00)";
  utils.book_append_sheet(book,sheet,table.name);
 }
 return book;
}
export async function renderContractSnapshot(report: ContractSnapshot, format: "pdf"|"xlsx") {
 if (format === "xlsx") return { bytes: Buffer.from(await writeWorkProgramWorkbook(contractSnapshotWorkbook(report))), engine: "sheetjs" };
 const pdf = await renderReportPdf(contractSnapshotHtml(report), {title:report.title,generatedAt:report.created_at,footerLabel:"Internal contract management"});
 return {bytes:Buffer.from(pdf.bytes),engine:pdf.engine};
}
