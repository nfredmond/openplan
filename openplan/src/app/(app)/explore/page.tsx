"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import mapboxgl, {
  FullscreenControl,
  LngLatBoundsLike,
  Map,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
} from "mapbox-gl";
import { CorridorUpload } from "@/components/corridor/CorridorUpload";
import type { Run } from "@/components/runs/RunHistory";
import { RunHistory } from "@/components/runs/RunHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Layers3, Map as MapIcon, Sparkles } from "lucide-react";
import { buildMetricDeltas, deltaTone, formatDelta } from "@/lib/analysis/compare";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { ANALYSIS_QUERY_MAX_CHARS } from "@/lib/analysis/query";
import { downloadGeojson, downloadMetricsCsv } from "@/lib/export/download";
import { resolveStatusTone, toneFromDelta, type StatusTone } from "@/lib/ui/status";

type Position = [number, number] | [number, number, number];

type Polygon = {
  type: "Polygon";
  coordinates: Position[][];
};

type MultiPolygon = {
  type: "MultiPolygon";
  coordinates: Position[][][];
};

type CorridorGeometry = Polygon | MultiPolygon;

type AnalysisResult = {
  runId: string;
  metrics: {
    accessibilityScore: number;
    safetyScore: number;
    equityScore: number;
    overallScore?: number;
    confidence?: string;
    totalTransitStops?: number;
    transitAccessTier?: string;
    totalPopulation?: number;
    medianIncome?: number | null;
    pctMinority?: number;
    pctBelowPoverty?: number;
    pctTransit?: number;
    pctWalk?: number;
    pctBike?: number;
    pctZeroVehicle?: number;
    totalFatalCrashes?: number;
    totalFatalities?: number;
    crashesPerSquareMile?: number;
    jobsPerResident?: number;
    stopsPerSquareMile?: number;
    walkBikeAccessTier?: string;
    dataQuality?: {
      censusAvailable?: boolean;
      crashDataAvailable?: boolean;
      lodesSource?: string;
      equitySource?: string;
      aiInterpretationSource?: string;
    };
    sourceSnapshots?: {
      census?: {
        source?: string;
        dataset?: string;
        vintage?: string;
        geography?: string;
        tractCount?: number;
        retrievalUrl?: string;
        fetchedAt?: string;
      };
      lodes?: { source?: string; note?: string; fetchedAt?: string };
      transit?: { source?: string; note?: string; fetchedAt?: string };
      crashes?: { source?: string; yearsQueried?: number[]; note?: string; fetchedAt?: string };
      equity?: { source?: string; note?: string; fetchedAt?: string };
    };
    aiInterpretationSource?: string;
    [key: string]: unknown;
  };
  geojson: GeoJSON.FeatureCollection;
  summary: string;
  aiInterpretation?: string;
  aiInterpretationSource?: string;
};

type CurrentWorkspaceResponse = {
  workspaceId: string;
  name: string | null;
  role: string;
};

type WorkspaceBootstrapResponse = {
  workspaceId: string;
  slug: string;
  plan: string;
  onboardingChecklist: string[];
};

type WorkspaceLoadState = "loading" | "loaded" | "signedOut" | "noMembership" | "error";
type ReportTemplate = "atp" | "ss4a";

const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

function collectPositions(geometry: CorridorGeometry): Position[] {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }

  return geometry.coordinates.flat(2);
}

