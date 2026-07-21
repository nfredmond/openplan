import { describe, expect, it } from "vitest";
import {
  buildReportEngagementSummary,
  buildReportEngagementSynthesis,
  collectReportIdsLinkedToEngagementCampaign,
  extractEngagementCampaignId,
} from "@/lib/reports/engagement";

// A stored E1 synthesis whose narrative passes the export gate: every
// sentence grounded and the faithfulness belt ran.
function storedSynthesis(overrides: Record<string, unknown> = {}) {
  return {
    source: "ai",
    model: "claude-haiku-4-5-20251001",
    fallback_reason: null,
    item_count: 3,
    analyzed_item_count: 3,
    overall_sentiment: "negative",
    themes: [{ label: "Crossing safety", sentiment: "negative", item_count: 3, fact_ids: [], summary: "" }],
    narrative: "Residents repeatedly flagged the Main St crossing as unsafe. [fact:item_a][fact:item_b]",
    caveat: "Synthesis caveat text.",
    grounding: {
      mode: "annotated",
      facts: [],
      sentences: [
        {
          text: "Residents repeatedly flagged the Main St crossing as unsafe. [fact:item_a][fact:item_b]",
          cited_fact_ids: ["item_a", "item_b"],
          is_grounded: true,
          unknown_fact_ids: [],
          unfaithful_claims: [],
        },
      ],
      dropped_sentences: [],
      cited_fact_ids: ["item_a", "item_b"],
      unknown_fact_ids: [],
      grounded_sentence_count: 1,
      total_sentence_count: 1,
      is_fully_grounded: true,
      faithfulness_checked: true,
    },
    ...overrides,
  };
}

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
    // Callers that do not pass a synthesis get an explicit null, not undefined.
    expect(summary?.synthesis).toBeNull();
  });

  it("ships an exportable synthesis narrative token-stripped", () => {
    const synthesis = buildReportEngagementSynthesis(storedSynthesis());

    expect(synthesis?.narrative).toBe("Residents repeatedly flagged the Main St crossing as unsafe.");
    expect(synthesis?.narrative).not.toContain("[fact:");
    expect(synthesis?.narrativeWithheld).toBe(false);
    expect(synthesis?.overallSentiment).toBe("negative");
    expect(synthesis?.themes).toEqual([
      { label: "Crossing safety", sentiment: "negative", itemCount: 3 },
    ]);
    expect(synthesis?.caveat).toBe("Synthesis caveat text.");
  });

  it("withholds the narrative when any sentence failed grounding — a report is an export path", () => {
    const stored = storedSynthesis();
    const grounding = stored.grounding as { sentences: Array<Record<string, unknown>>; is_fully_grounded: boolean };
    grounding.sentences[0].is_grounded = false;
    grounding.is_fully_grounded = false;

    const synthesis = buildReportEngagementSynthesis(stored);
    expect(synthesis?.narrative).toBeNull();
    expect(synthesis?.narrativeWithheld).toBe(true);
    // Themes and sentiment still render; only the prose is gated.
    expect(synthesis?.themes).toHaveLength(1);
  });

  it("withholds a legacy pre-belt narrative even when its citation pass looked clean", () => {
    const stored = storedSynthesis();
    delete (stored.grounding as Record<string, unknown>).faithfulness_checked;

    const synthesis = buildReportEngagementSynthesis(stored);
    expect(synthesis?.narrative).toBeNull();
    expect(synthesis?.narrativeWithheld).toBe(true);
  });

  it("withholds the narrative when the stored grounding is missing or malformed", () => {
    const noGrounding = buildReportEngagementSynthesis(storedSynthesis({ grounding: null }));
    expect(noGrounding?.narrative).toBeNull();
    expect(noGrounding?.narrativeWithheld).toBe(true);

    const malformed = buildReportEngagementSynthesis(storedSynthesis({ grounding: { mode: "weird" } }));
    expect(malformed?.narrative).toBeNull();
    expect(malformed?.narrativeWithheld).toBe(true);
  });

  it("returns null for a malformed cache and falls back to the shared caveat when none is stored", () => {
    expect(buildReportEngagementSynthesis(null)).toBeNull();
    expect(buildReportEngagementSynthesis({ source: "human" })).toBeNull();

    const noCaveat = buildReportEngagementSynthesis(storedSynthesis({ caveat: "  " }));
    expect(noCaveat?.caveat).toContain("not a statistically representative survey");
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
