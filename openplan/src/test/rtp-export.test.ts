import { describe, expect, it } from "vitest";
import { buildRtpExportHtml, normalizeRtpLinkedProjects } from "@/lib/rtp/export";

describe("buildRtpExportHtml", () => {
  it("renders public review loop posture when provided", () => {
    const html = buildRtpExportHtml({
      cycle: {
        id: "cycle-1",
        workspace_id: "workspace-1",
        title: "2027 RTP",
        status: "public_review",
        geography_label: "Nevada County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: "2026-06-01T00:00:00.000Z",
        public_review_open_at: "2026-04-20T00:00:00.000Z",
        public_review_close_at: "2026-05-20T00:00:00.000Z",
        summary: "Cycle summary",
        updated_at: "2026-04-16T00:00:00.000Z",
      },
      chapters: [
        {
          id: "chapter-1",
          title: "Consultation and engagement",
          section_type: "engagement",
          status: "ready_for_review",
          summary: "Chapter summary",
          guidance: "Chapter guidance",
          content_markdown: "Draft content",
          sort_order: 10,
        },
      ],
      linkedProjects: normalizeRtpLinkedProjects([
        {
          id: "link-1",
          portfolio_role: "constrained",
          priority_rationale: "Priority rationale",
          projects: {
            id: "project-1",
            name: "Main Street Safety",
            status: "active",
            delivery_phase: "analysis",
            summary: "Project summary",
          },
        },
      ]),
      campaigns: [
        {
          id: "campaign-1",
          title: "Planwide comments",
          status: "active",
          engagement_type: "comment_collection",
          summary: "Collect planwide feedback",
          rtp_cycle_chapter_id: null,
        },
      ],
      options: {
        titleSuffix: "OpenPlan RTP Packet",
        publicReviewSummary: {
          label: "Comment-response foundation ready",
          detail: "5 approved comments are ready for packet handoff and the current RTP packet is in place for review closure.",
          tone: "success",
          actionItems: ["Carry approved comments into the board-ready response summary."],
          cycleLevelCampaignCount: 1,
          chapterLevelCampaignCount: 0,
          pendingCommentCount: 0,
          readyCommentCount: 5,
        },
      },
    });

    expect(html).toContain("Comment-response foundation ready");
    expect(html).toContain("5 approved comments are ready for packet handoff");
    expect(html).toContain("1 cycle targets · 0 chapter targets · 5 ready comments · 0 pending comments");
  });
});
