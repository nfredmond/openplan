import { summarizeEngagementItems } from "@/lib/engagement/summary";
import type { HotspotAnalysis } from "@/lib/engagement/hotspots";
import type { CampaignRepresentativeness } from "@/lib/engagement/representativeness";
import {
  DEMOGRAPHICS_SCREENING_CAVEAT,
  type DemographicsSummary,
  type SelfReportedDemographicsSource,
} from "@/lib/engagement/demographics";
import {
  buildJointRepresentativeness,
  jointReadingIsPresentable,
  type JointRepresentativeness,
} from "@/lib/engagement/joint-representativeness";
import {
  ENGAGEMENT_NARRATIVE_CAVEAT,
  parseStoredEngagementSynthesis,
  type EngagementSynthesisEvidence,
} from "@/lib/grants/engagement-evidence";
import {
  isNarrativeExportable,
  parseStoredNarrativeGrounding,
  stripFactCitationTokens,
} from "@/lib/grants/narrative-grounding";

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
  /** Screening-grade spatial hotspots (E3), when computed by the caller. */
  hotspots: HotspotAnalysis | null;
  /** Cached spatial representativeness screening (E5b), when present. */
  representativeness: CampaignRepresentativeness | null;
  /**
   * k-anonymized self-reported respondent demographics (E5a), when the caller
   * actually loaded them. Null whenever the caller did not read them, the
   * campaign never collected them, the read failed, or nobody answered — a
   * report may not assert "no demographics were collected" on any of those.
   */
  selfReported: ReportEngagementSelfReported | null;
  /**
   * The joint reading across E5a and E5b (E5c), present only when there is
   * something honest to say. Null when the caller never loaded the self-reported
   * side, so an unwired report path stays silent instead of half-claiming.
   */
  joint: JointRepresentativeness | null;
  /** Cached E1 comment synthesis (themes/sentiment + export-gated narrative). */
  synthesis: ReportEngagementSynthesis | null;
};

/**
 * The self-reported aggregate as it travels into a report artifact.
 *
 * WHY A SEPARATE TYPE RATHER THAN THE `DemographicsSummary` ITSELF. A report is
 * an export path, and from there the counts get quoted into narrative prose. A
 * k-anonymized aggregate that arrives somewhere without its suppression note
 * reads as a complete census of respondents, which is exactly the laundering
 * this repo forbids — the note is part of the number, not a UI decoration around
 * it. Both string fields are REQUIRED here and are written by
 * `buildReportEngagementSelfReported` from the shared constants, never taken
 * from the caller, so there is no shape of this record that carries counts
 * without carrying why they are incomplete.
 */
export type ReportEngagementSelfReported = {
  /** Respondents who shared any demographics — the only published denominator. */
  respondentsWithDemographics: number;
  dimensions: DemographicsSummary["dimensions"];
  /** True when at least one cell was collapsed into the `suppressed` bucket. */
  hasSuppressed: boolean;
  /** Always present: what suppression did to these counts. */
  suppressionNote: string;
  /** Always present: DEMOGRAPHICS_SCREENING_CAVEAT, verbatim. */
  caveat: string;
};

const SUPPRESSION_NOTE_APPLIED =
  "k-anonymized: categories with fewer than five respondents are collapsed into a suppressed bucket, and a residual under five is dropped entirely. These counts therefore do not sum to the respondent total, and the number behind any one question is not published.";

const SUPPRESSION_NOTE_NONE_APPLIED =
  "k-anonymized: any category with fewer than five respondents would have been suppressed. None were on this campaign, but the counts still describe only the respondents who chose to answer.";

/**
 * Shape the k-anon aggregate for report carriage, or return null when there is
 * nothing publishable. Returns null for every non-`loaded` state as well, so a
 * report path that has not been wired to read demographics carries silence
 * rather than a claim that none exist.
 */
export function buildReportEngagementSelfReported(
  source: SelfReportedDemographicsSource
): ReportEngagementSelfReported | null {
  if (source.state !== "loaded" || !source.summary.hasAny) {
    return null;
  }

  return {
    respondentsWithDemographics: source.summary.respondentsWithDemographics,
    dimensions: source.summary.dimensions,
    hasSuppressed: source.summary.hasSuppressed,
    suppressionNote: source.summary.hasSuppressed ? SUPPRESSION_NOTE_APPLIED : SUPPRESSION_NOTE_NONE_APPLIED,
    caveat: DEMOGRAPHICS_SCREENING_CAVEAT,
  };
}

export type ReportEngagementSynthesis = EngagementSynthesisEvidence & {
  /**
   * Token-stripped narrative prose, present ONLY when the stored grounding
   * passes `isNarrativeExportable` (every sentence grounded AND the
   * faithfulness belt ran). A report artifact is an export path, so a
   * narrative with flagged sentences — or a pre-belt legacy row — is withheld
   * here and left to operator review on the campaign page.
   */
  narrative: string | null;
  /** True when a narrative exists in the cache but the export gate refused it. */
  narrativeWithheld: boolean;
  caveat: string;
};

/**
 * Parse a stored `ai_synthesis_json` for report rendering: headline fields via
 * the shared defensive parser, plus the export-gated narrative.
 */
export function buildReportEngagementSynthesis(value: unknown): ReportEngagementSynthesis | null {
  const headline = parseStoredEngagementSynthesis(value);
  if (!headline) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawNarrative = typeof record.narrative === "string" ? record.narrative.trim() : "";
  const grounding = parseStoredNarrativeGrounding(record.grounding);
  const exportable = Boolean(rawNarrative) && grounding !== null && isNarrativeExportable(grounding);
  const strippedNarrative = exportable ? stripFactCitationTokens(rawNarrative) : "";

  return {
    ...headline,
    narrative: strippedNarrative || null,
    narrativeWithheld: Boolean(rawNarrative) && !strippedNarrative,
    caveat:
      typeof record.caveat === "string" && record.caveat.trim()
        ? record.caveat
        : ENGAGEMENT_NARRATIVE_CAVEAT,
  };
}

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
  hotspots = null,
  representativeness = null,
  selfReported = { state: "not_loaded" },
  synthesis = null,
}: {
  campaign: ReportEngagementCampaignRecord | null;
  categories: ReportEngagementCategoryRecord[];
  items: ReportEngagementItemRecord[];
  hotspots?: HotspotAnalysis | null;
  representativeness?: CampaignRepresentativeness | null;
  /**
   * Defaults to `not_loaded` because a caller that has not been wired to read
   * the k-anon aggregate must produce silence, not the assertion that a campaign
   * collected nothing. Pass a real state to make the self-reported side travel.
   */
  selfReported?: SelfReportedDemographicsSource;
  synthesis?: ReportEngagementSynthesis | null;
}): ReportEngagementSummary | null {
  if (!campaign) {
    return null;
  }

  // The joint reading is derived HERE rather than accepted from the caller, so
  // a report can never carry a self-reported figure that was compared against a
  // different baseline than the one printed beside it.
  const joint =
    selfReported.state === "not_loaded"
      ? null
      : buildJointRepresentativeness({ ecological: representativeness, selfReported });

  return {
    campaign,
    counts: summarizeEngagementItems(categories, items),
    categories,
    hotspots,
    representativeness,
    selfReported: buildReportEngagementSelfReported(selfReported),
    joint: joint && jointReadingIsPresentable(joint) ? joint : null,
    synthesis,
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
