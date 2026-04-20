import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Run } from "@/components/runs/RunHistory";
import type { MapViewState } from "@/lib/analysis/map-view-state";
import { ExploreResultsBoard } from "@/app/(app)/explore/_components/explore-results-board";
import type { AnalysisResult } from "@/app/(app)/explore/_components/_types";

const currentMapViewState: MapViewState = {
  tractMetric: "minority",
  showTracts: true,
  showCrashes: true,
  crashSeverityFilter: "fatal",
  crashUserFilter: "pedestrian",
  activeDatasetOverlayId: "dataset-1",
  activeOverlayContext: {
    datasetId: "dataset-1",
    datasetName: "Equity overlay",
    overlayMode: "thematic_overlay",
    geometryAttachment: "tract",
    thematicMetricKey: "pctBelowPoverty",
    thematicMetricLabel: "Poverty share",
    connectorLabel: "Local upload",
  },
};

const resultGeojson: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function buildAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    runId: "run-current",
    title: "Downtown access check",
    createdAt: "2026-04-20T09:00:00.000Z",
    summary: "Downtown access improves under the active corridor package.",
    aiInterpretation: "Treat the score as a planning screen, then verify locally.",
    aiInterpretationSource: "ai",
    geojson: resultGeojson,
    metrics: {
      overallScore: 75,
      accessibilityScore: 78,
      safetyScore: 72,
      equityScore: 74,
      confidence: "high",
      transitAccessTier: "strong",
      totalTransitStops: 18,
      totalFatalCrashes: 1,
      pctZeroVehicle: 12,
      totalPopulation: 12345,
      medianIncome: 68000,
      pctTransit: 9,
      stopsPerSquareMile: 6.2,
      crashesPerSquareMile: 1.4,
      dataQuality: {
        censusAvailable: true,
        crashDataAvailable: true,
        lodesSource: "lodes-api",
        equitySource: "cejst-proxy-census",
        aiInterpretationSource: "ai",
      },
      sourceSnapshots: {
        census: {
          dataset: "ACS",
          vintage: "2022",
          geography: "tract",
          tractCount: 3,
          retrievalUrl: "https://api.census.gov/example",
          fetchedAt: "2026-04-20T08:00:00.000Z",
        },
        transit: { source: "osm-overpass", note: "OpenStreetMap stop proxy." },
        crashes: { source: "switrs-local", note: "SWITRS local extract." },
        lodes: { source: "lodes-api", note: "LODES API extract." },
        equity: { source: "cejst-proxy-census", note: "Proxy equity screen." },
      },
      mapViewState: currentMapViewState,
    },
    ...overrides,
  };
}

function buildComparisonRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-baseline",
    title: "Baseline package",
    query_text: "Baseline access check",
    created_at: "2026-04-19T09:00:00.000Z",
    summary_text: "Baseline summary",
    ai_interpretation: null,
    result_geojson: resultGeojson,
    metrics: {
      overallScore: 67,
      accessibilityScore: 70,
      safetyScore: 70,
      equityScore: 70,
      totalTransitStops: 12,
      totalFatalCrashes: 2,
      pctZeroVehicle: 15,
      mapViewState: {
        ...currentMapViewState,
        showCrashes: false,
        activeDatasetOverlayId: null,
        activeOverlayContext: null,
      },
      dataQuality: {
        aiInterpretationSource: "fallback",
      },
    },
    ...overrides,
  };
}

describe("ExploreResultsBoard", () => {
  it("renders the empty board when no analysis is selected", () => {
    render(
      <ExploreResultsBoard
        analysisResult={null}
        comparisonRun={null}
        queryText=""
        currentMapViewState={currentMapViewState}
        onClearComparison={vi.fn()}
        onError={vi.fn()}
      />
    );

    expect(screen.getByText("No analysis selected")).toBeInTheDocument();
    expect(screen.getByText("Run a corridor analysis or load a prior run to review metrics, narrative output, and comparisons.")).toBeInTheDocument();
  });

  it("renders current result scores, exports, sources, and disclosure surfaces", () => {
    render(
      <ExploreResultsBoard
        analysisResult={buildAnalysisResult()}
        comparisonRun={null}
        queryText="Downtown access check"
        currentMapViewState={currentMapViewState}
        onClearComparison={vi.fn()}
        onError={vi.fn()}
      />
    );

    expect(screen.getByText("Current Result")).toBeInTheDocument();
    expect(screen.getByText("Downtown access check")).toBeInTheDocument();
    expect(screen.getByText("Export Metrics CSV")).toBeInTheDocument();
    expect(screen.getByText("Export Result GeoJSON")).toBeInTheDocument();
    expect(screen.getByText("Geospatial Intelligence Briefing")).toBeInTheDocument();
    expect(screen.getByText("Methods, Assumptions & AI Disclosure")).toBeInTheDocument();
    expect(screen.getByText("Census / ACS 5-Year")).toBeInTheDocument();
    expect(screen.getByText("Source checks look good")).toBeInTheDocument();
  });

  it("renders comparison context and clears the pinned baseline", () => {
    const onClearComparison = vi.fn();

    render(
      <ExploreResultsBoard
        analysisResult={buildAnalysisResult()}
        comparisonRun={buildComparisonRun()}
        queryText="Downtown access check"
        currentMapViewState={currentMapViewState}
        onClearComparison={onClearComparison}
        onError={vi.fn()}
      />
    );

    expect(screen.getByText("Run comparison")).toBeInTheDocument();
    expect(screen.getAllByText("Baseline package").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pinned baseline").length).toBeGreaterThan(0);
    expect(screen.getByText("Metric movement is present, but the evidence frame changed.")).toBeInTheDocument();
    expect(screen.getAllByText("Different").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Clear baseline" })[0]);
    expect(onClearComparison).toHaveBeenCalledTimes(1);
  });
});
