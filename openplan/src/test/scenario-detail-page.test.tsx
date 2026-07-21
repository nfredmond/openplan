import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();

const scenarioSetMaybeSingleMock = vi.fn();
const scenarioSetEqMock = vi.fn(() => ({ maybeSingle: scenarioSetMaybeSingleMock }));
const scenarioSetSelectMock = vi.fn(() => ({ eq: scenarioSetEqMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const entriesOrderCreatedMock = vi.fn();
const entriesOrderSortMock = vi.fn(() => ({ order: entriesOrderCreatedMock }));
const entriesEqMock = vi.fn(() => ({ order: entriesOrderSortMock }));
const entriesSelectMock = vi.fn(() => ({ eq: entriesEqMock }));

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsInMock = vi.fn();
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock, in: runsInMock }));

const modelsOrderMock = vi.fn();
const modelsEqScenarioSetMock = vi.fn(() => ({ order: modelsOrderMock }));
const modelsEqWorkspaceMock = vi.fn(() => ({ eq: modelsEqScenarioSetMock }));
const modelsSelectMock = vi.fn(() => ({ eq: modelsEqWorkspaceMock }));

const reportsOrderMock = vi.fn();
const reportsEqProjectMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqProjectMock }));

const reportRunsInMock = vi.fn();
const reportRunsSelectMock = vi.fn(() => ({ in: reportRunsInMock }));

const reportArtifactsInMock = vi.fn();
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const comparisonSnapshotsOrderMock = vi.fn();
const comparisonSnapshotsEqMock = vi.fn(() => ({ order: comparisonSnapshotsOrderMock }));
const comparisonSnapshotsSelectMock = vi.fn(() => ({ eq: comparisonSnapshotsEqMock }));

const comparisonIndicatorDeltasInMock = vi.fn();
const comparisonIndicatorDeltasSelectMock = vi.fn(() => ({ in: comparisonIndicatorDeltasInMock }));

// model_runs lookup for the trip-gen comparison save affordance:
// .select(...).in("scenario_entry_id", ...).eq("engine_key", ...).eq("status", ...).order(...)
const modelRunsOrderMock = vi.fn();
const modelRunsEqStatusMock = vi.fn(() => ({ order: modelRunsOrderMock }));
const modelRunsEqEngineMock = vi.fn(() => ({ eq: modelRunsEqStatusMock }));
const modelRunsInMock = vi.fn(() => ({ eq: modelRunsEqEngineMock }));
const modelRunsSelectMock = vi.fn(() => ({ in: modelRunsInMock }));

const buildScenarioComparisonBoardMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "scenario_sets") {
    return { select: scenarioSetSelectMock };
  }
  if (table === "projects") {
    return { select: projectSelectMock };
  }
  if (table === "scenario_entries") {
    return { select: entriesSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "models") {
    return { select: modelsSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "report_runs") {
    return { select: reportRunsSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
  }
  if (table === "scenario_comparison_snapshots") {
    return { select: comparisonSnapshotsSelectMock };
  }
  if (table === "scenario_comparison_indicator_deltas") {
    return { select: comparisonIndicatorDeltasSelectMock };
  }
  if (table === "model_runs") {
    return { select: modelRunsSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
  // Needed by the real TripGenComparisonSaveButton client component the page renders.
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/components/scenarios/scenario-entry-composer", () => ({
  ScenarioEntryComposer: () => <div data-testid="scenario-entry-composer" />,
}));

vi.mock("@/components/scenarios/scenario-entry-registry", () => ({
  ScenarioEntryRegistry: () => <div data-testid="scenario-entry-registry" />,
}));

vi.mock("@/components/scenarios/scenario-set-controls", () => ({
  ScenarioSetControls: () => <div data-testid="scenario-set-controls" />,
}));

vi.mock("@/lib/scenarios/comparison-board", () => ({
  buildScenarioComparisonBoard: (...args: unknown[]) => buildScenarioComparisonBoardMock(...args),
}));

import ScenarioSetDetailPage from "@/app/(app)/scenarios/[scenarioSetId]/page";

async function renderPage() {
  render(
    await ScenarioSetDetailPage({
      params: Promise.resolve({ scenarioSetId: "scenario-set-1" }),
    })
  );
}

describe("ScenarioSetDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    scenarioSetMaybeSingleMock.mockResolvedValue({
      data: {
        id: "scenario-set-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "Downtown alternatives",
        summary: "Compare protected bike and signal timing options.",
        planning_question: "Which package improves safety without unacceptable delay?",
        status: "active",
        baseline_entry_id: "entry-baseline",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T21:00:00.000Z",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        updated_at: "2026-03-28T21:00:00.000Z",
      },
      error: null,
    });

    entriesOrderCreatedMock.mockResolvedValue({
      data: [
        {
          id: "entry-baseline",
          scenario_set_id: "scenario-set-1",
          entry_type: "baseline",
          label: "Existing conditions",
          slug: "existing-conditions",
          summary: null,
          assumptions_json: {},
          attached_run_id: "run-baseline",
          status: "ready",
          sort_order: 0,
          created_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T18:00:00.000Z",
        },
        {
          id: "entry-alt-1",
          scenario_set_id: "scenario-set-1",
          entry_type: "alternative",
          label: "Protected bike package",
          slug: "protected-bike-package",
          summary: null,
          assumptions_json: {},
          attached_run_id: "run-alt-1",
          status: "ready",
          sort_order: 1,
          created_at: "2026-03-28T18:05:00.000Z",
          updated_at: "2026-03-28T18:05:00.000Z",
        },
      ],
      error: null,
    });

    runsLimitMock.mockResolvedValue({
      data: [
        { id: "run-alt-1", title: "Protected bike run", created_at: "2026-03-28T18:05:00.000Z" },
        { id: "run-baseline", title: "Existing conditions run", created_at: "2026-03-28T18:00:00.000Z" },
      ],
      error: null,
    });

    runsInMock.mockResolvedValue({
      data: [
        {
          id: "run-baseline",
          title: "Existing conditions run",
          summary_text: "Baseline run summary",
          metrics: {},
          created_at: "2026-03-28T18:00:00.000Z",
        },
        {
          id: "run-alt-1",
          title: "Protected bike run",
          summary_text: "Alternative run summary",
          metrics: {},
          created_at: "2026-03-28T18:05:00.000Z",
        },
      ],
      error: null,
    });

    modelsOrderMock.mockResolvedValue({ data: [], error: null });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          title: "Protected Bike Packet",
          status: "generated",
          report_type: "analysis_summary",
          generated_at: "2026-03-28T20:00:00.000Z",
          updated_at: "2026-03-28T21:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          title: "Signal Timing Packet",
          status: "generated",
          report_type: "analysis_summary",
          generated_at: "2026-03-28T19:00:00.000Z",
          updated_at: "2026-03-28T19:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      error: null,
    });

    reportRunsInMock.mockResolvedValue({
      data: [
        { report_id: "report-1", run_id: "run-baseline" },
        { report_id: "report-1", run_id: "run-alt-1" },
        { report_id: "report-2", run_id: "run-baseline" },
        { report_id: "report-2", run_id: "run-alt-1" },
      ],
      error: null,
    });

    reportArtifactsInMock.mockResolvedValue({
      data: [
        { report_id: "report-1", generated_at: "2026-03-28T20:00:00.000Z" },
        { report_id: "report-2", generated_at: "2026-03-28T19:00:00.000Z" },
      ],
      error: null,
    });

    comparisonSnapshotsOrderMock.mockResolvedValue({ data: [], error: null });
    comparisonIndicatorDeltasInMock.mockResolvedValue({ data: [], error: null });
    // Default: no succeeded trip-gen model runs, so the save affordance stays hidden
    // and every pre-existing test keeps its exact behavior.
    modelRunsOrderMock.mockResolvedValue({ data: [], error: null });

    buildScenarioComparisonBoardMock.mockReturnValue([]);

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces packet freshness guidance for linked scenario reports", async () => {
    await renderPage();

    expect(screen.getByText(/Scenario-linked report records/i)).toBeInTheDocument();
    expect(screen.getByText(/Protected Bike Packet needs packet attention/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Next action: open this report and regenerate the packet\./i)
    ).toHaveLength(2);
    expect(screen.getByText(/Refresh recommended/i)).toBeInTheDocument();
    expect(screen.queryByText(/No generated packet is attached to this report yet\./i)).not.toBeInTheDocument();
  });

  it("keeps scenario-linked packet guidance current when the latest artifact is fresher than the report row", async () => {
    reportsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "report-1",
          title: "Protected Bike Packet",
          status: "generated",
          report_type: "analysis_summary",
          generated_at: null,
          updated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      error: null,
    });
    reportRunsInMock.mockResolvedValueOnce({
      data: [
        { report_id: "report-1", run_id: "run-baseline" },
        { report_id: "report-1", run_id: "run-alt-1" },
      ],
      error: null,
    });
    reportArtifactsInMock.mockResolvedValueOnce({
      data: [
        { report_id: "report-1", generated_at: "2026-03-28T20:30:00.000Z" },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getAllByText(/Packet current/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Refresh recommended/i)).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/run release review on the current packet/i).length
    ).toBeGreaterThan(0);
  });

  it("shows an empty linked-report state when no scenario reports are matched", async () => {
    reportsOrderMock.mockResolvedValueOnce({ data: [], error: null });
    reportRunsInMock.mockResolvedValueOnce({ data: [], error: null });
    reportArtifactsInMock.mockResolvedValueOnce({ data: [], error: null });
    comparisonSnapshotsOrderMock.mockResolvedValueOnce({ data: [], error: null });
    comparisonIndicatorDeltasInMock.mockResolvedValueOnce({ data: [], error: null });

    await renderPage();

    expect(
      screen.getByText(/No linked reports yet\./i)
    ).toBeInTheDocument();
  });

  it("displays persisted source context on saved comparison snapshot rows", async () => {
    comparisonSnapshotsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "snapshot-1",
          baseline_entry_id: "entry-baseline",
          candidate_entry_id: "entry-alt-1",
          label: "Protected bike package comparison",
          summary: "Saved comparison narrative for packet reuse.",
          status: "ready",
          updated_at: "2026-03-28T21:30:00.000Z",
          metadata_json: {
            sourceContext: {
              kind: "scenario_comparison_snapshot_source_context",
              pairingLabel: "Protected bike package compared against Existing conditions",
              pairing: {
                baselineEntryId: "entry-baseline",
                baselineEntryLabel: "Existing conditions",
                baselineRunId: "run-baseline",
                candidateEntryId: "entry-alt-1",
                candidateEntryLabel: "Protected bike package",
                candidateRunId: "run-alt-1",
              },
              sourceSummary:
                "Source context: attached run scorecards from “Protected bike run” and “Existing conditions run”. No behavioral-onramp KPI rows are read by this board or snapshot helper.",
              baselineAssumptions: "Baseline: Horizon year: 2045",
              alternativeAssumptions: "Alternative: Project package: Protected bike network",
              caveatSummary:
                "Caveat posture: planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.",
              caveats: [
                "Planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.",
              ],
              exportReadiness:
                "Export readiness: ready for a draft comparison packet when the report also carries these run links, assumptions, and caveats.",
              exportReady: true,
              evidenceLabels: ["Overall Score", "Safety Score"],
            },
            internalSolverKey: "do not render",
          },
        },
      ],
      error: null,
    });
    comparisonIndicatorDeltasInMock.mockResolvedValueOnce({
      data: [
        { id: "delta-1", comparison_snapshot_id: "snapshot-1" },
        { id: "delta-2", comparison_snapshot_id: "snapshot-1" },
      ],
      error: null,
    });

    await renderPage();

    expect(comparisonSnapshotsSelectMock).toHaveBeenCalledWith(
      expect.stringContaining("metadata_json")
    );
    expect(screen.getByText(/1 export-ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs source review/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Protected bike package comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/Saved source context/i)).toBeInTheDocument();
    expect(screen.getByText(/Protected bike package compared against Existing conditions/i)).toBeInTheDocument();
    expect(screen.getByText(/No behavioral-onramp KPI rows are read by this board or snapshot helper/i)).toBeInTheDocument();
    expect(screen.getByText(/not a validated behavioral forecast/i)).toBeInTheDocument();
    expect(screen.getByText(/ready for a draft comparison packet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Export-ready/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/internalSolverKey/i)).not.toBeInTheDocument();
  });

  it("flags saved comparison snapshots that are missing structured source context", async () => {
    comparisonSnapshotsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "snapshot-legacy",
          baseline_entry_id: "entry-baseline",
          candidate_entry_id: "entry-alt-1",
          label: "Legacy protected bike comparison",
          summary: "Older saved comparison without structured metadata.",
          status: "ready",
          updated_at: "2026-03-28T21:30:00.000Z",
          metadata_json: null,
        },
      ],
      error: null,
    });
    comparisonIndicatorDeltasInMock.mockResolvedValueOnce({
      data: [{ id: "delta-legacy", comparison_snapshot_id: "snapshot-legacy" }],
      error: null,
    });

    await renderPage();

    expect(screen.getByText(/Legacy protected bike comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/0 export-ready/i)).toBeInTheDocument();
    expect(screen.getByText(/1 needs source review/i)).toBeInTheDocument();
    expect(screen.getByText(/Source context review/i)).toBeInTheDocument();
    expect(screen.getByText(/Structured source context was not captured/i)).toBeInTheDocument();
    expect(screen.getByText(/may predate structured source-context metadata/i)).toBeInTheDocument();
    expect(screen.getByText(/operator verifies the run links, assumptions, caveats, and report packet linkage/i)).toBeInTheDocument();
    expect(screen.getByText(/No raw behavioral-onramp KPI rows are read or inferred here/i)).toBeInTheDocument();
    expect(screen.getByText(/Current pairing: Protected bike package vs Existing conditions\./i)).toBeInTheDocument();
    expect(screen.getByText(/Review before export/i)).toBeInTheDocument();
    expect(screen.queryByText(/Saved source context/i)).not.toBeInTheDocument();
  });

  it("keeps export-ready and legacy comparison snapshots visually separated", async () => {
    comparisonSnapshotsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "snapshot-export-ready",
          baseline_entry_id: "entry-baseline",
          candidate_entry_id: "entry-alt-1",
          label: "Export-ready protected bike comparison",
          summary: "Current saved comparison with planner-readable source context.",
          status: "ready",
          updated_at: "2026-03-28T22:00:00.000Z",
          metadata_json: {
            sourceContext: {
              kind: "scenario_comparison_snapshot_source_context",
              pairingLabel: "Protected bike package compared against Existing conditions",
              pairing: {
                baselineEntryId: "entry-baseline",
                baselineEntryLabel: "Existing conditions",
                baselineRunId: "run-baseline",
                candidateEntryId: "entry-alt-1",
                candidateEntryLabel: "Protected bike package",
                candidateRunId: "run-alt-1",
              },
              sourceSummary:
                "Source context: attached run scorecards from “Protected bike run” and “Existing conditions run”. No behavioral-onramp KPI rows are read by this board or snapshot helper.",
              baselineAssumptions: "Baseline: Horizon year: 2045",
              alternativeAssumptions: "Alternative: Project package: Protected bike network",
              caveatSummary:
                "Caveat posture: planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.",
              caveats: [
                "Planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.",
              ],
              exportReadiness:
                "Export readiness: ready for a draft comparison packet when the report also carries these run links, assumptions, and caveats.",
              exportReady: true,
              evidenceLabels: ["Overall Score"],
            },
            rawBehavioralOnrampKpiReader: "must not render",
          },
        },
        {
          id: "snapshot-old",
          baseline_entry_id: "entry-baseline",
          candidate_entry_id: "entry-alt-1",
          label: "Old protected bike comparison",
          summary: "Legacy saved comparison without source-context metadata.",
          status: "ready",
          updated_at: "2026-03-28T21:30:00.000Z",
          metadata_json: null,
        },
      ],
      error: null,
    });
    comparisonIndicatorDeltasInMock.mockResolvedValueOnce({
      data: [
        { id: "delta-ready", comparison_snapshot_id: "snapshot-export-ready" },
        { id: "delta-old", comparison_snapshot_id: "snapshot-old" },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getByText(/1 export-ready/i)).toBeInTheDocument();
    expect(screen.getByText(/1 needs source review/i)).toBeInTheDocument();
    expect(screen.getByText(/Export-ready protected bike comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/Old protected bike comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/Saved source context/i)).toBeInTheDocument();
    expect(screen.getByText(/Structured source context was not captured/i)).toBeInTheDocument();
    expect(screen.getByText(/ready for a draft comparison packet/i)).toBeInTheDocument();
    expect(screen.getByText(/No raw behavioral-onramp KPI rows are read or inferred here/i)).toBeInTheDocument();
    expect(screen.queryByText(/rawBehavioralOnrampKpiReader/i)).not.toBeInTheDocument();
  });

  it("renders caveat and source-context guidance on comparison cards", async () => {
    buildScenarioComparisonBoardMock.mockReturnValueOnce([
      {
        entryId: "entry-alt-1",
        candidateLabel: "Protected bike package",
        candidateRunId: "run-alt-1",
        candidateRunTitle: "Protected bike run",
        baselineLabel: "Existing conditions",
        baselineRunId: "run-baseline",
        baselineRunTitle: "Existing conditions run",
        changedMetricCount: 4,
        analysisHref: "/explore?runId=run-alt-1&baselineRunId=run-baseline",
        headlineMetrics: [
          {
            key: "overallScore",
            label: "Overall Score",
            current: 61,
            baseline: 50,
            delta: 11,
            deltaLabel: "+11",
            tone: "success",
          },
        ],
        sourceContext: {
          pairingLabel: "Protected bike package compared against Existing conditions",
          sourceSummary:
            "Source context: attached run scorecards from “Protected bike run” and “Existing conditions run”. No behavioral-onramp KPI rows are read by this board.",
          baselineAssumptions: "Baseline: Horizon year: 2045",
          alternativeAssumptions: "Alternative: Project package: Protected bike network",
          caveatSummary:
            "Caveat posture: planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.",
          exportReadiness:
            "Export readiness: ready for a draft comparison packet when the report also carries these run links, assumptions, and caveats.",
          evidenceLabels: ["Overall Score"],
        },
      },
    ]);

    await renderPage();

    expect(screen.getByText(/Caveat and source context/i)).toBeInTheDocument();
    expect(screen.getByText(/Protected bike package compared against Existing conditions/i)).toBeInTheDocument();
    expect(screen.getByText(/No behavioral-onramp KPI rows are read by this board/i)).toBeInTheDocument();
    expect(screen.getByText(/not a validated behavioral forecast/i)).toBeInTheDocument();
    expect(screen.getByText(/ready for a draft comparison packet/i)).toBeInTheDocument();
    expect(screen.queryByText(/overallScore/)).not.toBeInTheDocument();
  });

  it("renders the trip-gen comparison save affordance only when baseline and an alternative both have succeeded runs", async () => {
    modelRunsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "model-run-alt-1",
          model_id: "model-1",
          scenario_entry_id: "entry-alt-1",
          status: "succeeded",
          engine_key: "ite_trip_generation",
        },
        {
          id: "model-run-baseline",
          model_id: "model-1",
          scenario_entry_id: "entry-baseline",
          status: "succeeded",
          engine_key: "ite_trip_generation",
        },
      ],
      error: null,
    });

    await renderPage();

    expect(fromMock).toHaveBeenCalledWith("model_runs");
    expect(modelRunsInMock).toHaveBeenCalledWith("scenario_entry_id", ["entry-baseline", "entry-alt-1"]);
    expect(modelRunsEqEngineMock).toHaveBeenCalledWith("engine_key", "ite_trip_generation");
    expect(modelRunsEqStatusMock).toHaveBeenCalledWith("status", "succeeded");
    expect(screen.getByText(/Trip-generation comparison ready/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Existing conditions and Protected bike package both have a completed screening/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save trip-gen comparison/i })).toBeInTheDocument();

    cleanup();

    // Existing-shape case: a succeeded run on only one entry must NOT light the affordance.
    modelRunsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "model-run-baseline",
          model_id: "model-1",
          scenario_entry_id: "entry-baseline",
          status: "succeeded",
          engine_key: "ite_trip_generation",
        },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.queryByText(/Trip-generation comparison ready/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save trip-gen comparison/i })).not.toBeInTheDocument();
  });
});
