import { describe, expect, it } from "vitest";

import {
  DEMOGRAPHICS_SCREENING_CAVEAT,
  shapeDemographicsSummary,
  type DemographicsSummaryRow,
  type SelfReportedDemographicsSource,
} from "@/lib/engagement/demographics";
import {
  buildJointRepresentativeness,
  jointReadingIsPresentable,
  JOINT_REPRESENTATIVENESS_CAVEAT,
} from "@/lib/engagement/joint-representativeness";
import {
  REPRESENTATIVENESS_SCREENING_CAVEAT,
  type CampaignRepresentativeness,
} from "@/lib/engagement/representativeness";

/**
 * A cached E5b screening whose `minority` metric carries the given area
 * baseline / respondent-tract share. Everything else is realistic filler.
 */
function ecological(overrides: {
  baselinePct: number | null;
  respondentPct?: number | null;
  status?: "under" | "over" | "balanced" | "insufficient";
  ratio?: number | null;
}): CampaignRepresentativeness {
  const status = overrides.status ?? "under";
  return {
    metrics: [
      {
        key: "minority",
        label: "Residents of color (ACS)",
        baselinePct: overrides.baselinePct,
        respondentPct: overrides.respondentPct ?? 12,
        representationRatio: overrides.ratio ?? 0.4,
        status,
      },
      {
        key: "belowPoverty",
        label: "Residents below poverty",
        baselinePct: 18,
        respondentPct: 17,
        representationRatio: 0.94,
        status: "balanced",
      },
    ],
    respondentCount: 24,
    tractCount: 6,
    underRepresented: status === "under" ? ["minority"] : [],
    caveat: REPRESENTATIVENESS_SCREENING_CAVEAT,
    computedAt: "2026-07-20T18:00:00.000Z",
    locatedRespondentCount: 31,
    studyAreaSource: "project_place",
  };
}

/**
 * A k-anon aggregate as the RPC actually publishes it: every visible cell >= 5,
 * a `suppressed` residual, and NO per-dimension total (the bands deliberately do
 * not sum to the respondent count).
 */
const RACE_ROWS: DemographicsSummaryRow[] = [
  { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 20 },
  { dimension: "race_ethnicity", band: "white", respondent_count: 8 },
  { dimension: "race_ethnicity", band: "hispanic", respondent_count: 7 },
  { dimension: "race_ethnicity", band: "black", respondent_count: 5 },
  { dimension: "race_ethnicity", band: "suppressed", respondent_count: 5 },
  { dimension: "age_band", band: "35_44", respondent_count: 9 },
];

function loaded(rows: DemographicsSummaryRow[] = RACE_ROWS): SelfReportedDemographicsSource {
  return { state: "loaded", summary: shapeDemographicsSummary(rows) };
}

