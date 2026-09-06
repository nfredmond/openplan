import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkProgram, loadWorkProgramPreparation } from "@/lib/programs/work-program/server";
import { buildWorkProgramHtml, buildWorkProgramWorkbook, writeWorkProgramWorkbook } from "@/lib/programs/work-program/export";
import { workProgramDraftSchema } from "@/lib/programs/work-program/schema";
import { validateWorkProgramSources } from "@/lib/programs/work-program/source-review";
import { renderReportPdf } from "@/lib/reports/pdf";
import { createApiAuditLogger } from "@/lib/observability/audit";
import type { WorkProgramRevision } from "@/lib/programs/work-program/types";

const querySchema = z.object({ revision: z.coerce.number().int().positive(), format: z.enum(["html", "pdf", "xlsx"]) }).strict();

export async function GET(request: NextRequest, context: { params: Promise<{ programId: string }> }) {
  const audit = createApiAuditLogger("programs.workProgram.export", request);
  try {
    const { programId } = await context.params;
    const access = await authorizeWorkProgram(request, programId, false);
    if (access.response) return access.response;
    const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!query.success) return NextResponse.json({ error: "Choose a saved revision and export format" }, { status: 400 });
    const result = await access.supabase.from("program_work_program_revisions")
      .select("id, revision, previous_revision_id, request_id, content_json, content_sha256, source_ids, created_by, created_at")
      .eq("program_id", programId).eq("revision", query.data.revision).maybeSingle();
    if (result.error) return NextResponse.json({ error: "The saved revision could not be read" }, { status: 503 });
    if (!result.data) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    const revision = result.data as WorkProgramRevision;
    const parsed = workProgramDraftSchema.safeParse(revision.content_json);
    if (!parsed.success) return NextResponse.json({ error: "The saved proposal failed validation; export is withheld" }, { status: 409 });
    const preparation = await loadWorkProgramPreparation(access.supabase, programId);
    if (!revision.source_ids && query.data.format !== "html") return NextResponse.json({ error: "This early development revision has no frozen source register. Its text remains readable in history; save a new revision to produce a source-bound export." }, { status: 409 });
    const sourceIds = new Set(revision.source_ids ?? parsed.data.elements.flatMap((element) => element.source ? [element.source.sourceId] : []));
    const sources = preparation.sources.filter((source) => sourceIds.has(source.id));
    if (sources.length !== sourceIds.size) return NextResponse.json({ error: "A source in the frozen revision is unavailable; export is withheld" }, { status: 409 });
    if (validateWorkProgramSources(parsed.data, sources)) return NextResponse.json({ error: "The revision's retained source references could not be verified" }, { status: 409 });
    const headers: Record<string, string> = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-OpenPlan-Revision-SHA256": revision.content_sha256 };
    const name = `work-program-r${revision.revision}`;
    if (query.data.format === "xlsx") {
      const bytes = await writeWorkProgramWorkbook(buildWorkProgramWorkbook(revision, sources));
      return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
    }
    const html = buildWorkProgramHtml(revision, sources).replace("<body>", revision.source_ids ? "<body>" : '<body><p class="notice">Early development revision: the complete source register was not captured. Only directly cited work-element sources are shown. Save a new revision for a complete source-bound PDF or XLSX.</p>');
    if (query.data.format === "html") return new NextResponse(html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'" } });
    const pdf = await renderReportPdf(html, { title: `${parsed.data.agency} work program proposal`, generatedAt: revision.created_at, footerLabel: `Preparation revision ${revision.revision}` });
    audit.info("work_program_pdf_rendered", { programId, revision: revision.revision, engine: pdf.engine });
    return new NextResponse(new Uint8Array(pdf.bytes), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "X-OpenPlan-Pdf-Engine": pdf.engine } });
  } catch (error) {
    audit.error("work_program_export_failed", { error });
    return NextResponse.json({ error: "The complete export could not be produced. The saved proposal remains available; retry after the service recovers." }, { status: 503 });
  }
}
