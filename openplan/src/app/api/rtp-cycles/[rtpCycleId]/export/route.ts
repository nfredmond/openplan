import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { renderReportPdf } from "@/lib/reports/pdf";
import {
  buildRtpExportHtml,
  normalizeRtpLinkedProjects,
  type RtpExportCampaign,
  type RtpExportChapter,
  type RtpExportCycle,
  type RtpExportLinkedProject,
} from "@/lib/rtp/export";

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
      .select(
        "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, updated_at"
      )
      .eq("id", parsedParams.data.rtpCycleId)
      .maybeSingle();

    if (cycleError) {
      audit.error("cycle_lookup_failed", { message: cycleError.message, code: cycleError.code ?? null });
      return NextResponse.json({ error: "Failed to load RTP cycle" }, { status: 500 });
    }

    const cycle = cycleData as RtpExportCycle | null;
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

    const [chaptersResult, linksResult, campaignsResult] = await Promise.all([
      supabase
        .from("rtp_cycle_chapters")
        .select("id, title, section_type, status, summary, guidance, content_markdown, sort_order")
        .eq("rtp_cycle_id", cycle.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("project_rtp_cycle_links")
        .select("id, portfolio_role, priority_rationale, priority_scores, projects(id, name, status, delivery_phase, summary)")
        .eq("rtp_cycle_id", cycle.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("engagement_campaigns")
        .select("id, title, status, engagement_type, summary, rtp_cycle_chapter_id")
        .eq("rtp_cycle_id", cycle.id)
        .order("updated_at", { ascending: false }),
    ]);

    if (chaptersResult.error || linksResult.error || campaignsResult.error) {
      audit.error("related_export_lookup_failed", {
        chaptersError: chaptersResult.error?.message ?? null,
        linksError: linksResult.error?.message ?? null,
        campaignsError: campaignsResult.error?.message ?? null,
      });
      return NextResponse.json({ error: "Failed to assemble RTP export" }, { status: 500 });
    }

    const chapters = (chaptersResult.data ?? []) as RtpExportChapter[];
    const linkedProjects = normalizeRtpLinkedProjects((linksResult.data ?? []) as RtpExportLinkedProject[]);
    const campaigns = (campaignsResult.data ?? []) as RtpExportCampaign[];

    const exportInput = { cycle, chapters, linkedProjects, campaigns };

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
      const rendered = await renderReportPdf(buildRtpExportHtml(exportInput), {
        title: cycle.title,
        generatedAt: null,
        footerLabel: "OpenPlan RTP board packet",
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

    return new NextResponse(buildRtpExportHtml(exportInput), {
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
