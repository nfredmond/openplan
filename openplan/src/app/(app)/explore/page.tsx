"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import mapboxgl, {
  FullscreenControl,
  Map,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
} from "mapbox-gl";
import { CorridorUpload } from "@/components/corridor/CorridorUpload";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import {
  type CrashSeverityFilter,
  type CrashUserFilter,
  type MapViewState,
} from "@/lib/analysis/map-view-state";
import { ANALYSIS_QUERY_MAX_CHARS } from "@/lib/analysis/query";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { resolveStatusTone } from "@/lib/ui/status";
import type {
  AnalysisContextLoadState,
  AnalysisContextResponse,
  AnalysisResult,
  CorridorGeometry,
  CurrentWorkspaceResponse,
  HoveredCrash,
  HoveredTract,
  ReportTemplate,
  TractMetric,
  WorkspaceBootstrapResponse,
  WorkspaceLoadState,
} from "./_components/_types";
import {
  buildCrashLayerFilter,
  buildPointThematicOverlayColorExpression,
  buildRunTitle,
  buildThematicOverlayPaintExpression,
  canRenderDatasetCoverageOverlay,
  canRenderDatasetThematicOverlay,
  coerceNumber,
  formatRunTimestamp,
  getBoundsFromGeometry,
  titleize,
} from "./_components/_helpers";
import { ExploreHoverInspector } from "./_components/explore-hover-inspector";
import { ExploreLayerVisibilityControls } from "./_components/explore-layer-visibility-controls";
import { ExploreResultsBoard } from "./_components/explore-results-board";
import { ExploreRunHistoryPanel } from "./_components/explore-run-history-panel";
import {
  buildCurrentMapViewState,
  getCrashPointFeatures,
  getLinkedDatasetPreview,
  hasSwitrsPointLayer,
  resolveActiveDatasetOverlay,
  resolveWorkspaceHelperText,
  resolveWorkspaceStatusLabel,
} from "./_components/explore-page-state";
import { buildDatasetOverlayState } from "./_components/explore-dataset-overlay-state";
import { ExploreStudyBriefControls } from "./_components/explore-study-brief-controls";
import { useExploreRunHistory } from "./_components/use-explore-run-history";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

