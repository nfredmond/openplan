import { describe, expect, it } from "vitest";
import { buildProjectFundingStackSummary, projectFundingStackTone } from "@/lib/projects/funding";

describe("project funding stack summary", () => {
  it("marks a project funded when awards meet the target need", () => {
    const summary = buildProjectFundingStackSummary(
      { funding_need_amount: 2_000_000, local_match_need_amount: 250_000 },
      [
        { awarded_amount: 1_500_000, match_amount: 150_000, risk_flag: "none" },
        { awarded_amount: 500_000, match_amount: 100_000, risk_flag: "watch" },
      ]
    );

    expect(summary).toMatchObject({
      status: "funded",
      pipelineStatus: "funded",
      committedFundingAmount: 2_000_000,
      remainingFundingGap: 0,
      committedMatchAmount: 250_000,
      remainingMatchGap: 0,
      awardRiskCount: 1,
    });
    expect(projectFundingStackTone(summary.status)).toBe("success");
  });

  it("marks a project partially funded when a gap remains", () => {
    const summary = buildProjectFundingStackSummary(
      { funding_need_amount: 2_000_000 },
      [{ awarded_amount: 500_000, match_amount: 0, risk_flag: "none" }]
    );

    expect(summary).toMatchObject({
      status: "partially_funded",
      pipelineStatus: "partially_covered",
      remainingFundingGap: 1_500_000,
    });
    expect(projectFundingStackTone(summary.status)).toBe("warning");
  });

  it("marks a project unfunded when it has a target need and no awards", () => {
    const summary = buildProjectFundingStackSummary({ funding_need_amount: 800_000 }, []);

    expect(summary).toMatchObject({
      status: "unfunded",
      pipelineStatus: "unfunded",
      committedFundingAmount: 0,
      remainingFundingGap: 800_000,
    });
    expect(projectFundingStackTone(summary.status)).toBe("danger");
  });

  it("marks a project likely covered when pursued opportunities close the remaining gap", () => {
    const summary = buildProjectFundingStackSummary(
      { funding_need_amount: 1_000_000 },
      [{ awarded_amount: 250_000, match_amount: 0, risk_flag: "none" }],
      [
        { decision_state: "pursue", opportunity_status: "open", expected_award_amount: 600_000 },
        { decision_state: "monitor", opportunity_status: "upcoming", expected_award_amount: 300_000 },
        { decision_state: "pursue", opportunity_status: "upcoming", expected_award_amount: 200_000 },
      ]
    );

    expect(summary).toMatchObject({
      status: "partially_funded",
      likelyFundingAmount: 800_000,
      totalPotentialFundingAmount: 1_050_000,
      unfundedAfterLikelyAmount: 0,
      pipelineStatus: "likely_covered",
      pursuedOpportunityCount: 2,
    });
    expect(projectFundingStackTone(summary.pipelineStatus)).toBe("info");
  });
});
