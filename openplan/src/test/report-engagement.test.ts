import { describe, expect, it } from "vitest";
import {
  buildReportEngagementSummary,
  collectReportIdsLinkedToEngagementCampaign,
  extractEngagementCampaignId,
} from "@/lib/reports/engagement";

describe("report engagement helpers", () => {
  it("extracts the configured campaign id from an enabled engagement summary section", () => {
    expect(
      extractEngagementCampaignId([
        {
          section_key: "project_overview",
          enabled: true,
          config_json: null,
        },
        {
          section_key: "engagement_summary",
          enabled: true,
          config_json: {
            campaignId: "99999999-9999-4999-8999-999999999999",
          },
        },
      ])
    ).toBe("99999999-9999-4999-8999-999999999999");
  });

  it("ignores disabled or malformed engagement sections", () => {
    expect(
      extractEngagementCampaignId([
        {
          section_key: "engagement_summary",
          enabled: false,
          config_json: {
            campaignId: "99999999-9999-4999-8999-999999999999",
          },
        },
        {
          section_key: "engagement_summary",
          enabled: true,
          config_json: {
            campaignId: 42,
          } as unknown as Record<string, unknown>,
        },
      ])
    ).toBeNull();
  });

  it("builds a summary with engagement counts when campaign data exists", () => {
    const summary = buildReportEngagementSummary({
      campaign: {
        id: "99999999-9999-4999-8999-999999999999",
        title: "Downtown listening campaign",
        summary: "Capture walking and crossing feedback.",
        status: "active",
        engagement_type: "comment_collection",
        share_token: null,
        updated_at: "2026-03-14T02:30:00.000Z",
      },
      categories: [
        {
          id: "category-1",
          label: "Safety",
          slug: "safety",
          description: "Crossings and speed management",
          sort_order: 0,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-13T00:00:00.000Z",
        },
      ],
      items: [
        {
          id: "item-1",
          campaign_id: "99999999-9999-4999-8999-999999999999",
          category_id: "category-1",
          status: "approved",
          source_type: "meeting",
          latitude: 39.1454,
          longitude: -121.6489,
          moderation_notes: "Verified in workshop.",
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-14T03:00:00.000Z",
        },
      ],
    });

    expect(summary?.campaign.title).toBe("Downtown listening campaign");
    expect(summary?.counts.totalItems).toBe(1);
    expect(summary?.counts.moderationQueue.readyForHandoffCount).toBe(1);
  });

  it("collects only report ids that explicitly reference the campaign in an engagement summary section", () => {
    const linkedReportIds = collectReportIdsLinkedToEngagementCampaign(
      [
        {
          report_id: "report-1",
          section_key: "engagement_summary",
          enabled: true,
          config_json: {
            campaignId: "campaign-1",
          },
        },
        {
          report_id: "report-1",
          section_key: "project_overview",
          enabled: true,
          config_json: null,
        },
        {
          report_id: "report-2",
          section_key: "engagement_summary",
          enabled: true,
          config_json: {
            campaignId: "campaign-2",
          },
        },
        {
          report_id: "report-3",
          section_key: "engagement_summary",
          enabled: false,
          config_json: {
            campaignId: "campaign-1",
          },
        },
      ],
      "campaign-1"
    );

    expect([...linkedReportIds]).toEqual(["report-1"]);
  });
});
