import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { describe, expect, it, vi } from "vitest";

import { syncDatasetOverlayMap } from "@/app/(app)/explore/_components/explore-dataset-overlay-map";
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

function createMapStub({
  hasSource = true,
  layers = ["dataset-overlay-fill", "dataset-overlay-line", "dataset-overlay-point"],
}: {
  hasSource?: boolean;
  layers?: string[];
} = {}) {
  const setData = vi.fn();
  const source = { setData } as unknown as GeoJSONSource;
  const layerSet = new Set(layers);
  const getSource = vi.fn((sourceId: string) => (hasSource && sourceId === "dataset-overlay" ? source : undefined));
  const getLayer = vi.fn((layerId: string) => (layerSet.has(layerId) ? { id: layerId } : undefined));
  const setPaintProperty = vi.fn();
  const map = {
    getSource,
    getLayer,
    setPaintProperty,
  } as unknown as MapboxMap;

  return {
    getLayer,
    getSource,
    map,
    setData,
    setPaintProperty,
  };
}

describe("syncDatasetOverlayMap", () => {
  it("does nothing when the dataset overlay source has not been installed", () => {
    const mapStub = createMapStub({ hasSource: false });

    syncDatasetOverlayMap({
      map: mapStub.map,
      selectedDataset: buildDataset(),
      analysisResult: buildAnalysisResult(),
      corridorGeojson,
    });

    expect(mapStub.getSource).toHaveBeenCalledWith("dataset-overlay");
    expect(mapStub.getLayer).not.toHaveBeenCalled();
    expect(mapStub.setData).not.toHaveBeenCalled();
    expect(mapStub.setPaintProperty).not.toHaveBeenCalled();
  });

  it("clears overlay data and resets paint when no dataset is selected", () => {
    const mapStub = createMapStub();

    syncDatasetOverlayMap({
      map: mapStub.map,
      selectedDataset: null,
      analysisResult: buildAnalysisResult(),
      corridorGeojson,
    });

    expect(mapStub.setData).toHaveBeenCalledWith({ type: "FeatureCollection", features: [] });
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-fill", "fill-color", "#f97316");
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-fill", "fill-opacity", 0.12);
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-line", "line-color", "#fb923c");
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-line", "line-dasharray", [1.2, 1]);
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-point", "circle-color", "#f97316");
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-point", "circle-stroke-color", "#fff7ed");
  });

  it("syncs tract thematic overlay data and applies thematic fill paint", () => {
    const mapStub = createMapStub();

    syncDatasetOverlayMap({
      map: mapStub.map,
      selectedDataset: buildDataset(),
      analysisResult: buildAnalysisResult(),
      corridorGeojson,
    });

    expect(mapStub.setData).toHaveBeenCalledWith({
      type: "FeatureCollection",
      features: [
        expect.objectContaining({
          properties: expect.objectContaining({
            kind: "census_tract",
            geoid: "06061000100",
            overlayDatasetId: "dataset-1",
            overlayDatasetName: "Equity screen",
            overlayMetricKey: "pctBelowPoverty",
            overlayMode: "thematic_overlay",
          }),
        }),
      ],
    });
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-fill", "fill-opacity", 0.42);
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-fill", "fill-color", [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "pctBelowPoverty"]], 0],
      0,
      "#0b3b2e",
      10,
      "#15803d",
      20,
      "#65a30d",
      30,
      "#ca8a04",
      45,
      "#b91c1c",
    ]);
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-line", "line-color", "#f8fafc");
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-line", "line-dasharray", [1, 0]);
  });

  it("keeps coverage-only corridor overlays on reset paint while syncing metric properties", () => {
    const mapStub = createMapStub();

    syncDatasetOverlayMap({
      map: mapStub.map,
      selectedDataset: buildDataset({
        geographyScope: "corridor",
        geometryAttachment: "analysis_corridor",
        thematicMetricKey: null,
        thematicMetricLabel: null,
        thematicReady: false,
      }),
      analysisResult: buildAnalysisResult(),
      corridorGeojson,
    });

    expect(mapStub.setData).toHaveBeenCalledWith({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: corridorGeojson,
          properties: expect.objectContaining({
            kind: "dataset_coverage_corridor",
            overlayMode: "coverage_footprint",
            overallScore: 77,
            accessibilityScore: 81,
            safetyScore: 72,
            equityScore: 78,
          }),
        },
      ],
    });
    expect(mapStub.setPaintProperty).toHaveBeenCalledTimes(7);
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-fill", "fill-opacity", 0.12);
    expect(mapStub.setPaintProperty).toHaveBeenCalledWith("dataset-overlay-line", "line-dasharray", [1.2, 1]);
  });
});
