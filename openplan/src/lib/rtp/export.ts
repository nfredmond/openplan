import {
  formatRtpChapterStatusLabel,
  formatRtpCycleStatusLabel,
  formatRtpPortfolioRoleLabel,
  titleizeRtpValue,
} from "@/lib/rtp/catalog";

export type RtpExportCycle = {
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

export type RtpExportChapter = {
  id: string;
  title: string;
  section_type: string;
  status: string;
  summary: string | null;
  guidance: string | null;
  content_markdown: string | null;
  sort_order: number;
};

export type RtpExportLinkedProject = {
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

export type RtpExportCampaign = {
  id: string;
  title: string;
  status: string;
  engagement_type: string;
  summary: string | null;
  rtp_cycle_chapter_id: string | null;
};

export function normalizeRtpLinkedProjects(
  linkedProjects: RtpExportLinkedProject[]
): Array<
  RtpExportLinkedProject & {
    project: {
      id: string;
      name: string;
      status: string | null;
      delivery_phase: string | null;
      summary: string | null;
    } | null;
  }
> {
  return linkedProjects.map((link) => ({
    ...link,
    project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
  }));
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatRtpExportDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export function buildRtpExportHtml(input: {
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
}): string {
  const { cycle, chapters, linkedProjects, campaigns } = input;
  const campaignsByChapter = new Map<string, RtpExportCampaign[]>();
  const cycleCampaigns: RtpExportCampaign[] = [];
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
    <div class="card"><strong>Adoption target</strong><br/>${esc(formatRtpExportDate(cycle.adoption_target_date))}</div>
    <div class="card"><strong>Public review window</strong><br/>${esc(
      cycle.public_review_open_at && cycle.public_review_close_at
        ? `${formatRtpExportDate(cycle.public_review_open_at)} → ${formatRtpExportDate(cycle.public_review_close_at)}`
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
          <p>${esc(chapter.content_markdown?.trim() || "No draft chapter content yet.")}</p>
          <p class="muted">${esc(chapter.guidance?.trim() || "No editorial guidance yet.")}</p>
          <p><strong>Chapter campaigns:</strong> ${campaignsByChapter.get(chapter.id)?.length ?? 0}</p>
        </div>`
      )
      .join("")}
  </section>

  <section class="section">
    <h2>Portfolio posture</h2>
    ${linkedProjects.length === 0 ? '<p class="muted">No linked projects yet.</p>' : ""}
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
    ${campaigns.length === 0 ? '<p class="muted">No RTP-linked engagement campaigns yet.</p>' : ""}
    <ul>
      ${campaigns
        .map(
          (campaign) => `<li><strong>${esc(campaign.title)}</strong> · ${esc(titleizeRtpValue(campaign.status))} · ${esc(
            titleizeRtpValue(campaign.engagement_type)
          )}${campaign.rtp_cycle_chapter_id ? " · chapter-targeted" : " · cycle-targeted"}<br/>${esc(
            campaign.summary?.trim() || "No engagement summary recorded yet."
          )}</li>`
        )
        .join("")}
    </ul>
    ${cycleCampaigns.length > 0 ? `<p class="muted">Cycle-level campaigns: ${cycleCampaigns.length}</p>` : ""}
  </section>
</body>
</html>`;
}
