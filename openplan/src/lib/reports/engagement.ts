import { summarizeEngagementItems } from "@/lib/engagement/summary";

export type ReportEngagementCampaignRecord = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  updated_at: string;
};

export type ReportEngagementCategoryRecord = {
  id: string;
  label: string;
  slug: string | null;
  description: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ReportEngagementItemRecord = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  status: string | null;
  source_type: string | null;
  latitude: number | null;
  longitude: number | null;
  moderation_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ReportEngagementSummary = {
  campaign: ReportEngagementCampaignRecord;
  counts: ReturnType<typeof summarizeEngagementItems>;
  categories: ReportEngagementCategoryRecord[];
};

export function extractEngagementCampaignId(
  sections: Array<{ section_key: string; enabled: boolean; config_json: Record<string, unknown> | null }>
) {
  const engagementSection = sections.find(
    (section) => section.enabled && section.section_key === "engagement_summary"
  );
  const campaignId = engagementSection?.config_json?.campaignId;
  return typeof campaignId === "string" ? campaignId : null;
}

export function buildReportEngagementSummary({
  campaign,
  categories,
  items,
}: {
  campaign: ReportEngagementCampaignRecord | null;
  categories: ReportEngagementCategoryRecord[];
  items: ReportEngagementItemRecord[];
}): ReportEngagementSummary | null {
  if (!campaign) {
    return null;
  }

  return {
    campaign,
    counts: summarizeEngagementItems(categories, items),
    categories,
  };
}
