import { describe, expect, it } from "vitest";
import { buildScenarioComparisonBoard } from "@/lib/scenarios/comparison-board";

describe("buildScenarioComparisonBoard", () => {
  it("builds comparison cards for alternatives with distinct attached runs", () => {
    const cards = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry: {
        id: "baseline-entry",
        entry_type: "baseline",
        label: "Baseline",
        assumptions_json: { horizonYear: 2045, network_source: "County public network" },
        attached_run_id: "run-baseline",
        attachedRun: {
          id: "run-baseline",
          title: "Baseline run",
          metrics: {
            overallScore: 50,
            accessibilityScore: 45,
            safetyScore: 60,
            equityScore: 55,
          },
        },
      },
      alternativeEntries: [
        {
          id: "alt-entry",
          entry_type: "alternative",
          label: "Protected bike lane",
          assumptions_json: {
            horizonYear: 2045,
            projectPackage: "Protected bike network",
            internalSolverKey: "do-not-leak",
          },
          attached_run_id: "run-alt",
          attachedRun: {
            id: "run-alt",
            title: "Alt run",
            metrics: {
              overallScore: 61,
              accessibilityScore: 58,
              safetyScore: 64,
              equityScore: 59,
            },
          },
        },
        {
          id: "same-run",
          entry_type: "alternative",
          label: "Bad comparison",
          attached_run_id: "run-baseline",
          attachedRun: {
            id: "run-baseline",
            title: "Baseline reused",
            metrics: {
              overallScore: 50,
            },
          },
        },
      ],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.candidateLabel).toBe("Protected bike lane");
    expect(cards[0]?.baselineRunTitle).toBe("Baseline run");
    expect(cards[0]?.changedMetricCount).toBeGreaterThan(0);
    expect(cards[0]?.headlineMetrics[0]?.deltaLabel).toBe("+11");
    expect(cards[0]?.analysisHref).toContain("runId=run-alt");
    expect(cards[0]?.analysisHref).toContain("baselineRunId=run-baseline");
  });

  it("adds planner-readable caveat and source context without leaking raw assumption keys", () => {
    const [card] = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry: {
        id: "baseline-entry",
        entry_type: "baseline",
        label: "Existing conditions",
        assumptions_json: {
          horizonYear: 2045,
          network_source: "County public network",
          hidden_raw_key: "raw",
        },
        attached_run_id: "run-baseline",
        attachedRun: {
          id: "run-baseline",
          title: "Existing conditions run",
          metrics: {
            overallScore: 50,
            accessibilityScore: 45,
            safetyScore: 60,
            equityScore: 55,
          },
        },
      },
      alternativeEntries: [
        {
          id: "alt-entry",
          entry_type: "alternative",
          label: "Protected bike package",
          assumptions_json: {
            horizonYear: 2045,
            projectPackage: "Protected bike network",
            internalSolverKey: "do-not-leak",
          },
          attached_run_id: "run-alt",
          attachedRun: {
            id: "run-alt",
            title: "Protected bike run",
            metrics: {
              overallScore: 61,
              accessibilityScore: 58,
              safetyScore: 64,
              equityScore: 59,
            },
          },
        },
      ],
    });

    expect(card?.sourceContext.pairingLabel).toBe("Protected bike package compared against Existing conditions");
    expect(card?.sourceContext.sourceSummary).toContain("attached run scorecards");
    expect(card?.sourceContext.sourceSummary).toContain("No behavioral-onramp KPI rows are read by this board");
    expect(card?.sourceContext.baselineAssumptions).toContain("Horizon year: 2045");
    expect(card?.sourceContext.baselineAssumptions).toContain("Network source: County public network");
    expect(card?.sourceContext.alternativeAssumptions).toContain("Project package: Protected bike network");
    expect(card?.sourceContext.caveatSummary).toContain("not a validated behavioral forecast");
    expect(card?.sourceContext.exportReadiness).toContain("ready for a draft comparison packet");
    expect(card?.sourceContext.evidenceLabels).toEqual([
      "Overall Score",
      "Accessibility Score",
      "Safety Score",
      "Equity Score",
    ]);

    const renderedContext = Object.values(card?.sourceContext ?? {}).flat().join(" ");
    expect(renderedContext).not.toContain("internalSolverKey");
    expect(renderedContext).not.toContain("hidden_raw_key");
    expect(renderedContext).not.toContain("overallScore");
  });

  it("returns no cards when baseline evidence is missing", () => {
    const cards = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry: null,
      alternativeEntries: [],
    });

    expect(cards).toEqual([]);
  });
});
