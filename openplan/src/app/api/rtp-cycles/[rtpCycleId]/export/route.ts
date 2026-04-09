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

const paramsSchema = z.object({
  rtpCycleId: z.string().uuid(),
});

const formatSchema = z.object({
  format: z.enum(["html", "pdf"]).default("html"),
});

type RouteContext = {
  params: Promise<{ rtpCycleId: string }>;
};

type RtpCycleRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  adoption_target_date: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  summary: string | null;
  updated_at: string;
};

type ChapterRow = {
  id: string;
  title: string;
  section_type: string;
  status: string;
  summary: string | null;
  guidance: string | null;
  sort_order: number;
};

type LinkedProjectRow = {
  id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  projects:
    | {
        id: string;
        name: string;
        status: string | null;
        delivery_phase: string | null;
        summary: string | null;
      }
    | Array<{
        id: string;
        name: string;
        status: string | null;
        delivery_phase: string | null;
        summary: string | null;
      }>
    | null;
};

type CampaignRow = {
  id: string;
  title: string;
  status: string;
  engagement_type: string;
  summary: string | null;
  rtp_cycle_chapter_id: string | null;
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

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

function buildHtml(input: {
  cycle: RtpCycleRow;
  chapters: ChapterRow[];
  linkedProjects: Array<LinkedProjectRow & { project: { id: string; name: string; status: string | null; delivery_phase: string | null; summary: string | null } | null }>;
  campaigns: CampaignRow[];
}): string {
  const { cycle, chapters, linkedProjects, campaigns } = input;
  const campaignsByChapter = new Map<string, CampaignRow[]>();
  const cycleCampaigns: CampaignRow[] = [];
  for (const campaign of campaigns) {
    if (campaign.rtp_cycle_chapter_id) {
      const current = campaignsByChapter.get(campaign.rtp_cycle_chapter_id) ?? [];
      current.push(campaign);
      campaignsByChapter.set(campaign.rtp_cycle_chapter_id, current);
    } else {
      cycleCampaigns.push(campaign);
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(cycle.title)} · OpenPlan RTP Export</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; color: #16202a; margin: 40px; line-height: 1.5; }
    h1,h2,h3 { margin: 0 0 10px; }
    .muted { color: #5f6b76; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid #d8dee4; border-radius: 16px; padding: 16px; background: #fff; }
    .section { margin-top: 28px; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; border: 1px solid #d8dee4; font-size: 12px; margin-right: 8px; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
  <p class="muted">OpenPlan RTP Export · Generated ${esc(new Date().toLocaleString())}</p>
  <h1>${esc(cycle.title)}</h1>
  <p>${esc(cycle.summary?.trim() || "No cycle summary recorded yet.")}</p>
  <p>
    <span class="pill">${esc(formatRtpCycleStatusLabel(cycle.status))}</span>
    <span class="pill">${esc(cycle.geography_label?.trim() || "Geography not set")}</span>
    <span class="pill">Horizon ${esc(
      typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
        ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
        : "Not set"
    )}</span>
  </p>

  <div class="grid">
    <div class="card"><strong>Adoption target</strong><br/>${esc(formatDate(cycle.adoption_target_date))}</div>
    <div class="card"><strong>Public review window</strong><br/>${esc(
      cycle.public_review_open_at && cycle.public_review_close_at
        ? `${formatDate(cycle.public_review_open_at)} → ${formatDate(cycle.public_review_close_at)}`
        : "Not set"
    )}</div>
    <div class="card"><strong>Linked projects</strong><br/>${linkedProjects.length}</div>
    <div class="card"><strong>Engagement targets</strong><br/>${campaigns.length}</div>
  </div>

  <section class="section">
    <h2>Chapter workflow</h2>
    ${chapters
      .map(
        (chapter) => `<div class="card" style="margin-bottom:12px;">
          <h3>${esc(chapter.title)}</h3>
          <p class="muted">${esc(titleizeRtpValue(chapter.section_type))} · ${esc(formatRtpChapterStatusLabel(chapter.status))}</p>
          <p>${esc(chapter.summary?.trim() || "No working summary yet.")}</p>
          <p class="muted">${esc(chapter.guidance?.trim() || "No editorial guidance yet.")}</p>
          <p><strong>Chapter campaigns:</strong> ${campaignsByChapter.get(chapter.id)?.length ?? 0}</p>
        </div>`
      )
      .join("")}
  </section>

  <section class="section">
    <h2>Portfolio posture</h2>
    ${linkedProjects.length === 0 ? "<p class=\"muted\">No linked projects yet.</p>" : ""}
    ${linkedProjects
      .map(
        (link) => `<div class="card" style="margin-bottom:12px;">
          <h3>${esc(link.project?.name ?? "Linked project")}</h3>
          <p class="muted">${esc(formatRtpPortfolioRoleLabel(link.portfolio_role))} · ${esc(titleizeRtpValue(link.project?.status || "draft"))}</p>
          <p>${esc(link.priority_rationale?.trim() || link.project?.summary?.trim() || "No prioritization rationale recorded yet.")}</p>
        </div>`
      )
      .join("")}
  </section>

  <section class="section">
    <h2>Engagement targets</h2>
    ${campaigns.length === 0 ? "<p class=\"muted\">No RTP-linked engagement campaigns yet.</p>" : ""}
    <ul>
      ${campaigns
        .map(
          (campaign) => `<li><strong>${esc(campaign.title)}</strong> · ${esc(titleizeRtpValue(campaign.status))} · ${esc(titleizeRtpValue(campaign.engagement_type))}${campaign.summary ? ` · ${esc(campaign.summary)}` : ""}</li>`
        )
        .join("")}
    </ul>
  </section>

  <p class="muted" style="margin-top:32px;">Updated ${esc(formatDateTime(cycle.updated_at))}</p>
</body>
</html>`;
}

function buildPdfLines(input: {
  cycle: RtpCycleRow;
  chapters: ChapterRow[];
  linkedProjects: Array<LinkedProjectRow & { project: { id: string; name: string; status: string | null; delivery_phase: string | null; summary: string | null } | null }>;
  campaigns: CampaignRow[];
}): string[] {
  const { cycle, chapters, linkedProjects, campaigns } = input;
  return [
    "OpenPlan RTP Export",
    `Cycle: ${cycle.title}`,
    `Status: ${formatRtpCycleStatusLabel(cycle.status)}`,
    `Geography: ${cycle.geography_label?.trim() || "Not set"}`,
    `Horizon: ${typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number" ? `${cycle.horizon_start_year}-${cycle.horizon_end_year}` : "Not set"}`,
    `Adoption target: ${formatDate(cycle.adoption_target_date)}`,
    `Public review: ${cycle.public_review_open_at && cycle.public_review_close_at ? `${formatDate(cycle.public_review_open_at)} to ${formatDate(cycle.public_review_close_at)}` : "Not set"}`,
    "",
    "Summary:",
    cycle.summary?.trim() || "No cycle summary recorded yet.",
    "",
    `Chapters (${chapters.length}):`,
    ...chapters.flatMap((chapter) => [
      `${chapter.title} - ${formatRtpChapterStatusLabel(chapter.status)} - ${titleizeRtpValue(chapter.section_type)}`,
      chapter.summary?.trim() || "No working summary yet.",
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

    const cycle = cycleData as RtpCycleRow | null;
    if (!cycle) {
      return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
    }

    if (!membership || membership.workspace_id !== cycle.workspace_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [chaptersResult, linksResult, campaignsResult] = await Promise.all([
      supabase
        .from("rtp_cycle_chapters")
        .select("id, title, section_type, status, summary, guidance, sort_order")
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

    const chapters = (chaptersResult.data ?? []) as ChapterRow[];
    const linkedProjects = ((linksResult.data ?? []) as LinkedProjectRow[]).map((link) => ({
      ...link,
      project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
    }));
    const campaigns = (campaignsResult.data ?? []) as CampaignRow[];

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

    return new NextResponse(buildHtml(exportInput), {
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
