import type { Map as MapboxMap } from "mapbox-gl";
import { buildTractMetricPaintExpression } from "./explore-tract-layer-state";

export function installAnalysisLayers(map: MapboxMap): void {
  if (!map.getSource("analysis-result")) {
    map.addSource("analysis-result", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });
  }

  if (!map.getLayer("tract-fill")) {
    map.addLayer({
      id: "tract-fill",
      type: "fill",
      source: "analysis-result",
      paint: {
        "fill-color": buildTractMetricPaintExpression("minority"),
        "fill-opacity": 0.28,
      },
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "kind"], "census_tract"]],
    });
  }

  if (!map.getLayer("tract-outline")) {
    map.addLayer({
      id: "tract-outline",
      type: "line",
      source: "analysis-result",
      paint: {
        "line-color": "rgba(186, 230, 253, 0.55)",
        "line-width": 0.8,
        "line-opacity": 0.5,
      },
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "kind"], "census_tract"]],
    });
  }

  if (!map.getLayer("analysis-fill")) {
    map.addLayer({
      id: "analysis-fill",
      type: "fill",
      source: "analysis-result",
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "overallScore"]], 50],
          0,
          "#7f1d1d",
          45,
          "#be8e2f",
          70,
          "#0f766e",
          100,
          "#34d399",
        ],
        "fill-opacity": 0.22,
      },
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "kind"], "analysis_corridor"]],
    });
  }

  if (!map.getLayer("analysis-outline")) {
    map.addLayer({
      id: "analysis-outline",
      type: "line",
      source: "analysis-result",
      paint: {
        "line-color": "#d8efe8",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.8, 10, 3.2],
        "line-opacity": 0.95,
      },
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "kind"], "analysis_corridor"]],
    });
  }

  if (!map.getLayer("analysis-points")) {
    map.addLayer({
      id: "analysis-points",
      type: "circle",
      source: "analysis-result",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 11, 9],
        "circle-color": "#f97316",
        "circle-stroke-color": "#fff7ed",
        "circle-stroke-width": 1.4,
        "circle-opacity": 0.95,
      },
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "corridor_centroid"]],
    });
  }

  if (!map.getLayer("crash-points-glow")) {
    map.addLayer({
      id: "crash-points-glow",
      type: "circle",
      source: "analysis-result",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 11, 12],
        "circle-color": [
          "match",
          ["get", "severityBucket"],
          "fatal",
          "#ef4444",
          "severe_injury",
          "#fb923c",
          "#facc15",
        ],
        "circle-opacity": 0.18,
        "circle-blur": 0.8,
      },
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "crash_point"]],
    });
  }

  if (!map.getLayer("crash-points-core")) {
    map.addLayer({
      id: "crash-points-core",
      type: "circle",
      source: "analysis-result",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7],
        "circle-color": [
          "match",
          ["get", "severityBucket"],
          "fatal",
          "#ef4444",
          "severe_injury",
          "#fb923c",
          "#facc15",
        ],
        "circle-stroke-color": "#fff7ed",
        "circle-stroke-width": 1,
        "circle-opacity": 0.95,
      },
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "crash_point"]],
    });
  }

  if (!map.getSource("dataset-overlay")) {
    map.addSource("dataset-overlay", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });
  }

  if (!map.getLayer("dataset-overlay-fill")) {
    map.addLayer({
      id: "dataset-overlay-fill",
      type: "fill",
      source: "dataset-overlay",
      paint: {
        "fill-color": "#f97316",
        "fill-opacity": 0.12,
      },
      filter: ["==", ["geometry-type"], "Polygon"],
    });
  }

  if (!map.getLayer("dataset-overlay-line")) {
    map.addLayer({
      id: "dataset-overlay-line",
      type: "line",
      source: "dataset-overlay",
      paint: {
        "line-color": "#fb923c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 11, 3.4],
        "line-opacity": 0.95,
        "line-dasharray": [1.2, 1],
      },
    });
  }

  if (!map.getLayer("dataset-overlay-point")) {
    map.addLayer({
      id: "dataset-overlay-point",
      type: "circle",
      source: "dataset-overlay",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7],
        "circle-color": "#f97316",
        "circle-stroke-color": "#fff7ed",
        "circle-stroke-width": 1,
        "circle-opacity": 0.95,
      },
      filter: ["==", ["geometry-type"], "Point"],
    });
  }

  const labelLayerId = map
    .getStyle()
    ?.layers?.find((layer) => layer.type === "symbol" && String(layer.id).includes("label"))?.id;

  if (labelLayerId && !map.getLayer("analysis-outline-highlight")) {
    map.addLayer(
      {
        id: "analysis-outline-highlight",
        type: "line",
        source: "analysis-result",
        paint: {
          "line-color": "#5eead4",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 12, 2.4],
          "line-opacity": 0.65,
        },
      },
      labelLayerId
    );
  }
}
