import * as XLSX from "xlsx";
import { workProgramDifferences, workProgramDifferenceLabel, workProgramDifferenceValue, workflowLabels, type WorkflowEvent } from "./workflow";
import type { WorkProgramRevision } from "./types";
export type WorkProgramPacket = { id: string; snapshot_hash: string; created_at: string; snapshot: { revisionId: string; revisionHash: string; sequence: number; audience: "public" | "internal"; baseline: WorkProgramRevision | null; events: WorkflowEvent[] } };
const escape = (value: unknown) => String(value ?? "Unresolved").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Keep each wrapped review cell below a printed page and Excel's row-height limit. */
function reviewTextChunks(value: string): string[] {
  const chunks: string[] = [];
  let chunk = "", lines = 1, columns = 0;
  for (const character of value) {
    if (columns === 60 && character !== "\n") { lines++; columns = 0; }
    if (lines > 12) {
      const boundary = Math.max(chunk.lastIndexOf(" "), chunk.lastIndexOf("\n"), chunk.lastIndexOf("\t"));
      const remainder = boundary < 0 ? chunk : chunk.slice(boundary + 1);
      if (boundary >= 0 && Array.from(remainder).length < 60) {
        chunks.push(chunk.slice(0, boundary + 1)); chunk = remainder;
      } else { chunks.push(chunk); chunk = ""; }
      lines = 1; columns = Array.from(chunk).length;
    }
    chunk += character;
    if (character === "\n") { lines++; columns = 0; } else columns++;
  }
  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks;
}

/** Review copies preserve the original preparation content and add a separately identified authority record. */
export function workProgramPacketRows(packet: WorkProgramPacket, revision: WorkProgramRevision): string[][] {
  const snap = packet.snapshot;
  if (snap.revisionId !== revision.id || snap.revisionHash !== revision.content_sha256) throw new Error("Review packet revision identity mismatch");
  const rows: string[][] = [
    ["Review record", `Revision ${revision.revision}; history through event ${snap.sequence}; ${snap.audience} copy`],
    ["Content SHA-256", revision.content_sha256], ["Review snapshot SHA-256", packet.snapshot_hash],
    ["Meaning", "Preparation pages retain their saved wording. The following records distinguish internal approval, board adoption, external acceptance and scoped spending evidence. No record authorizes another revision. Public copies omit internal review records and do not establish that omitted authority exists."],
    ["Amendment baseline", snap.baseline ? `Revision ${snap.baseline.revision}; ${snap.baseline.content_sha256}` : "No adopted amendment baseline recorded"],
  ];
  for (const event of snap.events) {
    rows.push([`Event ${event.sequence}: ${workflowLabels[event.kind]}`, `Revision ${event.revision_id}; SHA-256 ${event.revision_hash}; recorded ${event.created_at}${event.actor_id ? `; recorded by ${event.actor_id}` : ""}`]);
    rows.push(["Note", event.payload.note]);
    if (event.payload.authority) rows.push(["Authority and scope", `${event.payload.authority}; date ${event.payload.evidenceDate ?? "unresolved"}; ${event.payload.scope}`]);
    if (event.payload.targetEventId) rows.push(["Related record", event.payload.targetEventId]);
    for (const document of event.evidence) rows.push(["Supporting document", `${document.title}; document ${document.id}; SHA-256 ${document.checksum}`]);
  }
  const unresolved = snap.events.filter(event => event.kind === "comment" && !snap.events.some(other => other.kind === "resolve_comment" && other.payload.targetEventId === event.id));
  rows.push(["Unresolved review items in this copy", unresolved.length ? unresolved.map(event => `${event.id}: ${event.payload.note}`).join("\n") : "No unresolved comments in the included records. Omitted internal records and preparation discrepancies are separate."]);
  if (snap.baseline) for (const change of workProgramDifferences(snap.baseline.content_json, revision.content_json)) {
    rows.push([`Changed: ${workProgramDifferenceLabel(change.path)}`, `Before: ${workProgramDifferenceValue(change.before)}\nAfter: ${workProgramDifferenceValue(change.after)}`]);
  }
  return rows.flatMap(([label, value]) => {
    // Long nested amendment paths belong in the wider, height-bounded value column.
    const heading = label.length > 120 ? "Review detail" : label;
    const content = label.length > 120 ? `${label}\n${value}` : value;
    return reviewTextChunks(content).map((part, index) => [index ? `${heading} (continued)` : heading, part]);
  });
}
export function addWorkProgramPacketHtml(html: string, packet: WorkProgramPacket, revision: WorkProgramRevision) {
  const rows = workProgramPacketRows(packet, revision);
  const section = `<section><h1>Work program review and amendment record</h1>${rows.map(([label, value]) => `<h3>${escape(label)}</h3><p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(value)}</p>`).join("")}</section><hr>`;
  return html.replace(/(<body[^>]*>)/, `$1${section}`);
}
export function addWorkProgramPacketWorkbook(workbook: XLSX.WorkBook, packet: WorkProgramPacket, revision: WorkProgramRevision) {
  const sheet = XLSX.utils.aoa_to_sheet([["Record", "Retained meaning"], ...workProgramPacketRows(packet, revision)]);
  sheet["!cols"] = [{ wch: 36 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Review and amendment record");
  return workbook;
}
