import { describe, expect, it } from "vitest";
import { buildScenarioComparisonBoard, modelRunComparisonMetrics } from "@/lib/scenarios/comparison-board";
import {
  OSM_STOP_INVENTORY_METHOD,
  gtfsServiceLevelMethod,
} from "@/lib/data-sources/transit/method";

/**
 * THE TRANSIT PROVENANCE EVERY REAL RUN CARRIES.
 *
 * `/api/analysis` writes `sourceSnapshots.transit` on every run it stores, and
 * `buildMetricDeltas` refuses to subtract the transit-sensitive metrics of two
 * runs that were not measured the same way. A fixture without it describes a run
 * from before that record existed — which is a real case, and the wrong default
 * for a test about ordinary comparison.
 */
const osmTransit = () => ({ source: "osm-overpass", observed: true, method: OSM_STOP_INVENTORY_METHOD });
const gtfsTransit = () => ({ source: "gtfs-feed", observed: true, method: gtfsServiceLevelMethod(true) });

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
            sourceSnapshots: { transit: osmTransit() },
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
              sourceSnapshots: { transit: osmTransit() },
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
            sourceSnapshots: { transit: osmTransit() },
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
              sourceSnapshots: { transit: osmTransit() },
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
          metrics: { overallScore: 50, accessibilityScore: 45, sourceSnapshots: { transit: osmTransit() } },
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
            // A model run stamped by `buildModelRunResultSummary` carries the
            // transit provenance of the analysis run behind it. Without it the
            // board refused every mixed pairing and permitted every model-to-model
            // one — the refusal inverted in both directions at once.
            result_summary_json: {
              overallScore: 63,
              accessibilityScore: 52,
              runId: "abc",
              sourceSnapshots: { transit: osmTransit() },
            },
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

  /* ------------------------------------------------------------------------ */
  /* The comparability refusal, and which way round it points                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Build a one-card board from two pieces of evidence, so these assertions run
   * through the REAL `buildScenarioComparisonBoard` rather than through
   * `buildMetricDeltas` directly. The defect lived in the board's own adapter —
   * `modelRunComparisonMetrics` dropped the provenance — so a test that drove the
   * delta builder would have proved nothing about it.
   */
  function boardFor(
    baselineMetrics: Record<string, unknown>,
    candidate: { modelRunSummary?: Record<string, unknown>; runMetrics?: Record<string, unknown> },
    baseline: { asModelRun?: boolean } = {}
  ) {
    const [card] = buildScenarioComparisonBoard({
      scenarioSetId: "11111111-1111-1111-1111-111111111111",
      baselineEntry: {
        id: "baseline-entry",
        entry_type: "baseline",
        label: "Baseline",
        ...(baseline.asModelRun
          ? {
              attached_run_id: null,
              attachedRun: null,
              attached_model_run_id: "model-baseline",
              attachedModelRun: {
                id: "model-baseline",
                run_title: "Baseline model run",
                engine_key: "deterministic_corridor_v1",
                status: "succeeded",
                result_summary_json: baselineMetrics,
              },
            }
          : {
              attached_run_id: "run-baseline",
              attachedRun: { id: "run-baseline", title: "Baseline run", metrics: baselineMetrics },
            }),
      },
      alternativeEntries: [
        {
          id: "alt-entry",
          entry_type: "alternative",
          label: "Alternative",
          ...(candidate.modelRunSummary
            ? {
                attached_run_id: null,
                attachedRun: null,
                attached_model_run_id: "model-alt",
                attachedModelRun: {
                  id: "model-alt",
                  run_title: "Alt model run",
                  engine_key: "deterministic_corridor_v1",
                  status: "succeeded",
                  result_summary_json: candidate.modelRunSummary,
                },
              }
            : {
                attached_run_id: "run-alt",
                attachedRun: { id: "run-alt", title: "Alt run", metrics: candidate.runMetrics! },
              }),
        },
      ],
    });

    return card!;
  }

  const accessibility = (card: { headlineMetrics: Array<{ key: string }> }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (card.headlineMetrics as any[]).find((metric) => metric.key === "accessibilityScore");

  it("PERMITS a model run against an analysis run measured the same way", () => {
    // THE POLARITY, HALF ONE. Every mixed pairing used to be refused, because a
    // model run's summary carried no transit provenance at all and so resolved to
    // "not recorded" whatever the analysis run behind it had actually used.
    const card = boardFor(
      { overallScore: 50, accessibilityScore: 45, sourceSnapshots: { transit: gtfsTransit() } },
      {
        modelRunSummary: {
          overallScore: 61,
          accessibilityScore: 58,
          sourceSnapshots: { transit: gtfsTransit() },
        },
      }
    );

    expect(card.evidenceSource).toBe("model_run");
    const metric = accessibility(card);
    expect(metric.incomparable).toBe(false);
    expect(metric.incomparableReason).toBeNull();
    expect(metric.deltaLabel).toBe("+13");
  });

  it("REFUSES two model runs whose transit was measured differently", () => {
    // THE POLARITY, HALF TWO — the pairing that actually misleads. Both sides
    // used to be equally silent, so their comparability keys matched and the
    // board printed a delta that describes the measurement.
    const card = boardFor(
      { overallScore: 50, accessibilityScore: 45, sourceSnapshots: { transit: osmTransit() } },
      {
        modelRunSummary: {
          overallScore: 61,
          accessibilityScore: 58,
          sourceSnapshots: { transit: gtfsTransit() },
        },
      },
      { asModelRun: true }
    );

    expect(card.evidenceSource).toBe("model_run");
    expect(card.baselineEvidenceSource).toBe("model_run");

    const metric = accessibility(card);
    expect(metric.incomparable).toBe(true);
    expect(metric.deltaLabel).toBe("Not comparable");
    expect(metric.delta).toBeNull();
    // Both values survive: it is the SUBTRACTION that is refused, not the evidence.
    expect(metric.current).toBe(58);
    expect(metric.baseline).toBe(45);
  });

  it("REFUSES a run that never recorded how transit was measured, including against another silent run", () => {
    // Matching keys are evidence of a matching measurement only when both runs
    // stated one. Two `not-recorded` methods produce the same key, which is how a
    // pair of provenance-less runs subtracted cleanly.
    const card = boardFor(
      { overallScore: 50, accessibilityScore: 45 },
      { runMetrics: { overallScore: 61, accessibilityScore: 58 } }
    );

    const metric = accessibility(card);
    expect(metric.incomparable).toBe(true);
    expect(metric.incomparableReason).toMatch(/did not record how transit was measured/i);
  });

  it("carries the REASON onto the card, not just a bare badge", () => {
    // A refusal a planner cannot act on reads as a defect in OpenPlan, and the
    // first thing anyone does with an unexplained refusal is work around it. The
    // board dropped this field entirely: the delta builder produced the sentence
    // and no surface had anywhere to put it.
    const card = boardFor(
      { overallScore: 50, accessibilityScore: 45, sourceSnapshots: { transit: osmTransit() } },
      {
        runMetrics: {
          overallScore: 61,
          accessibilityScore: 58,
          sourceSnapshots: { transit: gtfsTransit() },
        },
      }
    );

    const metric = accessibility(card);
    expect(metric.deltaLabel).toBe("Not comparable");
    expect(metric.incomparableReason).toMatch(/change in how transit was measured/i);
    expect(metric.incomparableReason).toMatch(/openstreetmap stop inventory/i);

    // And a comparable metric carries no reason, so the sentence cannot become
    // decoration that appears on every tile.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safety = (card.headlineMetrics as any[]).find((entry) => entry.key === "safetyScore");
    expect(safety.incomparable).toBe(false);
    expect(safety.incomparableReason).toBeNull();
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
