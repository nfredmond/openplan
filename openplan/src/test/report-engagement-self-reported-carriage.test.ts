import { describe, expect, it } from "vitest";

import {
  DEMOGRAPHICS_SCREENING_CAVEAT,
  shapeDemographicsSummary,
  type DemographicsSummaryRow,
} from "@/lib/engagement/demographics";
import { REPRESENTATIVENESS_SCREENING_CAVEAT, type CampaignRepresentativeness } from "@/lib/engagement/representativeness";
import {
  buildReportEngagementSelfReported,
  buildReportEngagementSummary,
} from "@/lib/reports/engagement";

const CAMPAIGN = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Corridor listening campaign",
  summary: null,
  status: "active",
  engagement_type: "comment_collection",
  share_token: null,
  updated_at: "2026-07-20T18:00:00.000Z",
};

const ROWS: DemographicsSummaryRow[] = [
  { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 20 },
  { dimension: "race_ethnicity", band: "white", respondent_count: 8 },
  { dimension: "race_ethnicity", band: "hispanic", respondent_count: 7 },
  { dimension: "race_ethnicity", band: "suppressed", respondent_count: 5 },
];

const REPRESENTATIVENESS: CampaignRepresentativeness = {
  metrics: [
    {
      key: "minority",
      label: "Residents of color (ACS)",
      baselinePct: 30,
      respondentPct: 12,
      representationRatio: 0.4,
      status: "under",
    },
  ],
  respondentCount: 24,
  tractCount: 6,
  underRepresented: ["minority"],
  caveat: REPRESENTATIVENESS_SCREENING_CAVEAT,
  computedAt: "2026-07-20T18:00:00.000Z",
  locatedRespondentCount: 31,
  studyAreaSource: "project_place",
};

function summaryWith(selfReported?: Parameters<typeof buildReportEngagementSummary>[0]["selfReported"]) {
  return buildReportEngagementSummary({
    campaign: CAMPAIGN,
    categories: [],
    items: [],
    representativeness: REPRESENTATIVENESS,
    selfReported,
  });
}

describe("carrying self-reported demographics into a report", () => {
  it("stays silent for a report path that never loaded the aggregate", () => {
    // The existing report routes do not read demographics. Silence is the only
    // honest output: "no demographics were collected" would be a claim the
    // caller has no evidence for.
    const summary = summaryWith();

    expect(summary?.selfReported).toBeNull();
    expect(summary?.joint).toBeNull();
    // The E5b screening still travels exactly as before.
    expect(summary?.representativeness).toBe(REPRESENTATIVENESS);
  });

  it("carries the suppression note and the screening caveat with every published count", () => {
    const summary = summaryWith({ state: "loaded", summary: shapeDemographicsSummary(ROWS) });

    expect(summary?.selfReported?.respondentsWithDemographics).toBe(20);
    expect(summary?.selfReported?.hasSuppressed).toBe(true);
    expect(summary?.selfReported?.caveat).toBe(DEMOGRAPHICS_SCREENING_CAVEAT);
    expect(summary?.selfReported?.suppressionNote).toContain("do not sum to the respondent total");
    expect(summary?.selfReported?.dimensions.race_ethnicity.map((band) => band.band)).toEqual([
      "white",
      "hispanic",
      "suppressed",
    ]);
  });

  it("still names k-anonymity when no cell happened to be suppressed", () => {
    const selfReported = buildReportEngagementSelfReported({
      state: "loaded",
      summary: shapeDemographicsSummary([
        { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 20 },
        { dimension: "race_ethnicity", band: "hispanic", respondent_count: 7 },
      ]),
    });

    expect(selfReported?.hasSuppressed).toBe(false);
    expect(selfReported?.suppressionNote).toContain("would have been suppressed");
    expect(selfReported?.caveat).toBe(DEMOGRAPHICS_SCREENING_CAVEAT);
  });

  it("derives the joint reading inside the builder so the two halves cannot drift apart", () => {
    const summary = summaryWith({ state: "loaded", summary: shapeDemographicsSummary(ROWS) });

    expect(summary?.joint?.reading).toBe("floor_at_or_above_area");
    expect(summary?.joint?.rebutsAreaFlag).toBe(true);
    expect(summary?.joint?.ecological?.areaBaselinePct).toBe(30);
    expect(summary?.joint?.selfReported?.floorPct).toBe(35);
    expect(summary?.joint?.caveat).toContain(DEMOGRAPHICS_SCREENING_CAVEAT);
  });

  it("carries a failed demographics read into the report as unknown, not as absent", () => {
    const summary = summaryWith({ state: "unreadable", message: "permission denied for function" });

    expect(summary?.selfReported).toBeNull();
    expect(summary?.joint?.reading).toBe("self_reported_unreadable");
    expect(summary?.joint?.readFailureMessage).toBe("permission denied for function");
  });

  it("publishes nothing self-reported when the campaign never collected any", () => {
    const summary = summaryWith({ state: "not_collected" });

    expect(summary?.selfReported).toBeNull();
    expect(summary?.joint?.reading).toBe("ecological_only");
    expect(summary?.joint?.caveat).not.toContain(DEMOGRAPHICS_SCREENING_CAVEAT);
  });

  it("cannot be handed a self-reported record whose caveat was written by the caller", () => {
    // The report-facing record is built from the shared constants, never from a
    // caller-supplied string, so there is no path that carries counts with a
    // softened note attached.
    const record = buildReportEngagementSelfReported({
      state: "loaded",
      summary: {
        ...shapeDemographicsSummary(ROWS),
        caveat: "Representative sample of the community.",
      },
    });

    expect(record?.caveat).toBe(DEMOGRAPHICS_SCREENING_CAVEAT);
  });
});
