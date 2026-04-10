import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  formatRtpChapterStatusLabel,
  formatRtpCycleStatusLabel,
  formatRtpPortfolioRoleLabel,
  titleizeRtpValue,
} from "@/lib/rtp/catalog";
import {
  buildRtpExportHtml,
  formatRtpExportDate,
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

function pdfEscape(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrapText(line: string, max = 92): string[] {
  if (!line || line.length <= max) return [line];
  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function buildPdf(lines: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const wrappedLines = lines.flatMap((line) => wrapText(line)).slice(0, 60);
  const commands = ["BT", "/F1 11 Tf", "45 760 Td", "13 TL"];
  for (const line of wrappedLines) {
    commands.push(`(${pdfEscape(line)}) Tj`);
    commands.push("T*");
  }
  commands.push("ET");
  const stream = commands.join("\n");
  const length = encoder.encode(stream).length;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${length} >>\nstream\n${stream}\nendstream`,
  ];
  const parts: string[] = [];
  let cursor = 0;
  const offsets = [0];
  const push = (part: string) => {
    parts.push(part);
    cursor += encoder.encode(part).length;
  };
  push("%PDF-1.4\n%OpenPlan\n");
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(cursor);
    push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefStart = cursor;
  push(`xref\n0 ${objects.length + 1}\n`);
  push("0000000000 65535 f \n");
  for (let i = 1; i < offsets.length; i += 1) {
    push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`);
  push(`startxref\n${xrefStart}\n%%EOF\n`);
  return encoder.encode(parts.join(""));
}

function buildPdfLines(input: {
  cycle: RtpExportCycle;
  chapters: RtpExportChapter[];
  linkedProjects: Array<
    RtpExportLinkedProject & {
      project: {
        id: string;
        name: string;
        status: string | null;
        delivery_phase: string | null;
        summary: string | null;
      } | null;
    }
  >;
  campaigns: RtpExportCampaign[];
}): string[] {
  const { cycle, chapters, linkedProjects, campaigns } = input;
  return [
    "OpenPlan RTP Export",
    `Cycle: ${cycle.title}`,
    `Status: ${formatRtpCycleStatusLabel(cycle.status)}`,
    `Geography: ${cycle.geography_label?.trim() || "Not set"}`,
    `Horizon: ${typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number" ? `${cycle.horizon_start_year}-${cycle.horizon_end_year}` : "Not set"}`,
    `Adoption target: ${formatRtpExportDate(cycle.adoption_target_date)}`,
    `Public review: ${cycle.public_review_open_at && cycle.public_review_close_at ? `${formatRtpExportDate(cycle.public_review_open_at)} to ${formatRtpExportDate(cycle.public_review_close_at)}` : "Not set"}`,
    "",
    "Summary:",
    cycle.summary?.trim() || "No cycle summary recorded yet.",
    "",
    `Chapters (${chapters.length}):`,
    ...chapters.flatMap((chapter) => [
      `${chapter.title} - ${formatRtpChapterStatusLabel(chapter.status)} - ${titleizeRtpValue(chapter.section_type)}`,
      chapter.summary?.trim() || "No working summary yet.",
      chapter.content_markdown?.trim() || "No draft chapter content yet.",
    ]),
    "",
    `Linked projects (${linkedProjects.length}):`,
    ...linkedProjects.flatMap((link) => [
      `${link.project?.name ?? "Linked project"} - ${formatRtpPortfolioRoleLabel(link.portfolio_role)}`,
      link.priority_rationale?.trim() || link.project?.summary?.trim() || "No prioritization rationale recorded yet.",
    ]),
    "",
    `Engagement targets (${campaigns.length}):`,
    ...campaigns.map(
      (campaign) => `${campaign.title} - ${titleizeRtpValue(campaign.status)} - ${titleizeRtpValue(campaign.engagement_type)}`
    ),
  ];
}

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

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { message: membershipError.message, code: membershipError.code ?? null });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
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

    if (!membership || membership.workspace_id !== cycle.workspace_id) {
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
        .select("id, portfolio_role, priority_rationale, projects(id, name, status, delivery_phase, summary)")
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
      const pdf = Uint8Array.from(buildPdf(buildPdfLines(exportInput)));
      return new NextResponse(pdf.buffer, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${cycle.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-rtp-export.pdf"`,
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
