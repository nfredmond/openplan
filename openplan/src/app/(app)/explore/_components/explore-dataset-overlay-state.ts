import { canRenderDatasetCoverageOverlay, canRenderDatasetThematicOverlay } from "./_helpers";
import type { AnalysisContextResponse, AnalysisResult, CorridorGeometry } from "./_types";

type LinkedDataset = AnalysisContextResponse["linkedDatasets"][number];

export type DatasetOverlayMode = "thematic_overlay" | "coverage_footprint";

export type DatasetOverlayState = {
  featureCollection: GeoJSON.FeatureCollection;
  geographyScope: string | null;
  mode: DatasetOverlayMode | null;
};

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function resolveDatasetOverlayMode(dataset: LinkedDataset): DatasetOverlayMode {
  return canRenderDatasetThematicOverlay(dataset) ? "thematic_overlay" : "coverage_footprint";
}

function buildDatasetOverlayProperties(dataset: LinkedDataset, mode: DatasetOverlayMode) {
  return {
    overlayDatasetName: dataset.name,
    overlayDatasetId: dataset.datasetId,
    overlayMode: mode,
    overlayMetricKey: dataset.thematicMetricKey,
  };
}

export function buildDatasetOverlayState({
  selectedDataset,
  analysisResult,
  corridorGeojson,
}: {
  selectedDataset: LinkedDataset | null;
  analysisResult: AnalysisResult | null;
  corridorGeojson: CorridorGeometry | null;
}): DatasetOverlayState {
  if (!selectedDataset || !canRenderDatasetCoverageOverlay(selectedDataset)) {
    return {
      featureCollection: emptyFeatureCollection(),
      geographyScope: null,
      mode: null,
    };
  }

  const mode = resolveDatasetOverlayMode(selectedDataset);

  if (selectedDataset.geographyScope === "tract") {
    const tractFeatures =
      analysisResult?.geojson.features.filter(
        (feature) =>
          feature.geometry?.type !== "Point" &&
          feature.properties &&
          (feature.properties as Record<string, unknown>).kind === "census_tract"
      ) ?? [];

    return {
      featureCollection: {
        type: "FeatureCollection",
        features: tractFeatures.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            ...buildDatasetOverlayProperties(selectedDataset, mode),
          },
        })),
      },
      geographyScope: selectedDataset.geographyScope,
      mode,
    };
  }

  if (selectedDataset.geographyScope === "corridor" || selectedDataset.geographyScope === "route") {
    return {
      featureCollection: {
        type: "FeatureCollection",
        features: corridorGeojson
          ? [
              {
                type: "Feature",
                geometry: corridorGeojson,
                properties: {
                  kind: "dataset_coverage_corridor",
                  ...buildDatasetOverlayProperties(selectedDataset, mode),
                  overallScore: analysisResult?.metrics.overallScore ?? null,
                  accessibilityScore: analysisResult?.metrics.accessibilityScore ?? null,
                  safetyScore: analysisResult?.metrics.safetyScore ?? null,
                  equityScore: analysisResult?.metrics.equityScore ?? null,
                },
              },
            ]
          : [],
      },
      geographyScope: selectedDataset.geographyScope,
      mode,
    };
  }

  if (selectedDataset.geographyScope === "point") {
    const crashPointFeatures =
      analysisResult?.geojson.features.filter(
        (feature) =>
          feature.geometry?.type === "Point" &&
          feature.properties &&
          (feature.properties as Record<string, unknown>).kind === "crash_point"
      ) ?? [];

    return {
      featureCollection: {
        type: "FeatureCollection",
        features: crashPointFeatures.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            ...buildDatasetOverlayProperties(selectedDataset, mode),
          },
        })),
      },
      geographyScope: selectedDataset.geographyScope,
      mode,
    };
  }

  return {
    featureCollection: emptyFeatureCollection(),
    geographyScope: selectedDataset.geographyScope,
    mode,
  };
}
