import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { renderReportPdf } from "@/lib/reports/pdf";
import {
  buildRtpCycleExportInput,
  renderRtpExportDocumentHtml,
  RTP_EXPORT_CYCLE_COLUMNS,
  type RtpExportInputCycleRow,
  type RtpExportInputSupabaseLike,
} from "@/lib/rtp/export-input";

const paramsSchema = z.object({
  rtpCycleId: z.string().uuid(),
});

const formatSchema = z.object({
  format: z.enum(["html", "pdf"]).default("html"),
});

type RouteContext = {
  params: Promise<{ rtpCycleId: string }>;
};


export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.export", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    const parsedFormat = formatSchema.safeParse({
      format: request.nextUrl.searchParams.get("format") ?? undefined,
    });

    if (!parsedParams.success || !parsedFormat.success) {
      return NextResponse.json({ error: "Invalid export request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: cycleData, error: cycleError } = await supabase
      .from("rtp_cycles")
      .select(RTP_EXPORT_CYCLE_COLUMNS)
      .eq("id", parsedParams.data.rtpCycleId)
      .maybeSingle();

    if (cycleError) {
      audit.error("cycle_lookup_failed", { message: cycleError.message, code: cycleError.code ?? null });
      return NextResponse.json({ error: "Failed to load RTP cycle" }, { status: 500 });
    }

    const cycle = cycleData as RtpExportInputCycleRow | null;
    if (!cycle) {
      return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("workspace_id", cycle.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { message: membershipError.message, code: membershipError.code ?? null });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ONE builder, both routes. The board packet and this export used to load
    // different amounts of data for the same document, and the difference was
    // invisible on both — see `src/lib/rtp/export-input.ts` for what that cost.
    // Nothing about the document's contents is decided here any more: this route
    // supplies only WHO is asking and WHICH document this is.
    const built = await buildRtpCycleExportInput({
      supabase: supabase as unknown as RtpExportInputSupabaseLike,
      audit,
      cycle,
      presentation: {
        titleSuffix: "OpenPlan RTP Export",
        // No report exists behind this button, so there are no `report_sections`
        // rows to compose from. The whole plan is exported, and the document
        // says so rather than leaving a reader to assume it matches a packet.
        composition: { kind: "whole_plan" },
      },
      // This route never reads `reports` or `report_artifacts`, and a cycle can
      // be exported before any packet has ever been generated. It used to be
      // handed a hardcoded "1 packet record, 1 generated", so a planner's plan
      // export asserted a board packet that need not exist. It knows of none,
      // and saying "none exist" would be the same lie in the other direction.
      packetRecords: { examined: false },
    });

    if (!built.ok) {
      audit.error(built.refusal.auditEvent, {
        rtpCycleId: cycle.id,
        message: built.refusal.message,
        code: built.refusal.code,
        pendingSchema: built.refusal.pending,
      });
      return NextResponse.json(built.refusal.body, { status: built.refusal.status });
    }

    // The document is SEALED: there is no expression here that can add to, drop
    // from or re-key what the shared builder decided. See the envelope comment
    // in `@/lib/rtp/export-input` for the override this closes.
    const html = renderRtpExportDocumentHtml(built.document);

    audit.info("export_generated", {
      rtpCycleId: cycle.id,
      format: parsedFormat.data.format,
      durationMs: Date.now() - startedAt,
    });

    if (parsedFormat.data.format === "pdf") {
      // The board packet PDF is now the SAME document as the HTML export. The
      // replaced builder assembled its own, much shorter line list — omitting
      // the modeling-evidence claim posture, the funding source-context scans,
      // the adoption-record checklist and the appendix outright — and then cut
      // it to 60 lines on a single `/Count 1` page. A multi-chapter packet a
      // planner spent hours on left the building as one clipped page.
      const rendered = await renderReportPdf(html, {
        title: cycle.title,
        generatedAt: null,
        // NOT "board packet". This route is the whole-plan export; the packet is
        // the report-generate route's artifact. A document whose footer claims
        // to be the other one is the same confusion this seam was built to end.
        footerLabel: "OpenPlan RTP export",
      });

      if (rendered.engine === "builtin") {
        audit.warn("rtp_export_pdf_builtin_typesetter_used", {
          rtpCycleId: cycle.id,
          pageCount: rendered.pageCount,
        });
      }

      const pdfBuffer = rendered.bytes.buffer.slice(
        rendered.bytes.byteOffset,
        rendered.bytes.byteOffset + rendered.bytes.byteLength
      ) as ArrayBuffer;

      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${cycle.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-rtp-export.pdf"`,
          "x-openplan-pdf-engine": rendered.engine,
        },
      });
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to export RTP cycle" }, { status: 500 });
  }
}
