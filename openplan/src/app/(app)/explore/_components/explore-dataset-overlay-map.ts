import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { buildPointThematicOverlayColorExpression, buildThematicOverlayPaintExpression } from "./_helpers";
import type { AnalysisContextResponse, AnalysisResult, CorridorGeometry } from "./_types";
import { buildDatasetOverlayState } from "./explore-dataset-overlay-state";

type LinkedDataset = AnalysisContextResponse["linkedDatasets"][number];

export function syncDatasetOverlayMap({
  map,
  selectedDataset,
  analysisResult,
  corridorGeojson,
}: {
  map: MapboxMap;
  selectedDataset: LinkedDataset | null;
  analysisResult: AnalysisResult | null;
  corridorGeojson: CorridorGeometry | null;
}): void {
  const source = map.getSource("dataset-overlay") as GeoJSONSource | undefined;
  if (!source) {
    return;
  }

  resetDatasetOverlayPaint(map);

  const datasetOverlayState = buildDatasetOverlayState({
    selectedDataset,
    analysisResult,
    corridorGeojson,
  });

  source.setData(datasetOverlayState.featureCollection);

  if (!selectedDataset || datasetOverlayState.mode !== "thematic_overlay") {
    return;
  }

  if (datasetOverlayState.geographyScope === "tract") {
    if (map.getLayer("dataset-overlay-fill")) {
      map.setPaintProperty(
        "dataset-overlay-fill",
        "fill-color",
        buildThematicOverlayPaintExpression(selectedDataset.thematicMetricKey)
      );
      map.setPaintProperty("dataset-overlay-fill", "fill-opacity", 0.42);
    }
    if (map.getLayer("dataset-overlay-line")) {
      map.setPaintProperty("dataset-overlay-line", "line-color", "#f8fafc");
      map.setPaintProperty("dataset-overlay-line", "line-dasharray", [1, 0]);
    }
    return;
  }

  if (datasetOverlayState.geographyScope === "corridor" || datasetOverlayState.geographyScope === "route") {
    if (map.getLayer("dataset-overlay-fill")) {
      map.setPaintProperty(
        "dataset-overlay-fill",
        "fill-color",
        buildThematicOverlayPaintExpression(selectedDataset.thematicMetricKey)
      );
      map.setPaintProperty("dataset-overlay-fill", "fill-opacity", 0.24);
    }
    if (map.getLayer("dataset-overlay-line")) {
      map.setPaintProperty(
        "dataset-overlay-line",
        "line-color",
        buildThematicOverlayPaintExpression(selectedDataset.thematicMetricKey)
      );
      map.setPaintProperty("dataset-overlay-line", "line-dasharray", [1, 0]);
      map.setPaintProperty("dataset-overlay-line", "line-width", ["interpolate", ["linear"], ["zoom"], 4, 3, 11, 6]);
    }
    return;
  }

  if (datasetOverlayState.geographyScope === "point" && map.getLayer("dataset-overlay-point")) {
    map.setPaintProperty(
      "dataset-overlay-point",
      "circle-color",
      buildPointThematicOverlayColorExpression(selectedDataset.thematicMetricKey)
    );
    map.setPaintProperty(
      "dataset-overlay-point",
      "circle-radius",
      selectedDataset.thematicMetricKey === "fatalCount" || selectedDataset.thematicMetricKey === "injuryCount"
        ? [
            "interpolate",
            ["linear"],
            ["coalesce", ["to-number", ["get", selectedDataset.thematicMetricKey]], 0],
            0,
            3,
            1,
            5,
            4,
            9,
          ]
        : ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7]
    );
  }
}

function resetDatasetOverlayPaint(map: MapboxMap): void {
  if (map.getLayer("dataset-overlay-fill")) {
    map.setPaintProperty("dataset-overlay-fill", "fill-color", "#f97316");
    map.setPaintProperty("dataset-overlay-fill", "fill-opacity", 0.12);
  }
  if (map.getLayer("dataset-overlay-line")) {
    map.setPaintProperty("dataset-overlay-line", "line-color", "#fb923c");
    map.setPaintProperty("dataset-overlay-line", "line-dasharray", [1.2, 1]);
  }
  if (map.getLayer("dataset-overlay-point")) {
    map.setPaintProperty("dataset-overlay-point", "circle-color", "#f97316");
    map.setPaintProperty("dataset-overlay-point", "circle-radius", ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7]);
    map.setPaintProperty("dataset-overlay-point", "circle-stroke-color", "#fff7ed");
  }
}