function getBoundsFromGeometry(geometry: CorridorGeometry): LngLatBoundsLike | null {
  const positions = collectPositions(geometry);

  if (!positions.length) {
    return null;
  }

  let minLng = positions[0][0];
  let minLat = positions[0][1];
  let maxLng = positions[0][0];
  let maxLat = positions[0][1];

  positions.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function formatRunTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatSourceToken(value: string | undefined): string {
  if (!value) return "Unknown";
  return value
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ExplorePage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  const [workspaceId, setWorkspaceId] = useState("");
  const [queryText, setQueryText] = useState("");
  const [corridorGeojson, setCorridorGeojson] = useState<CorridorGeometry | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [comparisonRun, setComparisonRun] = useState<Run | null>(null);
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
  const [mapReady, setMapReady] = useState(false);
  const [showPolygonFill, setShowPolygonFill] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [showTracts, setShowTracts] = useState(true);
  const [cameraMode, setCameraMode] = useState<"regional" | "cinematic">("regional");
  const [tractMetric, setTractMetric] = useState<"minority" | "poverty" | "income" | "disadvantaged">("minority");

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-121.5, 39.2],
      zoom: 5.1,
      pitch: 36,
      bearing: -10,
      antialias: true,
      attributionControl: false,
    });

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

  const trimmedQueryText = queryText.trim();
  const queryCharacterCount = queryText.length;
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
      setAnalysisResult(payload);
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

  const loadRun = useCallback(
    (run: Run) => {
      setQueryText(run.query_text);

      if (run.corridor_geojson) {
        setCorridorGeojson(run.corridor_geojson as CorridorGeometry);
      }

      if (!run.metrics || !run.result_geojson || !run.summary_text) {
        setError("Selected run is missing result data and cannot be loaded.");
        return;
      }

      if (comparisonRun?.id === run.id) {
        setComparisonRun(null);
      }

      setError("");
      const runMetrics = run.metrics as AnalysisResult["metrics"];

      setAnalysisResult({
        runId: run.id,
        metrics: runMetrics,
        geojson: run.result_geojson,
        summary: run.summary_text,
        aiInterpretation: run.ai_interpretation ?? undefined,
        aiInterpretationSource:
          (typeof runMetrics.aiInterpretationSource === "string" && runMetrics.aiInterpretationSource) ||
          (typeof runMetrics.dataQuality?.aiInterpretationSource === "string" && runMetrics.dataQuality?.aiInterpretationSource) ||
          (run.ai_interpretation ? "ai" : "fallback"),
      });
    },
    [comparisonRun?.id]
  );

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
        body: JSON.stringify({ runId: analysisResult.runId, template: reportTemplate }),
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
        body: JSON.stringify({ runId: analysisResult.runId, format: "pdf", template: reportTemplate }),
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

  const exportMetrics = () => {
    if (!analysisResult) {
      return;
    }

    try {
      downloadMetricsCsv(analysisResult.metrics, `openplan-${analysisResult.runId}-metrics.csv`);
    } catch {
      setError("Failed to export metrics CSV.");
    }
  };

  const exportGeojson = () => {
    if (!analysisResult) {
      return;
    }

    try {
      downloadGeojson(analysisResult.geojson, `openplan-${analysisResult.runId}-result.geojson`);
    } catch {
      setError("Failed to export result GeoJSON.");
    }
  };

  const compareRun = useCallback(
    (run: Run) => {
      if (!analysisResult) {
        setError("Load or run an analysis first, then choose a comparison run.");
        return;
      }

      if (run.id === analysisResult.runId) {
        setError("Choose a different run to compare.");
        return;
      }

      if (!run.metrics) {
        setError("Selected run has no metrics available for comparison.");
        return;
      }

      setError("");
      setComparisonRun(run);
    },
    [analysisResult]
  );

  const comparisonDeltas = useMemo(() => {
    if (!analysisResult || !comparisonRun?.metrics) {
      return [];
    }

    return buildMetricDeltas(analysisResult.metrics, comparisonRun.metrics);
  }, [analysisResult, comparisonRun]);

  const sourceTransparency = useMemo(() => {
    if (!analysisResult) {
      return [];
    }

    return buildSourceTransparency(analysisResult.metrics, analysisResult.aiInterpretationSource);
  }, [analysisResult]);

  const planningSignals = useMemo(() => {
    if (!analysisResult) {
      return [] as Array<{ label: string; value: string; note: string }>;
    }

    return [
      {
        label: "Population",
        value: typeof analysisResult.metrics.totalPopulation === "number" ? analysisResult.metrics.totalPopulation.toLocaleString() : "N/A",
        note: "Census tract population intersecting the corridor bounding area.",
      },
      {
        label: "Median income",
        value: formatCurrency(analysisResult.metrics.medianIncome as number | null | undefined),
        note: "Weighted ACS household income for corridor-context tracts.",
      },
      {
        label: "Transit mode share",
        value: typeof analysisResult.metrics.pctTransit === "number" ? `${analysisResult.metrics.pctTransit}%` : "N/A",
        note: "Transit share of commute trips from corridor-context tracts.",
      },
      {
        label: "Zero-vehicle households",
        value: typeof analysisResult.metrics.pctZeroVehicle === "number" ? `${analysisResult.metrics.pctZeroVehicle}%` : "N/A",
        note: "Households with no vehicle access, used as an equity / accessibility signal.",
      },
      {
        label: "Stops / sq mi",
        value: typeof analysisResult.metrics.stopsPerSquareMile === "number" ? `${analysisResult.metrics.stopsPerSquareMile}` : "N/A",
        note: "Transit stop density from current transit access proxy layer.",
      },
      {
        label: "Crash intensity",
        value: typeof analysisResult.metrics.crashesPerSquareMile === "number" ? `${analysisResult.metrics.crashesPerSquareMile}/sq mi` : "N/A",
        note: "Crash density from the active crash source or fallback estimator.",
      },
    ];
  }, [analysisResult]);

  const sourceSnapshots = analysisResult?.metrics.sourceSnapshots;

  const geospatialSourceCards = useMemo(() => {
    if (!analysisResult) {
      return [] as Array<{ label: string; status: string; detail: string; tone: StatusTone }>;
    }

    const cards: Array<{ label: string; status: string; detail: string; tone: StatusTone }> = [
      {
        label: "Census / ACS",
        status: sourceSnapshots?.census?.dataset ? `${sourceSnapshots.census.dataset} ${sourceSnapshots.census.vintage ?? ""}`.trim() : "Configured",
        detail:
          sourceSnapshots?.census?.retrievalUrl
            ? `Geography: ${sourceSnapshots.census.geography ?? "tract"} · ${sourceSnapshots.census.tractCount ?? 0} tracts · ${sourceSnapshots.census.retrievalUrl}`
            : "Census connector is configured but retrieval metadata is missing.",
        tone: analysisResult.metrics.dataQuality?.censusAvailable ? "success" : "warning",
      },
      {
        label: "Transit access",
        status: formatSourceToken(sourceSnapshots?.transit?.source),
        detail: sourceSnapshots?.transit?.note ?? "Transit access proxy metadata not available.",
        tone: sourceSnapshots?.transit?.source === "osm-overpass" ? "info" : "warning",
      },
      {
        label: "Crash safety",
        status: formatSourceToken(sourceSnapshots?.crashes?.source),
        detail: sourceSnapshots?.crashes?.note ?? "Crash metadata not available.",
        tone:
          sourceSnapshots?.crashes?.source === "switrs-local"
            ? "success"
            : sourceSnapshots?.crashes?.source === "fars-api"
              ? "info"
              : "warning",
      },
      {
        label: "Employment / LODES",
        status: formatSourceToken(sourceSnapshots?.lodes?.source),
        detail: sourceSnapshots?.lodes?.note ?? "Employment source metadata not available.",
        tone: sourceSnapshots?.lodes?.source === "lodes-api" ? "success" : "info",
      },
      {
        label: "Equity screening",
        status: formatSourceToken(sourceSnapshots?.equity?.source),
        detail: sourceSnapshots?.equity?.note ?? "Equity screening metadata not available.",
        tone: "info",
      },
    ];

    return cards;
  }, [analysisResult, sourceSnapshots]);

  const workspaceHelperText = useMemo(() => {
    if (workspaceLoadState === "loading") {
      return "Checking your default workspace and permissions...";
    }

    if (workspaceLoadState === "signedOut") {
      return "You are signed out. Enter a workspace ID manually, or sign in to continue.";
    }

    if (workspaceLoadState === "noMembership") {
      return "Signed in, but no workspace membership was detected. Enter a workspace ID manually.";
    }

    if (workspaceLoadState === "loaded") {
      const displayName = workspaceName ?? "workspace";
      const role = workspaceRole ?? "member";
      return `Connected to ${displayName} (${role}). You can override the workspace ID if needed.`;
    }

    return "Unable to auto-load a workspace right now. Enter a workspace ID manually.";
  }, [workspaceLoadState, workspaceName, workspaceRole]);

  const workspaceStatusLabel = useMemo(() => {
    if (workspaceLoadState === "loading") {
      return "Loading";
    }

    if (workspaceLoadState === "loaded") {
      return "Workspace loaded";
    }

    if (workspaceLoadState === "signedOut") {
      return "Signed out";
    }

    if (workspaceLoadState === "noMembership") {
      return "No membership";
    }

    return "Connection issue";
  }, [workspaceLoadState]);

  const mapExperienceReady = MAPBOX_ACCESS_TOKEN.length > 0;
  const mapSummaryBadges = [
    `Map engine: ${mapExperienceReady ? (mapReady ? "Mapbox live" : "Mapbox booting") : "Awaiting Mapbox token"}`,
    `Data overlays: ${analysisResult ? "Live analysis result" : "Ready for upload"}`,
    `Census connector: ${analysisResult?.metrics.dataQuality?.censusAvailable ? "Available" : "Configured path"}`,
  ];

  return (
    <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
      <div className="relative overflow-hidden rounded-[30px] border border-slate-800/80 bg-[linear-gradient(180deg,#08111a_0%,#0d1722_100%)] shadow-[0_28px_80px_rgba(3,10,18,0.28)]">
        <div ref={mapContainerRef} className="h-[620px] w-full" />

        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(5,10,15,0.88),rgba(5,10,15,0))]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-[linear-gradient(0deg,rgba(5,10,15,0.94),rgba(5,10,15,0))]" />

        <div className="absolute left-4 top-4 z-10 max-w-[min(88%,420px)] rounded-[26px] border border-white/10 bg-[rgba(7,14,20,0.84)] p-4 text-white shadow-[0_24px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:left-5 sm:top-5 sm:p-5">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-200/85">
            <Sparkles className="h-3.5 w-3.5" />
            Geospatial Intelligence Surface
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[1.7rem]">
            Analysis Studio is moving onto a real planning map experience.
          </h2>
          <p className="mt-2 text-sm text-slate-300/86">
            This pass replaces the old demo-tile feel with a Mapbox-first foundation, richer layer styling, better operator chrome, and a cleaner path toward public engagement, Census overlays, and safety data.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {mapSummaryBadges.map((badge) => (
              <span key={badge} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-200/88">
                {badge}
              </span>
            ))}
          </div>
        </div>

        <div className="absolute right-4 top-4 z-10 flex max-w-[min(88%,320px)] flex-wrap justify-end gap-2 sm:right-5 sm:top-5">
          <button
            type="button"
            onClick={() => setShowPolygonFill((value) => !value)}
            className="rounded-full border border-white/10 bg-[rgba(7,14,20,0.82)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl transition hover:border-white/20"
          >
            {showPolygonFill ? "Hide polygon fill" : "Show polygon fill"}
          </button>
          <button
            type="button"
            onClick={() => setShowPoints((value) => !value)}
            className="rounded-full border border-white/10 bg-[rgba(7,14,20,0.82)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl transition hover:border-white/20"
          >
            {showPoints ? "Hide points" : "Show points"}
          </button>
          <button
            type="button"
            onClick={() => setShowTracts((value) => !value)}
            className="rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100 shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl transition hover:border-sky-200/30"
          >
            {showTracts ? "Hide tracts" : "Show tracts"}
          </button>
          <button
            type="button"
            onClick={() => setCameraMode((mode) => (mode === "regional" ? "cinematic" : "regional"))}
            className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100 shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl transition hover:border-emerald-200/30"
          >
            Camera: {cameraMode === "regional" ? "Regional" : "Cinematic"}
          </button>
        </div>

        <div className="absolute bottom-4 left-4 z-10 max-w-[min(88%,360px)] rounded-[24px] border border-white/10 bg-[rgba(7,14,20,0.86)] p-4 text-white shadow-[0_20px_54px_rgba(0,0,0,0.26)] backdrop-blur-xl sm:bottom-5 sm:left-5">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-300/80">
            <Layers3 className="h-3.5 w-3.5" />
            Map layers and posture
          </div>
          <div className="mt-3 grid gap-2 text-sm text-slate-300/84">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
              <span>Corridor geometry</span>
              <StatusBadge tone={corridorGeojson ? "success" : "neutral"}>{corridorGeojson ? "Loaded" : "Waiting"}</StatusBadge>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
              <span>Analysis result layer</span>
              <StatusBadge tone={analysisResult ? "success" : "neutral"}>{analysisResult ? "Live" : "Idle"}</StatusBadge>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
              <span>Census tracts</span>
              <StatusBadge tone={showTracts && analysisResult ? "success" : "neutral"}>{showTracts && analysisResult ? "Visible" : "Hidden / waiting"}</StatusBadge>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span>Tract theme</span>
                <StatusBadge tone="info">{tractMetric}</StatusBadge>
              </div>
              <select
                value={tractMetric}
                onChange={(event) => setTractMetric(event.target.value as typeof tractMetric)}
                className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none"
              >
                <option value="minority">Minority share</option>
                <option value="poverty">Poverty share</option>
                <option value="income">Median income</option>
                <option value="disadvantaged">Disadvantaged flag</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
              <span>Map engine</span>
              <StatusBadge tone={mapExperienceReady ? "success" : "warning"}>{mapExperienceReady ? "Mapbox" : "Token needed"}</StatusBadge>
            </div>
          </div>
        </div>

        <div className="absolute bottom-4 right-4 z-10 max-w-[min(88%,300px)] rounded-[24px] border border-white/10 bg-[rgba(7,14,20,0.86)] p-4 text-white shadow-[0_20px_54px_rgba(0,0,0,0.26)] backdrop-blur-xl sm:bottom-5 sm:right-5">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-300/80">
            <MapIcon className="h-3.5 w-3.5" />
            Planning signal
          </div>
          {!mapExperienceReady ? (
            <p className="mt-3 text-sm text-amber-100/88">
              Add <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.72rem]">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to activate the production map experience.
            </p>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-slate-300/84">
              <p>Mapbox foundation is active for a better desktop planning experience.</p>
              <p>Next geospatial wave: project overlays, Census choropleths, engagement pins, and SWITRS-linked safety layers.</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Analysis Studio Control Panel</CardTitle>
            <CardDescription>Upload a corridor, frame the planning question, and drive the map, metrics, and reporting workflow from one operator surface.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <Input
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="Workspace UUID"
            />
            <div className="space-y-2">
              <StatusBadge tone={resolveStatusTone(workspaceLoadState)}>{workspaceStatusLabel}</StatusBadge>
              <p className="text-xs text-muted-foreground">{workspaceHelperText}</p>
            </div>

            {workspaceLoadState === "signedOut" ? (
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Authenticate to access your workspace automatically.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/sign-in">Sign in</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/sign-up">Create account</Link>
                  </Button>
                </div>
              </div>
            ) : null}

            {workspaceLoadState === "noMembership" ? (
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3 space-y-2.5">
                <p className="text-xs text-muted-foreground">
                  No workspace membership detected. Bootstrap a pilot workspace in under 10 minutes.
                </p>
                <Input
                  value={bootstrapWorkspaceName}
                  onChange={(event) => setBootstrapWorkspaceName(event.target.value)}
                  placeholder="Example: Nevada County Pilot Workspace"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void bootstrapWorkspace()}
                  disabled={isBootstrappingWorkspace}
                >
                  {isBootstrappingWorkspace ? "Bootstrapping workspace..." : "Create Pilot Workspace"}
                </Button>
              </div>
            ) : null}

            {bootstrapChecklist.length > 0 ? (
              <div className="rounded-xl border border-border/80 bg-background p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pilot Onboarding Checklist</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
                  {bootstrapChecklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <CorridorUpload onUpload={(geojson) => setCorridorGeojson(geojson)} />
            <div className="space-y-1.5">
              <Textarea
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="Example: Evaluate transit accessibility, safety risk, and equity implications for this corridor."
                rows={4}
                maxLength={ANALYSIS_QUERY_MAX_CHARS}
              />
              <p className="text-[0.72rem] text-muted-foreground">
                Query length: {queryCharacterCount}/{ANALYSIS_QUERY_MAX_CHARS} characters.
              </p>
              {isQueryTooLong ? (
                <p className="text-[0.72rem] text-destructive">
                  Trim the prompt before running analysis.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Report template</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={reportTemplate === "atp" ? "secondary" : "outline"}
                  onClick={() => setReportTemplate("atp")}
                >
                  ATP
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={reportTemplate === "ss4a" ? "secondary" : "outline"}
                  onClick={() => setReportTemplate("ss4a")}
                >
                  SS4A
                </Button>
                <StatusBadge tone="info">Current: {reportTemplate.toUpperCase()}</StatusBadge>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void runAnalysis()} disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Running analysis..." : "Run Analysis + Refresh Map"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void generateReport()}
                disabled={!analysisResult?.runId || isGeneratingReport}
              >
                {isGeneratingReport ? "Generating report..." : `Open ${reportTemplate.toUpperCase()} HTML Report`}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void downloadPdfReport()}
                disabled={!analysisResult?.runId || isDownloadingPdf}
              >
                {isDownloadingPdf ? "Preparing PDF..." : `Download ${reportTemplate.toUpperCase()} PDF`}
              </Button>
            </div>
            {error ? <ErrorState compact title="Please review" description={error} /> : null}
          </CardContent>
        </Card>

        {analysisResult ? (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Latest Analysis Result</CardTitle>
                <CardDescription>
                  {analysisResult.aiInterpretationSource === "ai"
                    ? "Interpretation includes AI-assisted narrative support (human review required)."
                    : "Interpretation generated from deterministic fallback logic."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Accessibility: {analysisResult.metrics.accessibilityScore}</Badge>
                  <Badge variant="outline">Safety: {analysisResult.metrics.safetyScore}</Badge>
                  <Badge variant="outline">Equity: {analysisResult.metrics.equityScore}</Badge>
                  {typeof analysisResult.metrics.overallScore === "number" ? (
                    <Badge variant="outline">Overall: {analysisResult.metrics.overallScore}</Badge>
                  ) : null}
                  {analysisResult.metrics.transitAccessTier ? (
                    <StatusBadge tone={resolveStatusTone(String(analysisResult.metrics.transitAccessTier))}>
                      Transit Access: {String(analysisResult.metrics.transitAccessTier)}
                    </StatusBadge>
                  ) : null}
                  {analysisResult.metrics.confidence ? (
                    <StatusBadge tone={resolveStatusTone(String(analysisResult.metrics.confidence))}>
                      Confidence: {String(analysisResult.metrics.confidence)}
                    </StatusBadge>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={exportMetrics}>
                    Export Metrics CSV
                  </Button>
                  <Button type="button" variant="outline" onClick={exportGeojson}>
                    Export Result GeoJSON
                  </Button>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</p>
                  <p className="text-sm text-foreground">{analysisResult.summary}</p>
                </div>

                {analysisResult.aiInterpretation ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Interpretation</p>
                    <p className="text-sm text-foreground">{analysisResult.aiInterpretation}</p>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source Transparency</p>
                  <div className="space-y-2">
                    {sourceTransparency.map((item) => (
                      <div key={item.key} className="rounded-xl border border-border/80 bg-background p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{item.label}</p>
                          <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">Run ID: {analysisResult.runId}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Geospatial Intelligence Briefing</CardTitle>
                <CardDescription>
                  Real corridor-context signals and source posture for planning, grant, and engagement workflows.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {planningSignals.map((signal) => (
                    <div key={signal.label} className="rounded-2xl border border-border/80 bg-background p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{signal.label}</p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{signal.value}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{signal.note}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-[26px] border border-border/80 bg-[linear-gradient(180deg,rgba(11,19,27,0.98),rgba(15,24,33,0.94))] p-5 text-slate-100 shadow-[0_20px_48px_rgba(0,0,0,0.16)]">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Data fabric status</p>
                    <div className="mt-4 space-y-3">
                      {geospatialSourceCards.map((item) => (
                        <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-white">{item.label}</p>
                            <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                          </div>
                          <p className="mt-2 text-xs text-slate-300/82">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-border/80 bg-background p-5 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Citations & next geospatial lanes</p>
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl border border-border/80 bg-card p-3.5">
                        <p className="text-sm font-medium text-foreground">Census retrieval</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {sourceSnapshots?.census?.retrievalUrl ?? "Census retrieval URL not captured for this run."}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Fetched: {sourceSnapshots?.census?.fetchedAt ? formatRunTimestamp(sourceSnapshots.census.fetchedAt) : "Unknown"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border/80 bg-card p-3.5">
                        <p className="text-sm font-medium text-foreground">Crash lane posture</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Current crash source: {formatSourceToken(sourceSnapshots?.crashes?.source)}.
                          {sourceSnapshots?.crashes?.source !== "switrs-local"
                            ? " SWITRS remains the preferred California-grade upgrade path for richer safety layers."
                            : " SWITRS-backed safety coverage is active for this corridor run."}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border/80 bg-card p-3.5">
                        <p className="text-sm font-medium text-foreground">Next layer buildout</p>
                        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                          <li>Census tract geometry + choropleth overlays</li>
                          <li>SWITRS collision point layer + severity filters</li>
                          <li>Project and engagement overlays tied into the Planning OS</li>
                          <li>CARTO workflow lane for derived spatial products and scheduled refreshes</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {comparisonRun && comparisonRun.metrics ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Run Comparison</CardTitle>
                  <CardDescription>
                    Current run vs baseline: {comparisonRun.title} ({formatRunTimestamp(comparisonRun.created_at)})
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {comparisonDeltas.map((delta) => {
                    const normalizedDelta = delta.delta ?? 0;
                    const directionTone = delta.delta === null ? "flat" : deltaTone(normalizedDelta);
                    const statusTone = delta.delta === null ? "neutral" : toneFromDelta(normalizedDelta);

                    return (
                      <div key={delta.key} className="rounded-xl border border-border/80 bg-background p-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{delta.label}</p>
                          <div className="flex items-center gap-2">
                            <StatusBadge tone={statusTone}>{directionTone === "flat" ? "No change" : directionTone === "up" ? "Up" : "Down"}</StatusBadge>
                            <p className="text-sm font-semibold text-foreground">
                              {formatDelta(delta.delta)}
                              {delta.deltaPct !== null ? ` (${formatDelta(delta.deltaPct)}%)` : ""}
                            </p>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Current: {delta.current ?? "N/A"} · Baseline: {delta.baseline ?? "N/A"}
                        </p>
                      </div>
                    );
                  })}

                  <div className="flex justify-end">
                    <Button type="button" variant="ghost" onClick={() => setComparisonRun(null)}>
                      Clear Comparison
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Methods, Assumptions &amp; AI Disclosure</CardTitle>
                <CardDescription>
                  Client-safe methodology notes for grant and planning workflows.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    AI is used to accelerate drafting and interpretation; final analysis and conclusions require human review and approval.
                  </li>
                  <li>
                    Regulatory and policy-sensitive claims should be citation-backed or explicitly marked for verification.
                  </li>
                  <li>
                    This run is based on available source data and proxy methods where direct sources are unavailable.
                  </li>
                  <li>
                    Recommendations should be checked for equity impacts and must not shift disproportionate burden onto disadvantaged communities.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>No analysis selected</CardTitle>
              <CardDescription>Run a corridor analysis or load a prior run to review metrics, narrative output, and comparisons.</CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState
                title="Ready for corridor analysis"
                description="Upload a corridor, enter your planning question, and run the analysis to generate results."
              />
            </CardContent>
          </Card>
        )}

        <RunHistory
          workspaceId={workspaceId}
          onLoadRun={loadRun}
          onCompareRun={compareRun}
          currentRunId={analysisResult?.runId}
          comparisonRunId={comparisonRun?.id}
        />
      </div>
    </section>
  );
}