export default function ExplorePage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  const [workspaceId, setWorkspaceId] = useState("");
  const [queryText, setQueryText] = useState("");
  const [corridorGeojson, setCorridorGeojson] = useState<CorridorGeometry | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [reportTemplate, setReportTemplate] = useState<ReportTemplate>("atp");
  const [error, setError] = useState("");
  const [workspaceLoadState, setWorkspaceLoadState] = useState<WorkspaceLoadState>("loading");
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null);
  const [bootstrapWorkspaceName, setBootstrapWorkspaceName] = useState("");
  const [isBootstrappingWorkspace, setIsBootstrappingWorkspace] = useState(false);
  const [bootstrapChecklist, setBootstrapChecklist] = useState<string[]>([]);
  const [analysisContext, setAnalysisContext] = useState<AnalysisContextResponse | null>(null);
  const [analysisContextLoadState, setAnalysisContextLoadState] = useState<AnalysisContextLoadState>("idle");
  const [activeDatasetOverlayId, setActiveDatasetOverlayId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [showPolygonFill, setShowPolygonFill] = useState(true);
  const [showPoints, _setShowPoints] = useState(true);
  const [showTracts, setShowTracts] = useState(true);
  const [showCrashes, setShowCrashes] = useState(true);
  const [cameraMode, _setCameraMode] = useState<"regional" | "cinematic">("regional");
  const [tractMetric, setTractMetric] = useState<TractMetric>("minority");
  const [crashSeverityFilter, setCrashSeverityFilter] = useState<CrashSeverityFilter>("all");
  const [crashUserFilter, setCrashUserFilter] = useState<CrashUserFilter>("all");
  const [hoveredTract, setHoveredTract] = useState<HoveredTract | null>(null);
  const [hoveredCrash, setHoveredCrash] = useState<HoveredCrash | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-121.033982, 39.239137],
      zoom: 7,
      pitch: 36,
      bearing: -10,
      antialias: true,
      attributionControl: false,
    });

    window.setTimeout(() => {
      map.resize();
    }, 180);

    const installAnalysisLayers = () => {
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
            "fill-color": [
              "interpolate",
              ["linear"],
              ["coalesce", ["to-number", ["get", "pctMinority"]], 0],
              0,
              "#123047",
              30,
              "#1d4ed8",
              55,
              "#2563eb",
              75,
              "#0f766e",
              100,
              "#34d399",
            ],
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
    };

    map.on("style.load", installAnalysisLayers);
    map.on("load", () => {
      map.resize();
      installAnalysisLayers();
      map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new FullscreenControl(), "top-right");
      map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadCurrentWorkspace() {
      setWorkspaceLoadState("loading");

      try {
        const response = await fetch("/api/workspaces/current", { method: "GET" });

        if (response.status === 401) {
          if (!isCancelled) {
            setWorkspaceLoadState("signedOut");
          }
          return;
        }

        if (response.status === 404) {
          if (!isCancelled) {
            setWorkspaceLoadState("noMembership");
          }
          return;
        }

        if (!response.ok) {
          throw new Error("Failed to auto-load workspace.");
        }

        const payload = (await response.json()) as CurrentWorkspaceResponse;
        if (isCancelled) {
          return;
        }

        setWorkspaceId(payload.workspaceId);
        setWorkspaceName(payload.name);
        setWorkspaceRole(payload.role);
        setWorkspaceLoadState("loaded");
      } catch {
        if (!isCancelled) {
          setWorkspaceLoadState("error");
        }
      }
    }

    void loadCurrentWorkspace();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadAnalysisContext() {
      if (!workspaceId) {
        setAnalysisContext(null);
        setAnalysisContextLoadState("idle");
        setActiveDatasetOverlayId(null);
        return;
      }

      setAnalysisContextLoadState("loading");

      try {
        const response = await fetch(`/api/analysis/context?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error("Failed to load project context.");
        }

        const payload = (await response.json()) as AnalysisContextResponse;
        if (isCancelled) {
          return;
        }

        setAnalysisContext(payload);
        setAnalysisContextLoadState("loaded");
      } catch {
        if (!isCancelled) {
          setAnalysisContext(null);
          setAnalysisContextLoadState("error");
        }
      }
    }

    void loadAnalysisContext();

    return () => {
      isCancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const source = mapRef.current.getSource("analysis-result") as
      | mapboxgl.GeoJSONSource
      | undefined;

    if (source) {
      source.setData(
        analysisResult?.geojson ||
          (corridorGeojson
            ? {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { preview: true }, geometry: corridorGeojson }],
              }
            : { type: "FeatureCollection", features: [] })
      );
    }

    if (corridorGeojson) {
      const bounds = getBoundsFromGeometry(corridorGeojson);
      if (bounds) {
        mapRef.current.fitBounds(bounds, { padding: 56, duration: 650, pitch: cameraMode === "cinematic" ? 54 : 34 });
      }
    }
  }, [analysisResult, corridorGeojson, cameraMode]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (mapRef.current.getLayer("analysis-fill")) {
      mapRef.current.setLayoutProperty("analysis-fill", "visibility", showPolygonFill ? "visible" : "none");
    }

    if (mapRef.current.getLayer("analysis-outline")) {
      mapRef.current.setLayoutProperty("analysis-outline", "visibility", showPolygonFill ? "visible" : "none");
    }

    if (mapRef.current.getLayer("analysis-outline-highlight")) {
      mapRef.current.setLayoutProperty("analysis-outline-highlight", "visibility", showPolygonFill ? "visible" : "none");
    }
  }, [showPolygonFill]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (mapRef.current.getLayer("tract-fill")) {
      mapRef.current.setLayoutProperty("tract-fill", "visibility", showTracts ? "visible" : "none");
    }

    if (mapRef.current.getLayer("tract-outline")) {
      mapRef.current.setLayoutProperty("tract-outline", "visibility", showTracts ? "visible" : "none");
    }

    if (!showTracts) {
      setHoveredTract(null);
    }
  }, [showTracts]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("analysis-points")) {
      return;
    }

    mapRef.current.setLayoutProperty("analysis-points", "visibility", showPoints ? "visible" : "none");
  }, [showPoints]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const visibility = showCrashes ? "visible" : "none";
    if (mapRef.current.getLayer("crash-points-glow")) {
      mapRef.current.setLayoutProperty("crash-points-glow", "visibility", visibility);
    }
    if (mapRef.current.getLayer("crash-points-core")) {
      mapRef.current.setLayoutProperty("crash-points-core", "visibility", visibility);
    }

    if (!showCrashes) {
      setHoveredCrash(null);
    }
  }, [showCrashes]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("crash-points-core")) {
      return;
    }

    const crashFilterExpression = buildCrashLayerFilter(crashSeverityFilter, crashUserFilter);

    mapRef.current.setFilter("crash-points-core", crashFilterExpression);
    if (mapRef.current.getLayer("crash-points-glow")) {
      mapRef.current.setFilter("crash-points-glow", crashFilterExpression);
    }

    setHoveredCrash(null);
  }, [crashSeverityFilter, crashUserFilter]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !mapRef.current.getLayer("crash-points-core")) {
      return;
    }

    const map = mapRef.current;

    const handleCrashEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleCrashLeave = () => {
      map.getCanvas().style.cursor = "";
      setHoveredCrash(null);
    };

    const handleCrashMove = (event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      const properties = event.features?.[0]?.properties;
      if (!properties) {
        setHoveredCrash(null);
        return;
      }

      setHoveredCrash({
        severityLabel: String(properties.severityLabel ?? "Crash"),
        collisionYear: coerceNumber(properties.collisionYear),
        fatalCount: coerceNumber(properties.fatalCount) ?? 0,
        injuryCount: coerceNumber(properties.injuryCount) ?? 0,
        pedestrianInvolved: String(properties.pedestrianInvolved ?? "false") === "true",
        bicyclistInvolved: String(properties.bicyclistInvolved ?? "false") === "true",
      });
    };

    map.on("mouseenter", "crash-points-core", handleCrashEnter);
    map.on("mousemove", "crash-points-core", handleCrashMove);
    map.on("mouseleave", "crash-points-core", handleCrashLeave);

    return () => {
      if (!map.getLayer("crash-points-core")) {
        return;
      }

      map.off("mouseenter", "crash-points-core", handleCrashEnter);
      map.off("mousemove", "crash-points-core", handleCrashMove);
      map.off("mouseleave", "crash-points-core", handleCrashLeave);
      map.getCanvas().style.cursor = "";
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const source = mapRef.current.getSource("dataset-overlay") as mapboxgl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    const selectedDataset =
      analysisContext?.linkedDatasets.find((dataset) => dataset.datasetId === activeDatasetOverlayId) ?? null;

    if (mapRef.current.getLayer("dataset-overlay-fill")) {
      mapRef.current.setPaintProperty("dataset-overlay-fill", "fill-color", "#f97316");
      mapRef.current.setPaintProperty("dataset-overlay-fill", "fill-opacity", 0.12);
    }
    if (mapRef.current.getLayer("dataset-overlay-line")) {
      mapRef.current.setPaintProperty("dataset-overlay-line", "line-color", "#fb923c");
      mapRef.current.setPaintProperty("dataset-overlay-line", "line-dasharray", [1.2, 1]);
    }
    if (mapRef.current.getLayer("dataset-overlay-point")) {
      mapRef.current.setPaintProperty("dataset-overlay-point", "circle-color", "#f97316");
      mapRef.current.setPaintProperty("dataset-overlay-point", "circle-radius", ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7]);
      mapRef.current.setPaintProperty("dataset-overlay-point", "circle-stroke-color", "#fff7ed");
    }

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
      if (mapRef.current.getLayer("dataset-overlay-fill")) {
        mapRef.current.setPaintProperty(
          "dataset-overlay-fill",
          "fill-color",
          buildThematicOverlayPaintExpression(selectedDataset.thematicMetricKey)
        );
        mapRef.current.setPaintProperty("dataset-overlay-fill", "fill-opacity", 0.42);
      }
      if (mapRef.current.getLayer("dataset-overlay-line")) {
        mapRef.current.setPaintProperty("dataset-overlay-line", "line-color", "#f8fafc");
        mapRef.current.setPaintProperty("dataset-overlay-line", "line-dasharray", [1, 0]);
      }
      return;
    }

    if (datasetOverlayState.geographyScope === "corridor" || datasetOverlayState.geographyScope === "route") {
      if (mapRef.current.getLayer("dataset-overlay-fill")) {
        mapRef.current.setPaintProperty(
          "dataset-overlay-fill",
          "fill-color",
          buildThematicOverlayPaintExpression(selectedDataset.thematicMetricKey)
        );
        mapRef.current.setPaintProperty("dataset-overlay-fill", "fill-opacity", 0.24);
      }
      if (mapRef.current.getLayer("dataset-overlay-line")) {
        mapRef.current.setPaintProperty(
          "dataset-overlay-line",
          "line-color",
          buildThematicOverlayPaintExpression(selectedDataset.thematicMetricKey)
        );
        mapRef.current.setPaintProperty("dataset-overlay-line", "line-dasharray", [1, 0]);
        mapRef.current.setPaintProperty("dataset-overlay-line", "line-width", ["interpolate", ["linear"], ["zoom"], 4, 3, 11, 6]);
      }
      return;
    }

    if (datasetOverlayState.geographyScope === "point") {
      if (mapRef.current.getLayer("dataset-overlay-point")) {
        mapRef.current.setPaintProperty(
          "dataset-overlay-point",
          "circle-color",
          buildPointThematicOverlayColorExpression(selectedDataset.thematicMetricKey)
        );
        mapRef.current.setPaintProperty(
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
      return;
    }
  }, [activeDatasetOverlayId, analysisContext, analysisResult, corridorGeojson]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    mapRef.current.easeTo({
      pitch: cameraMode === "cinematic" ? 54 : 34,
      bearing: cameraMode === "cinematic" ? -18 : -10,
      duration: 700,
    });
  }, [cameraMode]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("tract-fill")) {
      return;
    }

    const paintByMetric: Record<typeof tractMetric, ExpressionSpecification> = {
      minority: [
        "interpolate",
        ["linear"],
        ["coalesce", ["to-number", ["get", "pctMinority"]], 0],
        0,
        "#123047",
        30,
        "#1d4ed8",
        55,
        "#2563eb",
        75,
        "#0f766e",
        100,
        "#34d399",
      ],
      poverty: [
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
      ],
      income: [
        "interpolate",
        ["linear"],
        ["coalesce", ["to-number", ["get", "medianIncome"]], 0],
        0,
        "#7f1d1d",
        45000,
        "#b45309",
        70000,
        "#0f766e",
        100000,
        "#0ea5e9",
        150000,
        "#e0f2fe",
      ],
      disadvantaged: [
        "case",
        ["==", ["coalesce", ["to-number", ["get", "isDisadvantaged"]], 0], 1],
        "#ef4444",
        "#1f2937",
      ],
    };

    mapRef.current.setPaintProperty("tract-fill", "fill-color", paintByMetric[tractMetric]);
  }, [tractMetric]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !mapRef.current.getLayer("tract-fill")) {
      return;
    }

    const map = mapRef.current;

    const handleTractEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleTractLeave = () => {
      map.getCanvas().style.cursor = "";
      setHoveredTract(null);
    };

    const handleTractMove = (event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      const properties = event.features?.[0]?.properties;
      if (!properties) {
        setHoveredTract(null);
        return;
      }

      setHoveredTract({
        name: String(properties.name ?? properties.NAME ?? "Census tract"),
        geoid: String(properties.geoid ?? properties.GEOID ?? "Unknown"),
        population: coerceNumber(properties.population),
        medianIncome: coerceNumber(properties.medianIncome),
        pctMinority: coerceNumber(properties.pctMinority),
        pctBelowPoverty: coerceNumber(properties.pctBelowPoverty),
        zeroVehiclePct: coerceNumber(properties.zeroVehiclePct),
        transitCommutePct: coerceNumber(properties.transitCommutePct),
        isDisadvantaged: coerceNumber(properties.isDisadvantaged) === 1,
      });
    };

    map.on("mouseenter", "tract-fill", handleTractEnter);
    map.on("mousemove", "tract-fill", handleTractMove);
    map.on("mouseleave", "tract-fill", handleTractLeave);

    return () => {
      if (!map.getLayer("tract-fill")) {
        return;
      }

      map.off("mouseenter", "tract-fill", handleTractEnter);
      map.off("mousemove", "tract-fill", handleTractMove);
      map.off("mouseleave", "tract-fill", handleTractLeave);
      map.getCanvas().style.cursor = "";
    };
  }, [mapReady]);

  const trimmedQueryText = queryText.trim();
  const isQueryTooLong = trimmedQueryText.length > ANALYSIS_QUERY_MAX_CHARS;

  const canSubmit = useMemo(() => {
    return Boolean(workspaceId && trimmedQueryText.length > 0 && corridorGeojson && !isQueryTooLong);
  }, [workspaceId, trimmedQueryText, corridorGeojson, isQueryTooLong]);

  const runAnalysis = async () => {
    if (!corridorGeojson || !workspaceId || !trimmedQueryText) {
      setError("Workspace ID, corridor, and query are required.");
      return;
    }

    if (isQueryTooLong) {
      setError(`Query must be ${ANALYSIS_QUERY_MAX_CHARS} characters or fewer.`);
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          queryText: trimmedQueryText,
          corridorGeojson,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: unknown };
        throw new Error(payload.error ?? "Analysis request failed.");
      }

      const payload = (await response.json()) as AnalysisResult;
      setAnalysisResult({
        ...payload,
        title: buildRunTitle(trimmedQueryText),
        createdAt: new Date().toISOString(),
      });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Analysis request failed.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const bootstrapWorkspace = async () => {
    const trimmedName = bootstrapWorkspaceName.trim();

    if (!trimmedName) {
      setError("Enter a workspace name to bootstrap your pilot environment.");
      return;
    }

    setError("");
    setIsBootstrappingWorkspace(true);

    try {
      const response = await fetch("/api/workspaces/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceName: trimmedName, plan: "pilot" }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Workspace bootstrap failed.");
      }

      const payload = (await response.json()) as WorkspaceBootstrapResponse;
      setWorkspaceId(payload.workspaceId);
      setWorkspaceName(trimmedName);
      setWorkspaceRole("owner");
      setWorkspaceLoadState("loaded");
      setBootstrapChecklist(payload.onboardingChecklist ?? []);
      setBootstrapWorkspaceName("");
    } catch (bootstrapError) {
      const message = bootstrapError instanceof Error ? bootstrapError.message : "Workspace bootstrap failed.";
      setError(message);
    } finally {
      setIsBootstrappingWorkspace(false);
    }
  };

  const { comparisonRun, loadRun, compareRun, clearComparison } = useExploreRunHistory({
    workspaceId,
    analysisResult,
    setAnalysisResult,
    setQueryText,
    setCorridorGeojson,
    setError,
    setTractMetric,
    setShowTracts,
    setShowCrashes,
    setCrashSeverityFilter,
    setCrashUserFilter,
    setActiveDatasetOverlayId,
  });

  const generateReport = async () => {
    if (!analysisResult?.runId) {
      setError("Run an analysis before generating a report.");
      return;
    }

    setError("");
    setIsGeneratingReport(true);

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: analysisResult.runId,
          template: reportTemplate,
          mapViewState: currentMapViewState,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Report generation failed.");
      }

      const html = await response.text();
      const reportWindow = window.open("", "_blank");
      if (!reportWindow) {
        throw new Error("Popup blocked. Allow popups to view the report.");
      }
      reportWindow.document.open();
      reportWindow.document.write(html);
      reportWindow.document.close();
    } catch (reportError) {
      const message = reportError instanceof Error ? reportError.message : "Report generation failed.";
      setError(message);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const downloadPdfReport = async () => {
    if (!analysisResult?.runId) {
      setError("Run an analysis before downloading a report.");
      return;
    }

    setError("");
    setIsDownloadingPdf(true);

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: analysisResult.runId,
          format: "pdf",
          template: reportTemplate,
          mapViewState: currentMapViewState,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "PDF report generation failed.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition");
      const nameMatch = disposition?.match(/filename=\"([^\"]+)\"/i);
      const filename = nameMatch?.[1] ?? `openplan-report-${analysisResult.runId}.pdf`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (reportError) {
      const message = reportError instanceof Error ? reportError.message : "PDF report generation failed.";
      setError(message);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const activeDatasetOverlay = useMemo(
    () => resolveActiveDatasetOverlay(analysisContext, activeDatasetOverlayId),
    [analysisContext, activeDatasetOverlayId]
  );

  const currentMapViewState = useMemo<MapViewState>(
    () =>
      buildCurrentMapViewState({
        tractMetric,
        showTracts,
        showCrashes,
        crashSeverityFilter,
        crashUserFilter,
        activeDatasetOverlayId,
        activeDatasetOverlay,
      }),
    [
      tractMetric,
      showTracts,
      showCrashes,
      crashSeverityFilter,
      crashUserFilter,
      activeDatasetOverlayId,
      activeDatasetOverlay,
    ]
  );

  const workspaceHelperText = useMemo(
    () => resolveWorkspaceHelperText({ workspaceLoadState, workspaceName, workspaceRole }),
    [workspaceLoadState, workspaceName, workspaceRole]
  );

  const workspaceStatusLabel = useMemo(
    () => resolveWorkspaceStatusLabel(workspaceLoadState),
    [workspaceLoadState]
  );

  const crashPointFeatures = useMemo(
    () => getCrashPointFeatures(analysisResult),
    [analysisResult]
  );

  const crashPointCount = crashPointFeatures.length;

  const switrsPointLayerAvailable = hasSwitrsPointLayer(analysisResult, crashPointCount);

  useEffect(() => {
    if (!analysisResult?.runId) {
      return;
    }

    setAnalysisResult((current) => {
      if (!current || current.runId !== analysisResult.runId) {
        return current;
      }

      return {
        ...current,
        metrics: {
          ...current.metrics,
          mapViewState: currentMapViewState,
        },
      };
    });
  }, [analysisResult?.runId, currentMapViewState]);

  useEffect(() => {
    if (!analysisResult?.runId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetch("/api/runs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: analysisResult.runId,
          mapViewState: currentMapViewState,
        }),
      }).catch(() => {
        // Soft-fail: map view persistence should not interrupt active analysis work.
      });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [analysisResult?.runId, currentMapViewState]);

  useEffect(() => {
    if (!activeDatasetOverlayId) {
      return;
    }

    const stillExists = analysisContext?.linkedDatasets.some((dataset) => dataset.datasetId === activeDatasetOverlayId);
    if (!stillExists) {
      setActiveDatasetOverlayId(null);
    }
  }, [analysisContext, activeDatasetOverlayId]);

  const linkedDatasetPreview = getLinkedDatasetPreview(analysisContext);

  return (
    <section className="analysis-explore-shell grid min-h-[calc(100dvh-3rem)] gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="analysis-explore-mapstage relative min-h-[360px] overflow-hidden lg:min-h-0">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {!analysisResult ? (
          <div className="analysis-explore-map-intro absolute left-4 top-4 z-10 max-w-[min(84%,360px)] text-white sm:left-5 sm:top-5">
            <p className="text-[0.64rem] font-bold uppercase tracking-[0.2em] text-cyan-300/70">
              Analysis Studio
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
              Upload a corridor to begin.
            </h2>
            <p className="mt-1.5 text-[0.82rem] leading-relaxed text-slate-300/80">
              Draw or upload a study boundary, frame the planning question, and run the analysis.
            </p>
          </div>
        ) : null}
      </div>

      <aside className="analysis-explore-rail flex min-h-0 flex-col overflow-y-auto">
        <div className="analysis-explore-rail-header">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Analysis Studio</p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-white">Corridor analysis workspace</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300/78">Use the map on the left and the controls here to set the study area, compare conditions, and review outputs.</p>
        </div>
        <div className="space-y-5 px-5 py-4">
          <div className="space-y-3.5">
            <section className="analysis-studio-surface">
              <div className="analysis-studio-header">
                <div className="analysis-studio-heading">
                  <p className="analysis-studio-label">Study setup</p>
                  <h3 className="analysis-studio-title">Workspace and intake</h3>
                  <p className="analysis-studio-description">Connect the workspace, confirm membership, and prepare the corridor boundary before running analysis.</p>
                </div>
                <StatusBadge tone={resolveStatusTone(workspaceLoadState)}>{workspaceStatusLabel}</StatusBadge>
              </div>

              <div className="analysis-studio-body">
                {workspaceLoadState === "loading" ? (
                  <p className="analysis-studio-note">Connecting to workspace…</p>
                ) : workspaceLoadState === "loaded" && workspaceName ? (
                  <p className="analysis-studio-note">
                    Connected to <strong className="text-white">{workspaceName}</strong>
                  </p>
                ) : (
                  <p className="analysis-studio-note">{workspaceHelperText}</p>
                )}

                {workspaceLoadState === "signedOut" ? (
                  <div className="analysis-sidepanel-row is-muted">
                    <div className="analysis-sidepanel-head">
                      <div className="analysis-sidepanel-main">
                        <p className="analysis-sidepanel-title">Authentication required</p>
                        <p className="analysis-sidepanel-body">Authenticate to access your workspace automatically.</p>
                      </div>
                      <div className="analysis-sidepanel-actions">
                        <Button asChild size="sm" variant="outline">
                          <Link href="/sign-in">Sign in</Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link href="/sign-up">Create account</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {workspaceLoadState === "noMembership" ? (
                  <div className="analysis-sidepanel-row is-warning">
                    <div className="analysis-sidepanel-main">
                      <p className="analysis-sidepanel-title">Create the first workspace</p>
                      <p className="analysis-sidepanel-body">No workspace membership detected. Create a workspace to start using Analysis Studio.</p>
                    </div>
                    <div className="analysis-studio-input-stack">
                      <Input
                        value={bootstrapWorkspaceName}
                        onChange={(event) => setBootstrapWorkspaceName(event.target.value)}
                        placeholder="Example: Nevada County Workspace"
                      />
                      <div className="analysis-studio-action-row">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void bootstrapWorkspace()}
                          disabled={isBootstrappingWorkspace}
                        >
                          {isBootstrappingWorkspace ? "Creating workspace..." : "Create workspace"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {bootstrapChecklist.length > 0 ? (
                  <div className="analysis-studio-inline-meta">
                    <p className="analysis-studio-inline-meta-label">Pilot onboarding checklist</p>
                    <ul className="analysis-studio-checklist">
                      {bootstrapChecklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>

            <div className="module-section-surface analysis-explore-context-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Project context</p>
                  <p className="module-section-description">
                    {analysisContextLoadState === "loading"
                      ? "Loading project and dataset context…"
                      : analysisContext?.project
                        ? "Projects and Data Hub are now visible from Analysis Studio."
                        : analysisContextLoadState === "error"
                          ? "Project context is temporarily unavailable."
                          : "No project is attached to this workspace yet."}
                  </p>
                </div>
                {analysisContext?.project ? (
                  <div className="module-record-actions">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/projects/${analysisContext.project.id}`}>Open Project</Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link href="/data-hub">Open Data Hub</Link>
                    </Button>
                  </div>
                ) : null}
              </div>

              {analysisContext?.project ? (
                <div className="mt-5 space-y-4">
                  <article className="module-record-row is-selected">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone={resolveStatusTone(analysisContext.project.status)}>
                            {titleize(analysisContext.project.status)}
                          </StatusBadge>
                          <StatusBadge tone="info">{titleize(analysisContext.project.planType)}</StatusBadge>
                          <StatusBadge tone="neutral">{titleize(analysisContext.project.deliveryPhase)}</StatusBadge>
                        </div>
                        <p className="module-record-title">{analysisContext.project.name}</p>
                        <p className="module-record-summary">
                          {analysisContext.project.summary || "Project record exists, but it still needs a richer summary."}
                        </p>
                      </div>
                    </div>
                  </article>

                  <div className="module-record-detail-grid cols-3">
                    <div className="module-subpanel">
                      <p className="module-section-label">Project records</p>
                      <p className="module-summary-value">
                        {analysisContext.counts.deliverables + analysisContext.counts.risks + analysisContext.counts.issues + analysisContext.counts.decisions + analysisContext.counts.meetings}
                      </p>
                      <p className="module-summary-detail">Deliverables, risks, issues, decisions, meetings</p>
                    </div>
                    <div className="module-subpanel">
                      <p className="module-section-label">Linked datasets</p>
                      <p className="module-summary-value">{analysisContext.counts.linkedDatasets}</p>
                      <p className="module-summary-detail">
                        {analysisContext.migrationPending
                          ? "Data Hub schema still pending in this database"
                          : `${analysisContext.counts.overlayReadyDatasets} overlay-ready for map work`}
                      </p>
                    </div>
                    <div className="module-subpanel">
                      <p className="module-section-label">Recent runs</p>
                      <p className="module-summary-value">{analysisContext.counts.recentRuns}</p>
                      <p className="module-summary-detail">Latest analysis history for this workspace</p>
                    </div>
                  </div>

                  <WorkspaceRuntimeCue
                    summary={analysisContext.operationsSummary}
                    className="mt-4 border-white/10 bg-white/[0.05] text-white/82"
                  />

                  <WorkspaceCommandBoard
                    summary={analysisContext.operationsSummary}
                    label="Workspace command board"
                    title="What should move around this analysis workspace"
                    description="Analysis Studio now inherits the same shared workspace command queue as the rest of the runtime, so packet pressure, funding windows, and setup gaps stay visible while you work corridor and map analysis."
                  />

                  {analysisContext.migrationPending ? (
                    <div className="module-alert text-xs">
                      Data Hub is wired into Analysis Studio, but the current database still needs the latest migration before linked datasets can fully appear here.
                    </div>
                  ) : linkedDatasetPreview.length > 0 ? (
                    <div className="space-y-3">
                      <div>
                        <p className="module-section-label">Map-linked dataset queue</p>
                        <p className="module-summary-detail mt-1">
                          Select a dataset to compare coverage vs thematic states without leaving the analysis panel.
                        </p>
                      </div>
                      <div className="module-record-list">
                        {linkedDatasetPreview.map((dataset) => {
                          const canRenderCoverage = canRenderDatasetCoverageOverlay(dataset);
                          const isActiveOverlay = activeDatasetOverlayId === dataset.datasetId;
                          const thematicReady = canRenderDatasetThematicOverlay(dataset);
                          const geometryLabel =
                            dataset.geometryAttachment === "analysis_corridor"
                              ? "corridor"
                              : dataset.geometryAttachment === "analysis_crash_points"
                                ? "crash-point"
                                : "tract";

                          return (
                            <article
                              key={dataset.datasetId}
                              className={[
                                "module-record-row",
                                canRenderCoverage ? "is-interactive" : "",
                                isActiveOverlay ? "is-selected" : thematicReady ? "is-comparison" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <div className="module-record-head">
                                <div className="module-record-main">
                                  <div className="module-record-kicker">
                                    <StatusBadge tone={resolveStatusTone(dataset.status)}>{titleize(dataset.status)}</StatusBadge>
                                    <StatusBadge tone="info">{titleize(dataset.relationshipType)}</StatusBadge>
                                    <StatusBadge tone={dataset.overlayReady ? "success" : "neutral"}>
                                      {dataset.overlayReady ? "Overlay-ready" : "Registry-only"}
                                    </StatusBadge>
                                    {thematicReady ? <StatusBadge tone="warning">Thematic-ready</StatusBadge> : null}
                                  </div>
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <p className="module-record-title">{dataset.name}</p>
                                    <p className="module-record-stamp">
                                      {dataset.lastRefreshedAt ? `Refreshed ${formatRunTimestamp(dataset.lastRefreshedAt)}` : "Refresh pending"}
                                    </p>
                                  </div>
                                  <p className="module-record-summary">
                                    {thematicReady
                                      ? `Uses real ${geometryLabel} geometry + ${dataset.thematicMetricLabel ?? titleize(dataset.thematicMetricKey)}.`
                                      : dataset.overlayReady
                                        ? "Coverage footprint only — dataset values stay honest until a thematic binding exists."
                                        : "Registry record only for now; geometry attachment is not drawable yet."}
                                  </p>
                                  <div className="module-record-meta">
                                    <span className="module-record-chip">Scope {titleize(dataset.geographyScope)}</span>
                                    <span className="module-record-chip">Source {dataset.connectorLabel ?? "Manual source"}</span>
                                    {dataset.vintageLabel ? <span className="module-record-chip">Vintage {dataset.vintageLabel}</span> : null}
                                    {dataset.thematicMetricLabel ? <span className="module-record-chip">Metric {dataset.thematicMetricLabel}</span> : null}
                                  </div>
                                </div>

                                <div className="module-record-actions">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={isActiveOverlay ? "secondary" : "outline"}
                                    disabled={!canRenderCoverage}
                                    onClick={() =>
                                      setActiveDatasetOverlayId((current) =>
                                        current === dataset.datasetId ? null : dataset.datasetId
                                      )
                                    }
                                  >
                                    {isActiveOverlay
                                      ? thematicReady
                                        ? "Hide thematic"
                                        : "Hide coverage"
                                      : canRenderCoverage
                                        ? thematicReady
                                          ? "Show thematic"
                                          : "Show coverage"
                                        : "Not drawable"}
                                  </Button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="module-empty-state text-xs">
                      No project-linked datasets yet. Register sources in Data Hub to start building real overlay lanes instead of hidden analysis assumptions.
                    </div>
                  )}
                </div>
              ) : analysisContextLoadState === "error" ? (
                <p className="mt-3 text-xs text-muted-foreground">Could not load project context from the workspace right now.</p>
              ) : null}
            </div>
            <div className="analysis-studio-surface-slot">
              <CorridorUpload onUpload={(geojson) => setCorridorGeojson(geojson)} />
            </div>

            <ExploreLayerVisibilityControls
              mapReady={mapReady}
              showPolygonFill={showPolygonFill}
              onTogglePolygonFill={() => setShowPolygonFill((v) => !v)}
              showTracts={showTracts}
              onToggleTracts={() => setShowTracts((v) => !v)}
              showCrashes={showCrashes}
              onToggleCrashes={() => setShowCrashes((v) => !v)}
              switrsPointLayerAvailable={switrsPointLayerAvailable}
              tractMetric={tractMetric}
              onChangeTractMetric={(value) => setTractMetric(value)}
            />

            <ExploreHoverInspector
              showTracts={showTracts}
              switrsPointLayerAvailable={switrsPointLayerAvailable}
              tractMetric={tractMetric}
              hoveredTract={hoveredTract}
              hoveredCrash={hoveredCrash}
              crashSeverityFilter={crashSeverityFilter}
              crashUserFilter={crashUserFilter}
            />

            <ExploreStudyBriefControls
              queryText={queryText}
              isQueryTooLong={isQueryTooLong}
              reportTemplate={reportTemplate}
              canSubmit={canSubmit}
              isSubmitting={isSubmitting}
              analysisRunId={analysisResult?.runId ?? null}
              isGeneratingReport={isGeneratingReport}
              isDownloadingPdf={isDownloadingPdf}
              error={error}
              onQueryTextChange={setQueryText}
              onReportTemplateChange={setReportTemplate}
              onRunAnalysis={runAnalysis}
              onGenerateReport={generateReport}
              onDownloadPdfReport={downloadPdfReport}
            />
          </div>
        </div>

        <ExploreResultsBoard
          analysisResult={analysisResult}
          comparisonRun={comparisonRun}
          queryText={queryText}
          currentMapViewState={currentMapViewState}
          onClearComparison={clearComparison}
          onError={setError}
        />

        <ExploreRunHistoryPanel
          workspaceId={workspaceId}
          analysisResult={analysisResult}
          comparisonRun={comparisonRun}
          queryText={queryText}
          onLoadRun={loadRun}
          onCompareRun={compareRun}
          onClearComparison={clearComparison}
        />
      </aside>
    </section>
  );
}
