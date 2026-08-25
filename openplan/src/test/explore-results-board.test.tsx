import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Run } from "@/components/runs/RunHistory";
import type { MapViewState } from "@/lib/analysis/map-view-state";
import { ExploreResultsBoard } from "@/app/(app)/explore/_components/explore-results-board";
import type { AnalysisResult } from "@/app/(app)/explore/_components/_types";

const downloadMocks = vi.hoisted(() => ({
  downloadGeojson: vi.fn(),
  downloadMetricsCsv: vi.fn(),
  downloadRecordsCsv: vi.fn(),
  downloadText: vi.fn(),
}));

vi.mock("@/lib/export/download", () => downloadMocks);

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
        transitDataAvailable: true,
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
        crashes: { source: "ccrs-ca", label: "CCRS (California)", note: "Observed CCRS crash records." },
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
      // The baseline records the SAME transit measurement as the current run, so
      // the two are subtractable. Without this the pair is incomparable and every
      // headline delta below would be null — which is the correct behaviour and
      // is asserted on its own further down, not accidentally here.
      sourceSnapshots: {
        transit: { source: "osm-overpass", observed: true, note: "OpenStreetMap stop proxy." },
      },
      mapViewState: {
        ...currentMapViewState,
        showCrashes: false,
        activeDatasetOverlayId: null,
        activeOverlayContext: null,
      },
      dataQuality: {
        censusAvailable: true,
        crashDataAvailable: true,
        transitDataAvailable: true,
        aiInterpretationSource: "fallback",
      },
    },
    ...overrides,
  };
}

describe("ExploreResultsBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("does not surface estimated indicators when all sources are measured", () => {
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

    expect(screen.queryByText("Estimated")).not.toBeInTheDocument();
  });

  it("labels headline metrics as Estimated when fallback sources backed the run", () => {
    const estimatedResult = buildAnalysisResult();
    estimatedResult.metrics.dataQuality = {
      censusAvailable: true,
      crashDataAvailable: false,
      lodesSource: "acs-estimate",
      equitySource: "cejst-proxy-census",
      aiInterpretationSource: "ai",
    };
    estimatedResult.metrics.sourceSnapshots = {
      ...estimatedResult.metrics.sourceSnapshots,
      crashes: { source: "fars-estimate", note: "Fallback estimate." },
      transit: { source: "estimate", note: "Fallback estimate." },
      lodes: { source: "acs-estimate", note: "ACS estimation." },
    };

    render(
      <ExploreResultsBoard
        analysisResult={estimatedResult}
        comparisonRun={null}
        queryText="Downtown access check"
        currentMapViewState={currentMapViewState}
        onClearComparison={vi.fn()}
        onError={vi.fn()}
      />
    );

    // Safety + Accessibility score tiles, plus "Stops / sq mi" and "Crash intensity" planning signals.
    expect(screen.getAllByText("Estimated").length).toBeGreaterThanOrEqual(4);
    expect(
      screen.getByText("Includes estimated inputs (transit stops, employment) — source data unavailable or not yet ingested.")
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Crash source API unavailable — area-based estimate\./).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Transit stop inventory unavailable — area-based estimate\./).length).toBeGreaterThanOrEqual(1);
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

  it("exports comparison artifacts with metric deltas and map-context rows", () => {
    render(
      <ExploreResultsBoard
        analysisResult={buildAnalysisResult()}
        comparisonRun={buildComparisonRun()}
        queryText="Downtown access check"
        currentMapViewState={currentMapViewState}
        onClearComparison={vi.fn()}
        onError={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Export Comparison CSV" }));

    expect(downloadMocks.downloadRecordsCsv).toHaveBeenCalledTimes(1);
    expect(downloadMocks.downloadRecordsCsv).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          rowType: "metric_delta",
          key: "overallScore",
          current: 75,
          baseline: 67,
          delta: 8,
        }),
        expect.objectContaining({
          rowType: "map_view",
          label: "Project overlay",
          current: "Equity overlay \u00b7 Poverty share",
          baseline: "None",
          changed: true,
        }),
      ]),
      "openplan-run-current-vs-run-baseline-comparison.csv"
    );

    fireEvent.click(screen.getByRole("button", { name: "Export Comparison JSON" }));

    expect(downloadMocks.downloadText).toHaveBeenCalledTimes(1);
    const [jsonPayload, jsonFilename, jsonMimeType] = downloadMocks.downloadText.mock.calls[0];
    expect(jsonFilename).toBe("openplan-run-current-vs-run-baseline-comparison.json");
    expect(jsonMimeType).toBe("application/json;charset=utf-8");

    const parsedPayload = JSON.parse(jsonPayload);
    expect(parsedPayload).toMatchObject({
      currentRun: {
        id: "run-current",
        mapViewState: currentMapViewState,
      },
      baselineRun: {
        id: "run-baseline",
        title: "Baseline package",
      },
    });
    expect(parsedPayload.metricDeltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "overallScore",
          delta: 8,
        }),
      ])
    );
    expect(parsedPayload.mapViewComparison).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Project overlay",
          current: "Equity overlay \u00b7 Poverty share",
          baseline: "None",
          changed: true,
        }),
      ])
    );
  });
});

/**
 * A BETTER TRANSIT SOURCE MAY NOT RENDER AS A WORSE ONE.
 *
 * The card's tone used to be `source === "osm-overpass" ? "info" : "warning"`,
 * so the moment a second transit adapter existed, a run backed by an agency's
 * own published schedule — the strongest evidence the product can get — was
 * rendered in the tone reserved for a source that did not answer. A tone
 * compared against a hardcoded adapter id is a tone that is wrong for every
 * adapter registered after it was written.
 */
describe("ExploreResultsBoard transit source card", () => {
  function renderWithTransitSnapshot(transit: Record<string, unknown>) {
    const result = buildAnalysisResult();
    render(
      <ExploreResultsBoard
        analysisResult={{
          ...result,
          metrics: {
            ...result.metrics,
            sourceSnapshots: { ...result.metrics.sourceSnapshots, transit },
          },
        }}
        comparisonRun={null}
        queryText="Downtown access"
        currentMapViewState={currentMapViewState}
        onClearComparison={vi.fn()}
        onError={vi.fn()}
      />
    );
    return document.querySelector('[data-source-card="Transit access"]');
  }

  it("renders a feed-backed run in the same tone as any other answering source", () => {
    const card = renderWithTransitSnapshot({
      source: "gtfs-feed",
      observed: true,
      note: "Derived from the feeds this workspace ingested.",
      method: {
        id: "gtfs-service-levels",
        label: "Ingested GTFS service levels",
        detail: "Half density, half frequent-service share.",
        frequencyTermApplied: true,
      },
    });

    expect(card?.getAttribute("data-tone")).toBe("info");
    // And it names the method rather than the adapter token, which would read
    // as "Gtfs Feed" on a card a grant reviewer sees.
    expect(card?.textContent).toContain("Ingested GTFS service levels");
  });

  it("keeps the warning tone for a run where no transit source answered", () => {
    const card = renderWithTransitSnapshot({
      source: "unavailable",
      observed: false,
      note: "No transit source answered for this area.",
    });

    expect(card?.getAttribute("data-tone")).toBe("warning");
  });

  it("still renders an OpenStreetMap-backed run as an answering source", () => {
    const card = renderWithTransitSnapshot({
      source: "osm-overpass",
      observed: true,
      note: "OpenStreetMap stop proxy.",
    });

    expect(card?.getAttribute("data-tone")).toBe("info");
  });
});
