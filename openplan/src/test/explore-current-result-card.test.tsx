import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ExploreCurrentResultCard } from "@/app/(app)/explore/_components/explore-current-result-card";

type Props = ComponentProps<typeof ExploreCurrentResultCard>;

const resultGeojson: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function buildProps(overrides: Partial<Props> = {}): Props {
  return {
    analysisResult: {
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
      },
    },
    comparisonActive: false,
    currentRunTitle: "Downtown access check",
    currentRunTimestampLabel: "Apr 20, 2026, 9:00 AM",
    currentRunNarrativeLabel: "AI-assisted",
    currentRunMapContextLabel: "Captured",
    currentMapViewSummary: [
      { label: "Crash layer", value: "Fatal crashes visible" },
      { label: "Tract metric", value: "Minority share" },
    ],
    resultScoreTiles: [
      { label: "Access", value: "78", note: "Transit access score." },
      { label: "Safety", value: "72", note: "Crash safety score." },
    ],
    resultStatusBadges: [{ label: "High confidence", tone: "success" }],
    sourceTransparency: [
      {
        key: "census",
        label: "Census / ACS 5-Year",
        status: "Available",
        detail: "ACS tract inputs are present.",
        tone: "success",
      },
    ],
    sourceReviewCount: 0,
    comparisonMetricChangeCount: 0,
    comparisonViewDifferenceCount: 0,
    onExportMetrics: vi.fn(),
    onExportGeojson: vi.fn(),
    ...overrides,
  };
}

describe("ExploreCurrentResultCard", () => {
  it("renders the standalone deterministic fallback posture when map context is pending", () => {
    render(
      <ExploreCurrentResultCard
        {...buildProps({
          analysisResult: {
            runId: "run-fallback",
            summary: "Fallback summary is still reviewable.",
            aiInterpretationSource: "fallback",
            geojson: resultGeojson,
            metrics: {
              accessibilityScore: 61,
              safetyScore: 58,
              equityScore: 63,
            },
          },
          currentRunTitle: "Untitled run",
          currentRunTimestampLabel: "Time unavailable",
          currentRunNarrativeLabel: "Fallback",
          currentRunMapContextLabel: "Pending",
          currentMapViewSummary: [],
          resultStatusBadges: [{ label: "Needs review", tone: "warning" }],
          sourceReviewCount: 1,
          sourceTransparency: [
            {
              key: "narrative",
              label: "Narrative source",
              status: "Fallback",
              detail: "AI interpretation was unavailable for this run.",
              tone: "warning",
            },
          ],
        })}
      />
    );

    expect(screen.getByText("Current Result")).toBeInTheDocument();
    expect(screen.getByText("Standalone review")).toBeInTheDocument();
    expect(screen.getByText("Deterministic narrative")).toBeInTheDocument();
    expect(screen.getByText("Map context pending")).toBeInTheDocument();
    expect(screen.getByText("No saved context")).toBeInTheDocument();
    expect(screen.getByText("1 items to review")).toBeInTheDocument();
    expect(screen.getByText("Fallback summary is still reviewable.")).toBeInTheDocument();
    expect(screen.queryByText("AI interpretation")).not.toBeInTheDocument();
  });

  it("surfaces paired comparison context and dispatches export callbacks", () => {
    const onExportMetrics = vi.fn();
    const onExportGeojson = vi.fn();

    render(
      <ExploreCurrentResultCard
        {...buildProps({
          comparisonActive: true,
          comparisonMetricChangeCount: 3,
          comparisonViewDifferenceCount: 2,
          onExportMetrics,
          onExportGeojson,
        })}
      />
    );

    expect(screen.getByText("Paired with baseline")).toBeInTheDocument();
    expect(screen.getByText("3 metric shifts pending review")).toBeInTheDocument();
    expect(screen.getByText("2 view posture differences")).toBeInTheDocument();
    expect(screen.getByText("2 context checks saved")).toBeInTheDocument();
    expect(screen.getByText("Source checks look good")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export Metrics CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Export Result GeoJSON" }));

    expect(onExportMetrics).toHaveBeenCalledTimes(1);
    expect(onExportGeojson).toHaveBeenCalledTimes(1);
  });
});
