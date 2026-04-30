import { describe, expect, it } from "vitest";

import { buildDatasetOverlayState } from "@/app/(app)/explore/_components/explore-dataset-overlay-state";
import type {
  AnalysisContextResponse,
  AnalysisResult,
  CorridorGeometry,
} from "@/app/(app)/explore/_components/_types";

type LinkedDataset = AnalysisContextResponse["linkedDatasets"][number];

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

function buildDataset(overrides: Partial<LinkedDataset> = {}): LinkedDataset {
  return {
    datasetId: "dataset-1",
    name: "Equity screen",
    status: "ready",
    geographyScope: "tract",
    geometryAttachment: "tract",
    thematicMetricKey: "pctBelowPoverty",
    thematicMetricLabel: "Poverty share",
    relationshipType: "project_context",
    vintageLabel: "2022",
    lastRefreshedAt: "2026-04-20T09:00:00.000Z",
    connectorLabel: "Local upload",
    overlayReady: true,
    thematicReady: true,
    ...overrides,
  };
}

function buildAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    runId: "run-1",
    title: "Corridor screen",
    createdAt: "2026-04-20T10:00:00.000Z",
    summary: "Summary",
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: corridorGeojson,
          properties: {
            kind: "census_tract",
            geoid: "06061000100",
            pctBelowPoverty: 18,
          },
        },
        {
          type: "Feature",
          geometry: corridorGeojson,
          properties: {
            kind: "analysis_corridor",
          },
        },
      ],
    },
    metrics: {
      accessibilityScore: 81,
      safetyScore: 72,
      equityScore: 78,
      overallScore: 77,
    },
    ...overrides,
  };
}

describe("buildDatasetOverlayState", () => {
  it("builds tract thematic overlay features from census tract result geometry", () => {
    const state = buildDatasetOverlayState({
      selectedDataset: buildDataset(),
      analysisResult: buildAnalysisResult(),
      corridorGeojson,
    });

    expect(state.mode).toBe("thematic_overlay");
    expect(state.geographyScope).toBe("tract");
    expect(state.featureCollection.features).toHaveLength(1);
    expect(state.featureCollection.features[0].properties).toMatchObject({
      kind: "census_tract",
      geoid: "06061000100",
      overlayDatasetName: "Equity screen",
      overlayDatasetId: "dataset-1",
      overlayMode: "thematic_overlay",
      overlayMetricKey: "pctBelowPoverty",
    });
  });

  it("builds corridor overlay features with analysis metric properties", () => {
    const state = buildDatasetOverlayState({
      selectedDataset: buildDataset({
        geographyScope: "corridor",
        geometryAttachment: "analysis_corridor",
        thematicMetricKey: null,
        thematicReady: false,
      }),
      analysisResult: buildAnalysisResult(),
      corridorGeojson,
    });

    expect(state.mode).toBe("coverage_footprint");
    expect(state.geographyScope).toBe("corridor");
    expect(state.featureCollection.features).toHaveLength(1);
    expect(state.featureCollection.features[0].properties).toMatchObject({
      kind: "dataset_coverage_corridor",
      overlayDatasetName: "Equity screen",
      overlayMode: "coverage_footprint",
      overallScore: 77,
      accessibilityScore: 81,
      safetyScore: 72,
      equityScore: 78,
    });
  });

  it("returns an empty overlay when no renderable dataset is selected", () => {
    const state = buildDatasetOverlayState({
      selectedDataset: buildDataset({ overlayReady: false }),
      analysisResult: buildAnalysisResult(),
      corridorGeojson,
    });

    expect(state.mode).toBeNull();
    expect(state.geographyScope).toBeNull();
    expect(state.featureCollection).toEqual({ type: "FeatureCollection", features: [] });
  });
});
