import { summarizeEngagementItems } from "@/lib/engagement/summary";

export type ReportEngagementCampaignRecord = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  share_token: string | null;
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

export type ReportEngagementHandoffCountsSnapshot = {
  totalItems: number;
  readyForHandoffCount: number;
  actionableCount: number;
  uncategorizedItems: number;
};

export type ReportEngagementHandoffCampaignSnapshot = {
  id: string;
  projectId: string | null;
  title: string;
  summary: string | null;
  status: string | null;
  engagementType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ReportEngagementHandoffProvenance = {
  origin: "engagement_campaign_handoff";
  reason: string;
  capturedAt: string;
  campaign: ReportEngagementHandoffCampaignSnapshot;
  counts: ReportEngagementHandoffCountsSnapshot;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildEngagementHandoffProvenance(input: {
  capturedAt: string;
  campaign: ReportEngagementHandoffCampaignSnapshot;
  counts: ReportEngagementHandoffCountsSnapshot;
}): ReportEngagementHandoffProvenance {
  return {
    origin: "engagement_campaign_handoff",
    reason:
      "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
    capturedAt: input.capturedAt,
    campaign: input.campaign,
    counts: input.counts,
  };
}

export function extractEngagementCampaignId(
  sections: Array<{ section_key: string; enabled: boolean; config_json: Record<string, unknown> | null }>
) {
  const provenance = extractEngagementHandoffProvenance(sections);
  if (provenance) {
    return provenance.campaign.id;
  }

  const engagementSection = sections.find(
    (section) => section.enabled && section.section_key === "engagement_summary"
  );
  const campaignId = engagementSection?.config_json?.campaignId;
  return typeof campaignId === "string" ? campaignId : null;
}

export function extractEngagementHandoffProvenance(
  sections: Array<{ section_key: string; enabled: boolean; config_json: Record<string, unknown> | null }>
): ReportEngagementHandoffProvenance | null {
  const sourceSection = sections.find((section) => {
    if (!section.enabled) {
      return false;
    }

    const provenance = asRecord(section.config_json?.provenance);
    return (
      (section.section_key === "engagement_summary" || section.section_key === "status_snapshot") &&
      provenance?.origin === "engagement_campaign_handoff"
    );
  });

  const provenance = asRecord(sourceSection?.config_json?.provenance);
  const campaign = asRecord(provenance?.campaign);
  const counts = asRecord(provenance?.counts);
  const totalItems = asNumber(counts?.totalItems);
  const readyForHandoffCount = asNumber(counts?.readyForHandoffCount);
  const actionableCount = asNumber(counts?.actionableCount);
  const uncategorizedItems = asNumber(counts?.uncategorizedItems);

  if (
    !provenance ||
    provenance.origin !== "engagement_campaign_handoff" ||
    !campaign ||
    typeof campaign.id !== "string" ||
    typeof campaign.title !== "string" ||
    !counts ||
    totalItems === null ||
    readyForHandoffCount === null ||
    actionableCount === null ||
    uncategorizedItems === null
  ) {
    return null;
  }

  return {
    origin: "engagement_campaign_handoff",
    reason:
      asNullableString(provenance.reason) ??
      "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
    capturedAt: asNullableString(provenance.capturedAt) ?? "",
    campaign: {
      id: campaign.id,
      projectId: asNullableString(campaign.projectId),
      title: campaign.title,
      summary: asNullableString(campaign.summary),
      status: asNullableString(campaign.status),
      engagementType: asNullableString(campaign.engagementType),
      createdAt: asNullableString(campaign.createdAt),
      updatedAt: asNullableString(campaign.updatedAt),
    },
    counts: {
      totalItems,
      readyForHandoffCount,
      actionableCount,
      uncategorizedItems,
    },
  };
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

export function collectReportIdsLinkedToEngagementCampaign(
  sections: Array<{
    report_id: string;
    section_key: string;
    enabled: boolean;
    config_json: Record<string, unknown> | null;
  }>,
  campaignId: string
) {
  const sectionsByReport = new Map<
    string,
    Array<{ section_key: string; enabled: boolean; config_json: Record<string, unknown> | null }>
  >();

  for (const section of sections) {
    const existing = sectionsByReport.get(section.report_id) ?? [];
    existing.push({
      section_key: section.section_key,
      enabled: section.enabled,
      config_json: section.config_json,
    });
    sectionsByReport.set(section.report_id, existing);
  }

  return new Set(
    [...sectionsByReport.entries()]
      .filter(([, reportSections]) => extractEngagementCampaignId(reportSections) === campaignId)
      .map(([reportId]) => reportId)
  );
}
