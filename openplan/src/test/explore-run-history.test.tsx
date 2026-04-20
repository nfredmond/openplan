import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Run } from "@/components/runs/RunHistory";
import { ExploreRunHistoryPanel } from "@/app/(app)/explore/_components/explore-run-history-panel";
import { useExploreRunHistory } from "@/app/(app)/explore/_components/use-explore-run-history";
import type { AnalysisResult, CorridorGeometry } from "@/app/(app)/explore/_components/_types";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

const runHistoryRenderMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/explore",
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.searchParams,
}));

vi.mock("@/components/runs/RunHistory", () => ({
  RunHistory: (props: Record<string, unknown>) => {
    runHistoryRenderMock(props);

    return <div data-testid="run-history">{String(props.currentRunTitle ?? "")}</div>;
  },
}));

const resultGeojson: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const corridorGeojson: CorridorGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-121.1, 39.1],
      [-121.0, 39.1],
      [-121.0, 39.2],
      [-121.1, 39.2],
      [-121.1, 39.1],
    ],
  ],
};

function buildAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    runId: "run-current",
    title: "Current access check",
    createdAt: "2026-04-20T10:00:00.000Z",
    summary: "Current summary",
    aiInterpretation: "Current interpretation",
    aiInterpretationSource: "ai",
    geojson: resultGeojson,
    metrics: {
      accessibilityScore: 80,
      safetyScore: 70,
      equityScore: 75,
      overallScore: 76,
      dataQuality: {
        aiInterpretationSource: "ai",
      },
    },
    ...overrides,
  };
}

function buildRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-baseline",
    title: "Baseline access check",
    query_text: "Baseline query",
    created_at: "2026-04-19T10:00:00.000Z",
    corridor_geojson: corridorGeojson,
    summary_text: "Baseline summary",
    ai_interpretation: null,
    result_geojson: resultGeojson,
    metrics: {
      accessibilityScore: 70,
      safetyScore: 68,
      equityScore: 72,
      overallScore: 70,
      mapViewState: {
        tractMetric: "poverty",
        showTracts: true,
        showCrashes: false,
        crashSeverityFilter: "fatal",
        crashUserFilter: "pedestrian",
        activeDatasetOverlayId: null,
      },
      dataQuality: {
        aiInterpretationSource: "fallback",
      },
    },
    ...overrides,
  };
}

function buildHookProps(overrides: Partial<Parameters<typeof useExploreRunHistory>[0]> = {}) {
  return {
    workspaceId: "workspace-1",
    analysisResult: buildAnalysisResult(),
    setAnalysisResult: vi.fn(),
    setQueryText: vi.fn(),
    setCorridorGeojson: vi.fn(),
    setError: vi.fn(),
    setTractMetric: vi.fn(),
    setShowTracts: vi.fn(),
    setShowCrashes: vi.fn(),
    setCrashSeverityFilter: vi.fn(),
    setCrashUserFilter: vi.fn(),
    setActiveDatasetOverlayId: vi.fn(),
    ...overrides,
  };
}

describe("useExploreRunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.searchParams = new URLSearchParams();
  });

  it("pins a valid comparison run and syncs the run pair into the URL", async () => {
    const props = buildHookProps();
    const { result } = renderHook(() => useExploreRunHistory(props));

    await waitFor(() => expect(navigationMocks.replace).toHaveBeenCalledWith("/explore?runId=run-current", { scroll: false }));
    navigationMocks.replace.mockClear();

    act(() => result.current.compareRun(buildRun()));

    expect(result.current.comparisonRun?.id).toBe("run-baseline");
    expect(props.setError).toHaveBeenLastCalledWith("");
    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith("/explore?runId=run-current&baselineRunId=run-baseline", {
        scroll: false,
      })
    );
  });

  it("loads a pinned baseline as current and clears the baseline state", () => {
    const props = buildHookProps();
    const baselineRun = buildRun();
    const { result } = renderHook(() => useExploreRunHistory(props));

    act(() => result.current.compareRun(baselineRun));
    expect(result.current.comparisonRun?.id).toBe("run-baseline");

    act(() => result.current.loadRun(baselineRun));

    expect(result.current.comparisonRun).toBeNull();
    expect(props.setQueryText).toHaveBeenCalledWith("Baseline query");
    expect(props.setCorridorGeojson).toHaveBeenCalledWith(corridorGeojson);
    expect(props.setTractMetric).toHaveBeenCalledWith("poverty");
    expect(props.setShowCrashes).toHaveBeenCalledWith(false);
    expect(props.setCrashSeverityFilter).toHaveBeenCalledWith("fatal");
    expect(props.setCrashUserFilter).toHaveBeenCalledWith("pedestrian");
    expect(props.setActiveDatasetOverlayId).toHaveBeenCalledWith(null);
    expect(props.setAnalysisResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-baseline",
        title: "Baseline access check",
        aiInterpretationSource: "fallback",
      })
    );
  });

  it("refuses to compare without a loaded current analysis", () => {
    const props = buildHookProps({ analysisResult: null });
    const { result } = renderHook(() => useExploreRunHistory(props));

    act(() => result.current.compareRun(buildRun()));

    expect(result.current.comparisonRun).toBeNull();
    expect(props.setError).toHaveBeenCalledWith("Load or run an analysis first, then choose a comparison run.");
  });
});

describe("ExploreRunHistoryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps Explore run state into the shared RunHistory component", () => {
    const onLoadRun = vi.fn();
    const onCompareRun = vi.fn();
    const onClearComparison = vi.fn();

    render(
      <ExploreRunHistoryPanel
        workspaceId="workspace-1"
        analysisResult={buildAnalysisResult()}
        comparisonRun={buildRun()}
        queryText="Fallback query"
        onLoadRun={onLoadRun}
        onCompareRun={onCompareRun}
        onClearComparison={onClearComparison}
      />
    );

    expect(screen.getByTestId("run-history")).toHaveTextContent("Current access check");
    expect(runHistoryRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        onLoadRun,
        onCompareRun,
        onClearComparison,
        currentRunId: "run-current",
        currentRunTitle: "Current access check",
        currentRunCreatedAt: "2026-04-20T10:00:00.000Z",
        comparisonRunId: "run-baseline",
        comparisonRunTitle: "Baseline access check",
        comparisonRunCreatedAt: "2026-04-19T10:00:00.000Z",
      })
    );
  });

  it("falls back to a generated current title before a run has a saved title", () => {
    render(
      <ExploreRunHistoryPanel
        workspaceId="workspace-1"
        analysisResult={null}
        comparisonRun={null}
        queryText="which neighborhoods lack transit"
        onLoadRun={vi.fn()}
        onCompareRun={vi.fn()}
        onClearComparison={vi.fn()}
      />
    );

    expect(runHistoryRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRunTitle: "which neighborhoods lack transit",
        currentRunId: undefined,
        comparisonRunId: undefined,
      })
    );
  });
});