describe("buildJointRepresentativeness", () => {
  it("lets a self-reported floor at or above the area share rebut the area-based under-representation flag", () => {
    // Largest qualifying band is Hispanic/Latino at 7 of 20 respondents = 35%,
    // against a 30% area share — so the tract-level inference does not describe
    // the respondents we actually hold answers for.
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: loaded(),
    });

    expect(joint.reading).toBe("floor_at_or_above_area");
    expect(joint.rebutsAreaFlag).toBe(true);
    expect(joint.selfReported?.floorPct).toBe(35);
    expect(joint.selfReported?.floorRespondentCount).toBe(7);
    expect(joint.selfReported?.denominatorRespondents).toBe(20);
    expect(joint.selfReported?.floorBandLabel).toBe("Hispanic / Latino");
    expect(joint.headline).toContain("do not fit it");
  });

  it("treats a floor below the area share as inconclusive, never as under-representation", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 60 }),
      selfReported: loaded(),
    });

    expect(joint.reading).toBe("floor_below_area");
    expect(joint.rebutsAreaFlag).toBe(false);
    expect(joint.headline).toContain("cannot establish under-representation");
    expect(joint.limits.join(" ")).toContain("not a finding of under-representation");
  });

  it("reads a campaign with no self-reported demographics as area-based only, never as unrepresentative", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: { state: "not_collected" },
    });

    expect(joint.reading).toBe("ecological_only");
    expect(joint.selfReported).toBeNull();
    expect(joint.rebutsAreaFlag).toBe(false);
    expect(joint.headline).toContain("nothing here describes the people who actually responded");
    expect(joint.headline).not.toMatch(/unrepresentative/i);
  });

  it("refuses to call a campaign with no ACS baseline representative", () => {
    const joint = buildJointRepresentativeness({ ecological: null, selfReported: loaded() });

    expect(joint.reading).toBe("self_reported_only");
    expect(joint.ecological).toBeNull();
    expect(joint.rebutsAreaFlag).toBe(false);
    expect(joint.headline).toContain("does not establish that the campaign reached the community");
  });

  it("reports an unreadable demographics aggregate as unknown rather than as an absence", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: { state: "unreadable", message: "permission denied for function" },
    });

    expect(joint.reading).toBe("self_reported_unreadable");
    expect(joint.readFailureMessage).toBe("permission denied for function");
    expect(joint.selfReported).toBeNull();
    expect(joint.headline).toContain("Treat the self-reported side as unknown, not as empty");
    expect(joint.limits.join(" ")).toContain("must not be reported as an absence");
    // The ecological half still travels — one failed read does not blank the page.
    expect(joint.ecological?.areaBaselinePct).toBe(30);
  });

  it("stays silent when neither screening has anything to say", () => {
    const joint = buildJointRepresentativeness({
      ecological: null,
      selfReported: { state: "not_collected" },
    });

    expect(joint.reading).toBe("no_signal");
    expect(jointReadingIsPresentable(joint)).toBe(false);
    expect(joint.caveat).toBe(JOINT_REPRESENTATIVENESS_CAVEAT);
  });

  it("counts the largest qualifying category and never the sum, because race is multi-select", () => {
    const joint = buildJointRepresentativeness({
      ecological: null,
      selfReported: loaded(),
    });

    // hispanic 7 + black 5 = 12 would be 60% of 20 respondents; the union of two
    // multi-select bands is only guaranteed to be at least the larger one.
    expect(joint.selfReported?.floorRespondentCount).toBe(7);
    expect(joint.selfReported?.floorPct).toBe(35);
    expect(joint.selfReported?.countedBandLabels).toEqual(["Hispanic / Latino", "Black / African American"]);
    expect(joint.limits.join(" ")).toContain("only the single largest qualifying category");
  });

  it("keeps MENA, Other and Prefer-not-to-say out of the floor and discloses the exclusion", () => {
    const joint = buildJointRepresentativeness({
      ecological: null,
      selfReported: loaded([
        { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 30 },
        // MENA is the largest band, but ACS counts it inside White alone — the
        // very universe the baseline subtracts — so it must not raise the floor.
        { dimension: "race_ethnicity", band: "mena", respondent_count: 14 },
        { dimension: "race_ethnicity", band: "other", respondent_count: 9 },
        { dimension: "race_ethnicity", band: "prefer_not_to_say", respondent_count: 8 },
        { dimension: "race_ethnicity", band: "asian", respondent_count: 6 },
      ]),
    });

    expect(joint.selfReported?.floorRespondentCount).toBe(6);
    expect(joint.selfReported?.floorBandLabel).toBe("Asian");
    expect(joint.selfReported?.unmappableBandLabels).toEqual([
      "Middle Eastern / North African",
      "Other",
      "Prefer not to say",
    ]);
    expect(joint.limits.join(" ")).toContain("Middle Eastern / North African within White alone");
  });

  it("produces no floor when only unmappable categories were reported", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: loaded([
        { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 12 },
        { dimension: "race_ethnicity", band: "white", respondent_count: 7 },
        { dimension: "race_ethnicity", band: "prefer_not_to_say", respondent_count: 5 },
      ]),
    });

    expect(joint.selfReported).toBeNull();
    expect(joint.reading).toBe("ecological_only");
  });

  it("does not say nobody shared demographics when respondents shared answers with no ACS counterpart", () => {
    // 40 people answered; the demographics panel directly below this one on the
    // campaign page lists their bands. The joint headline may say the published
    // categories are not comparable — it may NOT say no one answered.
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: loaded([
        { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 40 },
        { dimension: "age_band", band: "65_plus", respondent_count: 22 },
        { dimension: "race_ethnicity", band: "white", respondent_count: 30 },
        { dimension: "race_ethnicity", band: "suppressed", respondent_count: 8 },
      ]),
    });

    expect(joint.reading).toBe("ecological_only");
    expect(joint.headline).not.toContain("No respondent has shared demographics");
    expect(joint.headline).toContain("Respondents did share demographics");
    expect(joint.headline).toContain("nothing here describes the people who actually responded");
  });

  it("names the campaign's own opt-out rather than blaming respondents for it", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: { state: "not_collected" },
    });

    expect(joint.headline).toContain("not collecting respondent demographics");
    expect(joint.headline).not.toContain("No respondent has shared demographics");
  });

  it("compares the unrounded floor, so display rounding cannot buy a rebuttal", () => {
    // 749 / 2500 = 29.96%, which renders as 30% — the same number as the area
    // baseline. Rounding is the one uncertainty that can move this figure up, so
    // it must not be what decides the comparison.
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: loaded([
        { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 2500 },
        { dimension: "race_ethnicity", band: "hispanic", respondent_count: 749 },
      ]),
    });

    expect(joint.selfReported?.floorPct).toBe(30);
    expect(joint.reading).toBe("floor_below_area");
    expect(joint.rebutsAreaFlag).toBe(false);
  });

  it("does not manufacture a pass out of a zero ACS baseline", () => {
    // A zero share is indistinguishable from an ACS fetch that returned nothing;
    // comparing a floor against it would clear every campaign for free.
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 0, status: "insufficient", ratio: null }),
      selfReported: loaded(),
    });

    expect(joint.reading).toBe("self_reported_only");
    expect(joint.rebutsAreaFlag).toBe(false);
  });

  it("refuses a floor from an aggregate whose largest band exceeds the respondent total", () => {
    const joint = buildJointRepresentativeness({
      ecological: null,
      selfReported: loaded([
        { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 5 },
        { dimension: "race_ethnicity", band: "black", respondent_count: 9 },
      ]),
    });

    expect(joint.selfReported).toBeNull();
    expect(joint.reading).toBe("no_signal");
  });

  it("adds context to the area-based screen without widening or retracting its own flag", () => {
    const cached = ecological({ baselinePct: 30 });
    const joint = buildJointRepresentativeness({ ecological: cached, selfReported: loaded() });

    expect(joint.rebutsAreaFlag).toBe(true);
    // The screening result itself is reported unchanged: a cross-check may
    // qualify a flag, never erase it.
    expect(joint.ecological?.status).toBe("under");
    expect(cached.underRepresented).toEqual(["minority"]);
  });

  it("says both signals agree without claiming the campaign was representative", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30, status: "balanced", respondentPct: 29, ratio: 0.97 }),
      selfReported: loaded(),
    });

    expect(joint.reading).toBe("floor_at_or_above_area");
    expect(joint.rebutsAreaFlag).toBe(false);
    expect(joint.headline).toContain("Both screenings point the same way");
    expect(joint.caveat).toContain("not a representativeness finding");
  });

  it("does not claim the two screenings agree when the area-based one resolved nothing", () => {
    // One tract forces every ecological status to "insufficient" — the screen
    // declined to answer, so "both point the same way" would borrow confidence
    // it never offered.
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30, status: "insufficient", ratio: null }),
      selfReported: loaded(),
    });

    expect(joint.reading).toBe("floor_at_or_above_area");
    expect(joint.rebutsAreaFlag).toBe(false);
    expect(joint.headline).toContain("could not resolve a direction");
    expect(joint.headline).not.toContain("Both screenings point the same way");
  });

  it("never carries a k-anonymized figure without its suppression caveat", () => {
    const withFloor = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: loaded(),
    });
    expect(withFloor.selfReported).not.toBeNull();
    expect(withFloor.caveat).toContain(DEMOGRAPHICS_SCREENING_CAVEAT);
    expect(withFloor.caveat).toContain(REPRESENTATIVENESS_SCREENING_CAVEAT);
    expect(withFloor.limits.join(" ")).toContain("a floor, not a share");

    // And the reverse: no self-reported figure, no self-reported caveat text
    // dangling on a result that does not carry one.
    const withoutFloor = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: { state: "not_collected" },
    });
    expect(withoutFloor.caveat).not.toContain(DEMOGRAPHICS_SCREENING_CAVEAT);
  });

  it("names the one comparable dimension and refuses to compare the others", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: loaded(),
    });

    expect(joint.dimension.key).toBe("residents_of_color");
    expect(joint.dimension.ecologicalMetricKey).toBe("minority");
    expect(joint.dimension.selfReportedDimension).toBe("race_ethnicity");
    expect(joint.dimension.rationale).toContain("Age, primary language and housing tenure have no ACS counterpart");
    expect(joint.limits[0]).toContain("Only race / ethnicity is compared");
  });

  it("discloses that the two halves count different people", () => {
    const joint = buildJointRepresentativeness({
      ecological: ecological({ baselinePct: 30 }),
      selfReported: loaded(),
    });

    expect(joint.limits.join(" ")).toContain("24 geolocated respondents");
    expect(joint.limits.join(" ")).toContain("20 respondents who chose to answer");
    expect(joint.limits.join(" ")).toContain("Neither is a sample of the other");
  });
});
