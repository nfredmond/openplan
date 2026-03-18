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

  it("returns no cards when baseline evidence is missing", () => {
    const cards = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry: null,
      alternativeEntries: [],
    });

    expect(cards).toEqual([]);
  });
});
