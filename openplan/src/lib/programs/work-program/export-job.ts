import { addWorkProgramPacketHtml, addWorkProgramPacketWorkbook, type WorkProgramPacket } from "./workflow-export";
import { renderWorkProgramPageImages } from "./source-page-images";
import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadWorkProgramSources } from "./server";
import { workProgramDraftSchema } from "./schema";
import { validateWorkProgramSources } from "./source-review";
import { buildWorkProgramHtml, buildWorkProgramWorkbook, writeWorkProgramWorkbook } from "./export";
import { renderReportPdf } from "@/lib/reports/pdf";
import type { WorkProgramRevision } from "./types";

async function exportDocument(documentId: string) {
  const service = createServiceRoleClient();
  const document = await service.from("kb_documents").select("id, workspace_id, work_program_revision_id, work_program_export_format, work_program_packet_id, work_program_packet_format, content_type").eq("id", documentId).single();
  if (document.error || !document.data) throw new Error("Export record unavailable");
  const row = document.data;
  let packet: WorkProgramPacket | null = null;
  if (row.work_program_packet_id) {
    const result = await service.from("program_work_program_packets").select("id, snapshot_hash, created_at, snapshot, revision_id").eq("id", row.work_program_packet_id).eq("workspace_id", row.workspace_id).single();
    if (result.error || !result.data) throw new Error("Review snapshot unavailable");
    packet = result.data as unknown as WorkProgramPacket;
    row.work_program_revision_id = result.data.revision_id;
    row.work_program_export_format = row.work_program_packet_format;
  }
  if (!row.work_program_revision_id || !["html", "pdf", "xlsx"].includes(row.work_program_export_format)) throw new Error("Export identity unavailable");
  return { row, packet };
}

/** Cache recovery must bind saved bytes to current immutable document and revision identity. */
export async function loadWorkProgramExportIdentity(documentId: string) {
  const service = createServiceRoleClient();
  const { row: document, packet } = await exportDocument(documentId);
  const saved = await service.from("program_work_program_revisions").select("id, content_sha256").eq("id", document.work_program_revision_id).eq("workspace_id", document.workspace_id).single();
  if (saved.error || !saved.data) throw new Error("Export revision identity unavailable");
  return { packetHash: packet?.snapshot_hash ?? null, documentId: document.id as string, workspaceId: document.workspace_id as string, revisionId: saved.data.id as string, revisionHash: saved.data.content_sha256 as string, format: document.work_program_export_format as "html" | "pdf" | "xlsx", contentType: document.content_type as string };
}

/** Only the Documents worker calls this; the request handler records a durable job. */
export async function renderWorkProgramExport(documentId: string) {
  const service = createServiceRoleClient();
  const { row, packet } = await exportDocument(documentId);
  const saved = await service.from("program_work_program_revisions").select("*").eq("id", row.work_program_revision_id).eq("workspace_id", row.workspace_id).single();
  if (saved.error || !saved.data) throw new Error("Saved proposal unavailable");
  const revision = saved.data as WorkProgramRevision & { program_id: string };
  const parsed = workProgramDraftSchema.safeParse(revision.content_json);
  if (!parsed.success) throw new Error("Saved proposal format could not be read safely");
  const legacyWithoutRegister = revision.source_ids === null;
  if (legacyWithoutRegister && row.work_program_export_format !== "html") throw new Error("This historical revision has no frozen source register. Its narrative remains readable in HTML; save a new revision to prepare source-verified PDF and XLSX files.");
  const ids = new Set(revision.source_ids ?? []);
  const sources = await loadWorkProgramSources(service, revision.program_id, [...ids]);
  if (!legacyWithoutRegister && (sources.length !== ids.size || validateWorkProgramSources(parsed.data, sources))) throw new Error("Frozen source references could not be verified");
  let bytes: Buffer; let engine = "html";
  const format = row.work_program_export_format as "html" | "pdf" | "xlsx";
  if (format === "xlsx") {
    const workbook = buildWorkProgramWorkbook(revision, sources);
    bytes = Buffer.from(await writeWorkProgramWorkbook(packet ? addWorkProgramPacketWorkbook(workbook, packet, revision) : workbook));
    engine = "sheetjs";
  } else {
    const pageImages = await renderWorkProgramPageImages(parsed.data, sources);
    const prepared = buildWorkProgramHtml(revision, sources, pageImages);
    const rendered = packet ? addWorkProgramPacketHtml(prepared, packet, revision) : prepared;
    const html = legacyWithoutRegister ? rendered.replace(/(<body[^>]*>)/, '$1<p role="alert">Historical narrative only: this revision predates the frozen source register. Source coverage and source identity cannot be verified. The saved text has not been rewritten.</p>') : rendered;
    if (format === "html") bytes = Buffer.from(html, "utf8");
    else {
      const pdf = await renderReportPdf(html, { title: `${parsed.data.agency} work program proposal`, generatedAt: revision.created_at, footerLabel: `Preparation revision ${revision.revision}` });
      if (pageImages.length && pdf.engine !== "chrome") throw new Error("This revision includes source charts and requires the installed Chrome PDF renderer. Its HTML remains available.");
      bytes = Buffer.from(pdf.bytes); engine = pdf.engine;
    }
  }
  return { packetHash: packet?.snapshot_hash ?? null, bytes, checksum: createHash("sha256").update(bytes).digest("hex"), engine, format, contentType: row.content_type as string, workspaceId: row.workspace_id as string, revisionId: revision.id, revisionHash: revision.content_sha256 };
}
