import * as XLSX from "xlsx";
import JSZip from "jszip";
import { formatWorkProgramWorkbook } from "./workbook-layout";
import { buildStructuredWorkProgramHtml, buildStructuredWorkProgramWorkbook } from "./export-structured";
import { reconcileWorkProgram } from "./schema";
import type { WorkProgramRevision, WorkProgramSource } from "./types";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const paragraph = (value: string) => `<p>${escape(value || "Unresolved / not entered").replaceAll("\n", "<br>")}</p>`;
const heading = (title: string, value: string) => `<h3>${escape(title)}</h3>${paragraph(value)}`;
const notice = "Preparation draft for review. No adoption, spending authority, actual cost or live assignment is established by this document. Missing figures remain unresolved. Prior balances are reference information and are not added to proposed revenue.";

export function buildWorkProgramHtml(revision: WorkProgramRevision, sources: WorkProgramSource[], pageImages: import("./types").WorkProgramPageImage[] = []) {
  if (revision.content_json.preparation) return buildStructuredWorkProgramHtml(revision, sources, pageImages);
  const draft = revision.content_json;
  const totals = reconcileWorkProgram(draft);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const money = (value: number | null) => value === null ? "Unresolved" : `${value.toFixed(2)} ${escape(draft.currency)}`;
  const elements = draft.elements.map((element) => {
    const source = element.source ? byId.get(element.source.sourceId) : null;
    const activities = (["tasks", "products"] as const).map((kind) => `<h3>Proposed ${kind}</h3>${element[kind].length ? element[kind].map((row, index) => `<h4>${kind === "tasks" ? "Task" : "Product"} ${index + 1}</h4>${paragraph(row.description)}${paragraph(`Responsible: ${row.responsible || "unresolved"}. Schedule: ${row.schedule || "unresolved"}.`)}`).join("") : paragraph("None entered; review against the original.")}`).join("");
    return `<section class="element"><h2>${escape(element.code)} ${escape(element.title)}</h2>${paragraph(`Carry-forward decision: ${element.disposition}`)}${paragraph(element.decisionNote)}${paragraph(source && element.source ? `Source: ${source.title}, PDF pages ${element.source.pageFrom}-${element.source.pageTo}; ${element.source.tableLabel}; source ID ${source.id}.` : "No retained source citation.")}${heading("Proposed objective", element.objective)}${heading("Proposed discussion", element.discussion)}${heading("Proposed responsibility and schedule", `${element.responsible || "Responsible person unresolved"}\n${element.schedule || "Schedule unresolved"}\nPerson-months: ${element.personMonths ?? "unresolved"}`)}${activities}<h3>Proposed budget</h3>${paragraph(`Treatment in program totals: ${element.budgetTreatment}. ${element.budgetTreatmentNote}`)}${element.budget.length ? `<table><thead><tr><th>Kind and category</th><th>Year / review</th><th>Amount</th></tr></thead><tbody>${element.budget.map((line) => `<tr><td>${escape(line.kind)}: ${escape(line.label)}<br>${escape(line.note)}</td><td>${escape(line.fundingYear || "Unresolved")}<br>${escape(line.basis)}</td><td class="money">${money(line.amount)}</td></tr>`).join("")}</tbody></table>` : paragraph("No proposed budget lines entered.")}${paragraph(`Linked project: ${element.projectId ?? "none"}`)}</section>`;
  }).join("");
  const sourceList = sources.map((source) => `<section><h3>${escape(source.title)}</h3>${paragraph(`Role: ${source.source_role}. PDF pages: ${source.page_count}. Document ID: ${source.document_id}. Source ID: ${source.id}.`)}${paragraph(`Original SHA-256: ${source.document_checksum}`)}${paragraph(`Official source: ${source.source_url ?? "not recorded"}`)}${source.extraction_json.warnings.map(paragraph).join("")}<h4>Source work-element coverage</h4>${source.extraction_json.elements.map((original) => {
    const proposed = draft.elements.filter((element) => element.source?.sourceId === source.id && element.source.elementKey === original.key);
    return paragraph(`${original.code}, PDF pages ${original.pageFrom}-${original.pageTo}: ${proposed.length ? proposed.map((element) => `${element.code} - ${element.disposition}; ${element.decisionNote || "decision unresolved"}`).join("; ") : source.source_role === "comparison" ? "Comparison only; not carried into this proposal." : "Not mapped into this proposal; reviewer decision required."}`);
  }).join("")}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(draft.agency)} work program proposal</title><style>body{font:11pt/1.5 Arial,sans-serif;color:#172c3b;max-width:900px;margin:0 auto;padding:24px}h1{font-size:25pt}h2{font-size:18pt;border-bottom:2px solid #286276;padding-bottom:6px}h3{font-size:13pt}h1,h2,h3,h4{break-after:avoid}p,td{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0}th,td{padding:8px;border:1px solid #bdc9ce;text-align:left;vertical-align:top}th{background:#edf3f5}thead{display:table-header-group}.money{text-align:right;font-variant-numeric:tabular-nums}.notice{border:2px solid #286276;padding:12px}section{margin-top:24px}@media print{body{padding:0;font-size:10pt}.element{break-before:page}tr{break-inside:avoid}}@media(max-width:500px){body{padding:12px}th,td{padding:4px;font-size:9pt}}</style></head><body><h1>${escape(draft.agency)}</h1><h2>${escape(draft.documentKind.toUpperCase())} preparation proposal</h2>${paragraph(`${draft.periodStart} to ${draft.periodEnd} | revision ${revision.revision} | saved ${revision.created_at}`)}<p class="notice">${notice}</p>${paragraph(`Responsible authority: ${draft.responsibleAuthority}`)}${heading("Authority basis", draft.authorityBasis)}${heading("Program narrative", draft.introduction)}${heading("Agency staffing and organization", draft.staffing)}${heading("Financial assumptions and agency-wide reconciliation", draft.financialNotes)}<h2>Proposed financial summary</h2><table><tbody><tr><th>Proposed revenue</th><td>${money(totals.revenue)}</td></tr><tr><th>Proposed cost</th><td>${money(totals.cost)}</td></tr><tr><th>Revenue less cost</th><td>${money(totals.difference)}</td></tr><tr><th>Prior balance, reference only</th><td>${money(draft.priorBalance)}</td></tr></tbody></table>${paragraph(draft.priorBalanceBasis)}${paragraph(`Unresolved decisions: ${totals.unresolvedDecisions}. Unresolved budget treatments: ${totals.unresolvedBudgetTreatments}. Elements missing revenue or cost: ${totals.missingBudgetElements}. Unresolved budget amounts: ${totals.missingAmounts}.`)}${elements}<h2>Retained source register and coverage</h2>${sourceList || paragraph("No retained sources attached.")}<h2>Revision custody</h2>${paragraph(`Revision ID: ${revision.id}\nPrevious revision: ${revision.previous_revision_id ?? "none"}\nSaved by user ID: ${revision.created_by}\nContent SHA-256: ${revision.content_sha256}`)}${paragraph("The XLSX contains the proposed budget lines, reconciliation formulas and source identifiers for this same revision. Original documents remain in the program's source register. Review source financial breakdowns, staffing tables and appendices that automatic extraction has not structured.")}</body></html>`;
}

type Cell = string | number | null;
/** Workbook cells keep user text as strings; formulas are authored only by this exporter. */
export function buildWorkProgramWorkbook(revision: WorkProgramRevision, sources: WorkProgramSource[]) {
  if (revision.content_json.preparation) return buildStructuredWorkProgramWorkbook(revision, sources);
  const draft = revision.content_json, totals = reconcileWorkProgram(draft);
  const workbook = XLSX.utils.book_new();
  function sheet(name: string, rows: Cell[][], widths: number[]) {
    const value = XLSX.utils.aoa_to_sheet(rows);
    value["!cols"] = widths.map((wch) => ({ wch }));
    if (rows.length > 1) value["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: rows.length - 1, c: rows[0].length - 1 }) };
    XLSX.utils.book_append_sheet(workbook, value, name);
    return value;
  }
  const budgetRows: Cell[][] = [["Element ID", "Code", "Disposition", "Treatment", "Kind", "Category", "Funding year", "Review", "Amount", "Calculation and source note", "Budget line ID"]];
  const elements: Cell[][] = [["Element ID", "Code", "Title", "Decision", "Decision note", "Objective", "Discussion", "Responsible", "Schedule", "Person months", "Budget treatment", "Treatment note", "Project ID", "Source ID", "Source key", "First PDF page", "Last PDF page", "Table reference", "Revenue line count", "Cost line count", "Active financial element"]];
  const activities: Cell[][] = [["Element ID", "Code", "Kind", "Activity ID", "Description", "Responsible", "Schedule"]];
  for (const element of draft.elements) {
    elements.push([element.id, element.code, element.title, element.disposition, element.decisionNote, element.objective, element.discussion, element.responsible, element.schedule, element.personMonths, element.budgetTreatment, element.budgetTreatmentNote, element.projectId, element.source?.sourceId ?? null, element.source?.elementKey ?? null, element.source?.pageFrom ?? null, element.source?.pageTo ?? null, element.source?.tableLabel ?? null]);
    for (const kind of ["tasks", "products"] as const) for (const row of element[kind]) activities.push([element.id, element.code, kind, row.id, row.description, row.responsible, row.schedule]);
    for (const line of element.budget) budgetRows.push([element.id, element.code, element.disposition, element.budgetTreatment, line.kind, line.label, line.fundingYear, line.basis, line.amount, line.note, line.id]);
  }
  const summary = sheet("Reconciliation", [["Measure", "Value"], ["Agency", draft.agency], ["Kind", draft.documentKind], ["Period starts", draft.periodStart], ["Period ends", draft.periodEnd], ["Currency", draft.currency], ["Proposed revenue", totals.revenue ?? "Unresolved"], ["Proposed cost", totals.cost ?? "Unresolved"], ["Revenue less cost", totals.difference ?? "Unresolved"], ["Unresolved carry-forward decisions", totals.unresolvedDecisions], ["Unresolved budget treatments", totals.unresolvedBudgetTreatments], ["Elements missing revenue or cost lines", totals.missingBudgetElements], ["Unresolved budget amounts", totals.missingAmounts], ["Prior balance, reference only", draft.priorBalance ?? "Unresolved"], ["Prior balance basis", draft.priorBalanceBasis || "Unresolved"], ["Revision", revision.revision], ["Content SHA-256", revision.content_sha256], ["Notice", notice], ["Review edits", "Edit existing amounts and review values in Budget lines, and decisions and treatments in Work elements. Budget disposition and treatment cells are linked formulas. For added or removed rows, make the change in OpenPlan and export a new revision; formulas cover only the exported rows. External edits do not change the saved revision or its hash."]], [44, 90]);
  const elementSheet = sheet("Work elements", elements, [38, 12, 40, 18, 60, 60, 60, 30, 40, 15, 20, 50, 38, 38, 24, 14, 14, 40]);
  sheet("Tasks and products", activities, [38, 12, 14, 38, 80, 30, 35]);
  const budget = sheet("Budget lines", budgetRows, [38, 12, 18, 20, 14, 35, 18, 20, 18, 70, 38]);
  let budgetRow = 2;
  for (const [index, element] of draft.elements.entries()) for (let lineIndex = 0; lineIndex < element.budget.length; lineIndex++) {
    budget[`C${budgetRow}`] = { t: "s", v: element.disposition, f: `'Work elements'!D${index + 2}` };
    budget[`D${budgetRow}`] = { t: "s", v: element.budgetTreatment, f: `'Work elements'!K${index + 2}` };
    budgetRow++;
  }
  for (let row = 2; row <= budgetRows.length; row++) if (budget[`I${row}`]) budget[`I${row}`].z = '#,##0.00;[Red](#,##0.00);"–"';
  const end = Math.max(2, budgetRows.length);
  const lastElement = Math.max(2, elements.length);
  for (let index = 0; index < draft.elements.length; index++) {
    const element = draft.elements[index], row = index + 2;
    for (const [column, kind] of [["S", "revenue"], ["T", "cost"]] as const) elementSheet[`${column}${row}`] = { t: "n", v: element.budget.filter((line) => line.kind === kind).length, f: `COUNTIFS('Budget lines'!A$2:A$${end},A${row},'Budget lines'!E$2:E$${end},"${kind}")` };
    elementSheet[`U${row}`] = { t: "n", v: element.disposition !== "completed" && element.budgetTreatment !== "informational" ? 1 : 0, f: `IF(AND(D${row}<>"completed",K${row}<>"informational"),1,0)` };
  }
  elementSheet["!ref"] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: elements.length - 1, c: 20 });
  summary.B10 = { t: "n", v: totals.unresolvedDecisions, f: `COUNTIF('Work elements'!D2:D${lastElement},"unresolved")` };
  summary.B11 = { t: "n", v: totals.unresolvedBudgetTreatments, f: `COUNTIFS('Work elements'!D2:D${lastElement},"<>completed",'Work elements'!K2:K${lastElement},"unresolved")` };
  summary.B12 = { t: "n", v: totals.missingBudgetElements, f: `SUMPRODUCT(('Work elements'!U2:U${lastElement}=1)*((('Work elements'!S2:S${lastElement}=0)+('Work elements'!T2:T${lastElement}=0))>0))` };
  const unresolvedLines = (kind: "revenue" | "cost") => `COUNTIFS('Budget lines'!E2:E${end},"${kind}",'Budget lines'!C2:C${end},"<>completed",'Budget lines'!D2:D${end},"<>informational",'Budget lines'!H2:H${end},"unresolved")+COUNTIFS('Budget lines'!E2:E${end},"${kind}",'Budget lines'!C2:C${end},"<>completed",'Budget lines'!D2:D${end},"<>informational",'Budget lines'!H2:H${end},"proposed",'Budget lines'!I2:I${end},"")`;
  // Each kind has its own missing-data checks: an unknown cost must not erase
  // known revenue. Counts and totals recalculate when a reviewer edits cells.
  for (const [row, kind, countColumn, total] of [[7, "revenue", "S", totals.revenue], [8, "cost", "T", totals.cost]] as const) {
    summary[`B${row}`] = { t: total === null ? "s" : "n", v: total ?? "Unresolved", f: `IF(OR(B11>0,SUM('Work elements'!U2:U${lastElement})=0,COUNTIFS('Work elements'!U2:U${lastElement},1,'Work elements'!${countColumn}2:${countColumn}${lastElement},0)>0,(${unresolvedLines(kind)})>0),"Unresolved",ROUND(SUMIFS('Budget lines'!I2:I${end},'Budget lines'!E2:E${end},"${kind}",'Budget lines'!C2:C${end},"<>completed",'Budget lines'!D2:D${end},"included",'Budget lines'!H2:H${end},"proposed"),2))`, z: "#,##0.00" };
  }
  summary.B13 = { t: "n", v: totals.missingAmounts, f: `${unresolvedLines("revenue")}+${unresolvedLines("cost")}` };
  summary.B9 = { t: totals.difference === null ? "s" : "n", v: totals.difference ?? "Unresolved", f: 'IF(AND(ISNUMBER(B7),ISNUMBER(B8)),ROUND(B7-B8,2),"Unresolved")', z: "#,##0.00" };
  sheet("Program narrative", [["Section", "Content"], ["Responsible authority", draft.responsibleAuthority], ["Authority basis", draft.authorityBasis], ["Program narrative", draft.introduction], ["Staffing", draft.staffing], ["Financial notes", draft.financialNotes]], [30, 110]);
  sheet("Sources", [["Source ID", "Document ID", "Title", "Role", "SHA-256", "Official URL", "PDF pages", "Review method", "Review warnings"], ...sources.map((source) => [source.id, source.document_id, source.title, source.source_role, source.document_checksum, source.source_url, source.page_count, source.extraction_json.parser, source.extraction_json.warnings.join("\n")])], [38, 38, 55, 18, 68, 70, 14, 30, 90]);
  sheet("Source coverage", [["Source ID", "Source key", "Code", "First PDF page", "Last PDF page", "Proposed element ID", "Decision", "Decision note"], ...sources.flatMap((source) => source.extraction_json.elements.map((original) => {
    const proposed = draft.elements.find((element) => element.source?.sourceId === source.id && element.source.elementKey === original.key);
    return [source.id, original.key, original.code, original.pageFrom, original.pageTo, proposed?.id ?? null, proposed?.disposition ?? (source.source_role === "comparison" ? "comparison only" : "unmapped"), proposed?.decisionNote ?? null];
  }))], [38, 24, 12, 14, 14, 38, 22, 80]);
  return workbook;
}

/** SheetJS CE does not emit calcPr. Request recalculation in the standard workbook XML. */
export async function writeWorkProgramWorkbook(workbook: XLSX.WorkBook): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer);
  const part = zip.file("xl/workbook.xml");
  if (!part) throw new Error("The generated workbook has no workbook definition");
  const xml = await part.async("string");
  if (!xml.endsWith("</workbook>")) throw new Error("The generated workbook definition is incomplete");
  zip.file("xl/workbook.xml", xml.replace("</workbook>", '<calcPr calcId="0" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'));
  if (workbook.Sheets["Funding sources"]) await formatWorkProgramWorkbook(zip, workbook);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
