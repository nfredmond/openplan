import { describe, expect, it } from "vitest";
import { buildScenarioComparisonBoard, modelRunComparisonMetrics } from "@/lib/scenarios/comparison-board";

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
    // Legacy-only entries stay attributed to Analysis Studio runs.
    expect(cards[0]?.evidenceSource).toBe("analysis_run");
    expect(cards[0]?.baselineEvidenceSource).toBe("analysis_run");
    expect(cards[0]?.candidateModelRun).toBeNull();
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

  it("resolves a model-run-backed alternative with evidenceSource model_run and screening framing", () => {
    const [card] = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry: {
        id: "baseline-entry",
        entry_type: "baseline",
        label: "Baseline",
        assumptions_json: { horizonYear: 2045 },
        attached_run_id: "run-baseline",
        attachedRun: {
          id: "run-baseline",
          title: "Baseline run",
          metrics: { overallScore: 50, accessibilityScore: 45 },
        },
      },
      alternativeEntries: [
        {
          id: "alt-entry",
          entry_type: "alternative",
          label: "Screening alternative",
          assumptions_json: {},
          attached_run_id: null,
          attachedRun: null,
          attached_model_run_id: "model-run-1",
          attachedModelRun: {
            id: "model-run-1",
            run_title: "Fast screening run",
            engine_key: "aequilibrae",
            status: "succeeded",
            result_summary_json: { overallScore: 63, accessibilityScore: 52, runId: "abc" },
          },
        },
      ],
    });

    expect(card?.evidenceSource).toBe("model_run");
    expect(card?.baselineEvidenceSource).toBe("analysis_run");
    expect(card?.candidateRunId).toBe("model-run-1");
    expect(card?.candidateRunTitle).toBe("Fast screening run");
    expect(card?.candidateModelRun).toEqual({ engineKey: "aequilibrae", status: "succeeded" });
    expect(card?.headlineMetrics[0]?.deltaLabel).toBe("+13");
    // The run-mode caveat rides along verbatim — no new claim language.
    expect(card?.sourceContext.caveatSummary).toContain("Screening-grade prototype output");
    expect(card?.sourceContext.caveatSummary).toContain("not a validated behavioral forecast");
  });

  it("prefers the model run over a legacy run, but falls back when its summary has no comparable metrics", () => {
    const baselineEntry = {
      id: "baseline-entry",
      entry_type: "baseline",
      label: "Baseline",
      attached_run_id: "run-baseline",
      attachedRun: {
        id: "run-baseline",
        title: "Baseline run",
        metrics: { overallScore: 50 },
      },
    };

    const [preferredCard] = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry,
      alternativeEntries: [
        {
          id: "alt-both",
          entry_type: "alternative",
          label: "Both attachments resolved",
          attached_run_id: "run-alt",
          attachedRun: { id: "run-alt", title: "Legacy alt run", metrics: { overallScore: 58 } },
          attached_model_run_id: "model-run-1",
          attachedModelRun: {
            id: "model-run-1",
            run_title: "Model alt run",
            engine_key: "deterministic_corridor_v1",
            status: "succeeded",
            result_summary_json: { overallScore: 61 },
          },
        },
      ],
    });

    expect(preferredCard?.evidenceSource).toBe("model_run");
    expect(preferredCard?.candidateRunTitle).toBe("Model alt run");

    const [fallbackCard] = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry,
      alternativeEntries: [
        {
          id: "alt-fallback",
          entry_type: "alternative",
          label: "Model run without comparable KPIs",
          attached_run_id: "run-alt",
          attachedRun: { id: "run-alt", title: "Legacy alt run", metrics: { overallScore: 58 } },
          attached_model_run_id: "model-run-2",
          attachedModelRun: {
            id: "model-run-2",
            run_title: "Sketch run",
            engine_key: "sketch_abm",
            status: "succeeded",
            result_summary_json: { total_trips: 1200, zone_count: 12 },
          },
        },
      ],
    });

    expect(fallbackCard?.evidenceSource).toBe("analysis_run");
    expect(fallbackCard?.candidateRunTitle).toBe("Legacy alt run");
  });

  describe("modelRunComparisonMetrics", () => {
    it("maps managed scorecard keys onto the board metric shape", () => {
      expect(
        modelRunComparisonMetrics({
          runId: "abc",
          overallScore: 61,
          accessibilityScore: 58,
          safetyScore: null,
          confidence: "medium",
        })
      ).toEqual({ overallScore: 61, accessibilityScore: 58 });
    });

    it("returns null when there is nothing comparable", () => {
      expect(modelRunComparisonMetrics(null)).toBeNull();
      expect(modelRunComparisonMetrics(undefined)).toBeNull();
      expect(modelRunComparisonMetrics({})).toBeNull();
      // Engine-specific KPI namespaces never fake comparison readiness.
      expect(modelRunComparisonMetrics({ total_trips: 1200, daily_vmt_screen: 40000 })).toBeNull();
      expect(modelRunComparisonMetrics({ overallScore: Number.NaN })).toBeNull();
    });
  });
});
