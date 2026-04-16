"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import mapboxgl, {
  FullscreenControl,
  LngLatBoundsLike,
  Map,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
} from "mapbox-gl";
import { CorridorUpload } from "@/components/corridor/CorridorUpload";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import type { Run } from "@/components/runs/RunHistory";
import { RunHistory } from "@/components/runs/RunHistory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
import { buildMetricDeltas, deltaTone, formatDelta, type MetricDelta } from "@/lib/analysis/compare";
import {
  formatCrashUserFilterLabel,
  normalizeMapViewState,
  summarizeMapViewState,
  titleizeMapViewValue,
  type CrashSeverityFilter,
  type CrashUserFilter,
  type MapViewState,
} from "@/lib/analysis/map-view-state";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { ANALYSIS_QUERY_MAX_CHARS } from "@/lib/analysis/query";
import { downloadGeojson, downloadMetricsCsv, downloadRecordsCsv, downloadText } from "@/lib/export/download";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";
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
  title?: string;
  createdAt?: string | null;
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
    crashPointCount?: number;
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
    mapViewState?: Partial<MapViewState>;
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

type AnalysisContextResponse = {
  workspaceId: string;
  project: {
    id: string;
    name: string;
    summary: string | null;
    status: string;
    planType: string;
    deliveryPhase: string;
    updatedAt: string;
  } | null;
  linkedDatasets: Array<{
    datasetId: string;
    name: string;
    status: string;
    geographyScope: string;
    geometryAttachment: string;
    thematicMetricKey: string | null;
    thematicMetricLabel: string | null;
    relationshipType: string;
    vintageLabel: string | null;
    lastRefreshedAt: string | null;
    connectorLabel: string | null;
    overlayReady: boolean;
    thematicReady: boolean;
  }>;
  migrationPending: boolean;
  counts: {
    deliverables: number;
    risks: number;
    issues: number;
    decisions: number;
    meetings: number;
    linkedDatasets: number;
    overlayReadyDatasets: number;
    recentRuns: number;
  };
  recentRuns: Array<{
    id: string;
    title: string;
    created_at: string;
  }>;
  operationsSummary: WorkspaceOperationsSummary;
};

type WorkspaceLoadState = "loading" | "loaded" | "signedOut" | "noMembership" | "error";
type AnalysisContextLoadState = "idle" | "loading" | "loaded" | "error";
type ReportTemplate = "atp" | "ss4a";

type HoveredTract = {
  name: string;
  geoid: string;
  population: number | null;
  medianIncome: number | null;
  pctMinority: number | null;
  pctBelowPoverty: number | null;
  zeroVehiclePct: number | null;
  transitCommutePct: number | null;
  isDisadvantaged: boolean;
};

type HoveredCrash = {
  severityLabel: string;
  collisionYear: number | null;
  fatalCount: number;
  injuryCount: number;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
};

type TractLegendItem = {
  label: string;
  color: string;
};

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

function titleize(value: string | null | undefined): string {
  return titleizeMapViewValue(value);
}

function formatSourceToken(value: string | undefined): string {
  if (!value) return "Unknown";
  return value
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const COMPARISON_HEADLINE_KEYS = new Set(["overallScore", "accessibilityScore", "safetyScore", "equityScore"]);
const MAP_CONTEXT_PRIORITY = [
  "Project overlay",
  "Crash filter",
  "Tract theme",
  "Overlay mode",
  "Overlay geometry",
  "Census tracts",
  "SWITRS lane",
] as const;

function buildRunTitle(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Untitled corridor analysis";
  }

  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

function prioritizeMapComparisonRows(
  rows: Array<{ label: string; current: string; baseline: string; changed: boolean }>
): Array<{ label: string; current: string; baseline: string; changed: boolean }> {
  const priority = new globalThis.Map<string, number>(MAP_CONTEXT_PRIORITY.map((label, index) => [label, index]));

  return [...rows].sort((left, right) => {
    if (left.changed !== right.changed) {
      return left.changed ? -1 : 1;
    }

    const leftPriority = priority.get(left.label) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priority.get(right.label) ?? Number.MAX_SAFE_INTEGER;

    return leftPriority - rightPriority || left.label.localeCompare(right.label);
  });
}

function getComparisonNarrativeLead(
  metricChangeCount: number,
  viewDifferenceCount: number
): { title: string; detail: string; tone: StatusTone } {
  if (metricChangeCount > 0 && viewDifferenceCount === 0) {
    return {
      title: "Metric movement is supported by aligned map posture.",
      detail: "Read the score shifts first — the current run and baseline were reviewed under the same tract, crash, and overlay context.",
      tone: "success",
    };
  }

  if (metricChangeCount > 0 && viewDifferenceCount > 0) {
    return {
      title: "Metric movement is present, but the evidence frame changed.",
      detail: "Check the map context before assuming every score change is a direct apples-to-apples comparison.",
      tone: "warning",
    };
  }

  if (metricChangeCount === 0 && viewDifferenceCount > 0) {
    return {
      title: "Scores are flat, but the evidence frame is not.",
      detail: "The score change looks small, but the underlying map layers differ between the current run and the baseline.",
      tone: "warning",
    };
  }

  return {
    title: "Both score movement and map posture are stable.",
    detail: "The current run and baseline are reading as materially aligned across both headline metrics and visible map context.",
    tone: "neutral",
  };
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

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return `${value}%`;
}

function canRenderDatasetCoverageOverlay(
  dataset: AnalysisContextResponse["linkedDatasets"][number] | null | undefined
): boolean {
  if (!dataset?.overlayReady) {
    return false;
  }

  return ["tract", "corridor", "route"].includes(dataset.geographyScope);
}

function canRenderDatasetThematicOverlay(
  dataset: AnalysisContextResponse["linkedDatasets"][number] | null | undefined
): boolean {
  return Boolean(
    dataset?.thematicReady &&
      (dataset.geographyScope === "tract" ||
        dataset.geographyScope === "corridor" ||
        dataset.geographyScope === "route" ||
        dataset.geographyScope === "point")
  );
}

function buildThematicOverlayPaintExpression(metricKey: string | null | undefined): ExpressionSpecification {
  if (metricKey === "pctBelowPoverty") {
    return [
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
    ];
  }

  if (metricKey === "medianIncome") {
    return [
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
    ];
  }

  if (metricKey === "isDisadvantaged") {
    return [
      "case",
      ["==", ["coalesce", ["to-number", ["get", "isDisadvantaged"]], 0], 1],
      "#ef4444",
      "#1f2937",
    ];
  }

  if (metricKey === "zeroVehiclePct") {
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "zeroVehiclePct"]], 0],
      0,
      "#172554",
      4,
      "#1d4ed8",
      8,
      "#0f766e",
      12,
      "#f59e0b",
      18,
      "#dc2626",
    ];
  }

  if (metricKey === "transitCommutePct") {
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "transitCommutePct"]], 0],
      0,
      "#1f2937",
      2,
      "#2563eb",
      5,
      "#0ea5e9",
      8,
      "#10b981",
      12,
      "#f59e0b",
    ];
  }

  if (metricKey === "overallScore" || metricKey === "accessibilityScore" || metricKey === "safetyScore" || metricKey === "equityScore") {
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", metricKey]], 0],
      0,
      "#7f1d1d",
      40,
      "#b45309",
      60,
      "#f59e0b",
      75,
      "#10b981",
      90,
      "#0ea5e9",
    ];
  }

  return [
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
  ];
}

function buildPointThematicOverlayColorExpression(metricKey: string | null | undefined): ExpressionSpecification {
  if (metricKey === "pedestrianInvolved") {
    return ["case", ["==", ["get", "pedestrianInvolved"], true], "#ec4899", "#334155"];
  }

  if (metricKey === "bicyclistInvolved") {
    return ["case", ["==", ["get", "bicyclistInvolved"], true], "#22c55e", "#334155"];
  }

  if (metricKey === "fatalCount") {
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "fatalCount"]], 0],
      0,
      "#fbbf24",
      1,
      "#f97316",
      2,
      "#dc2626",
    ];
  }

  if (metricKey === "injuryCount") {
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "injuryCount"]], 0],
      0,
      "#38bdf8",
      1,
      "#2563eb",
      3,
      "#1d4ed8",
      5,
      "#172554",
    ];
  }

  return [
    "match",
    ["get", "severityBucket"],
    "fatal",
    "#ef4444",
    "severe_injury",
    "#fb923c",
    "injury",
    "#facc15",
    "#94a3b8",
  ];
}

function buildCrashLayerFilter(
  crashSeverityFilter: CrashSeverityFilter,
  crashUserFilter: CrashUserFilter
): ExpressionSpecification {
  const filter: ExpressionSpecification = ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "crash_point"]];

  if (crashSeverityFilter !== "all") {
    (filter as unknown[]).push(["==", ["get", "severityBucket"], crashSeverityFilter]);
  }

  if (crashUserFilter === "pedestrian") {
    (filter as unknown[]).push(["==", ["get", "pedestrianInvolved"], true]);
  } else if (crashUserFilter === "bicycle") {
    (filter as unknown[]).push(["==", ["get", "bicyclistInvolved"], true]);
  } else if (crashUserFilter === "vru") {
    (filter as unknown[]).push([
      "any",
      ["==", ["get", "pedestrianInvolved"], true],
      ["==", ["get", "bicyclistInvolved"], true],
    ]);
  }

  return filter;
}

export default function ExplorePage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const scenarioDeepLinkAppliedRef = useRef(false);

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
  const [analysisContext, setAnalysisContext] = useState<AnalysisContextResponse | null>(null);
  const [analysisContextLoadState, setAnalysisContextLoadState] = useState<AnalysisContextLoadState>("idle");
  const [activeDatasetOverlayId, setActiveDatasetOverlayId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [showPolygonFill, setShowPolygonFill] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [showTracts, setShowTracts] = useState(true);
  const [showCrashes, setShowCrashes] = useState(true);
  const [cameraMode, setCameraMode] = useState<"regional" | "cinematic">("regional");
  const [tractMetric, setTractMetric] = useState<"minority" | "poverty" | "income" | "disadvantaged">("minority");
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
      center: [-121.5, 39.2],
      zoom: 5.1,
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

    if (!selectedDataset || !canRenderDatasetCoverageOverlay(selectedDataset)) {
      source.setData({
        type: "FeatureCollection",
        features: [],
      });
      return;
    }

    if (selectedDataset.geographyScope === "tract") {
      const tractFeatures =
        analysisResult?.geojson.features.filter(
          (feature) =>
            feature.geometry?.type !== "Point" &&
            feature.properties &&
            (feature.properties as Record<string, unknown>).kind === "census_tract"
        ) ?? [];

      const overlayMode = canRenderDatasetThematicOverlay(selectedDataset) ? "thematic_overlay" : "coverage_footprint";

      source.setData({
        type: "FeatureCollection",
        features: tractFeatures.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            overlayDatasetName: selectedDataset.name,
            overlayDatasetId: selectedDataset.datasetId,
            overlayMode,
            overlayMetricKey: selectedDataset.thematicMetricKey,
          },
        })),
      });

      if (overlayMode === "thematic_overlay") {
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
      }
      return;
    }

    if (selectedDataset.geographyScope === "corridor" || selectedDataset.geographyScope === "route") {
      const overlayMode = canRenderDatasetThematicOverlay(selectedDataset) ? "thematic_overlay" : "coverage_footprint";

      source.setData({
        type: "FeatureCollection",
        features: corridorGeojson
          ? [
              {
                type: "Feature",
                geometry: corridorGeojson,
                properties: {
                  kind: "dataset_coverage_corridor",
                  overlayDatasetName: selectedDataset.name,
                  overlayDatasetId: selectedDataset.datasetId,
                  overlayMode,
                  overlayMetricKey: selectedDataset.thematicMetricKey,
                  overallScore: analysisResult?.metrics.overallScore ?? null,
                  accessibilityScore: analysisResult?.metrics.accessibilityScore ?? null,
                  safetyScore: analysisResult?.metrics.safetyScore ?? null,
                  equityScore: analysisResult?.metrics.equityScore ?? null,
                },
              },
            ]
          : [],
      });

      if (overlayMode === "thematic_overlay") {
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
      }
      return;
    }

    if (selectedDataset.geographyScope === "point") {
      const overlayMode = canRenderDatasetThematicOverlay(selectedDataset) ? "thematic_overlay" : "coverage_footprint";
      const crashPointFeatures =
        analysisResult?.geojson.features.filter(
          (feature) =>
            feature.geometry?.type === "Point" &&
            feature.properties &&
            (feature.properties as Record<string, unknown>).kind === "crash_point"
        ) ?? [];

      source.setData({
        type: "FeatureCollection",
        features: crashPointFeatures.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            overlayDatasetName: selectedDataset.name,
            overlayDatasetId: selectedDataset.datasetId,
            overlayMode,
            overlayMetricKey: selectedDataset.thematicMetricKey,
          },
        })),
      });

      if (overlayMode === "thematic_overlay" && mapRef.current.getLayer("dataset-overlay-point")) {
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

    source.setData({
      type: "FeatureCollection",
      features: [],
    });
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
      const persistedMapViewState = normalizeMapViewState(runMetrics?.mapViewState);

      if (persistedMapViewState?.tractMetric) setTractMetric(persistedMapViewState.tractMetric);
      if (typeof persistedMapViewState?.showTracts === "boolean") setShowTracts(persistedMapViewState.showTracts);
      if (typeof persistedMapViewState?.showCrashes === "boolean") setShowCrashes(persistedMapViewState.showCrashes);
      if (persistedMapViewState?.crashSeverityFilter) setCrashSeverityFilter(persistedMapViewState.crashSeverityFilter);
      if (persistedMapViewState?.crashUserFilter) setCrashUserFilter(persistedMapViewState.crashUserFilter);
      if (persistedMapViewState?.activeDatasetOverlayId !== undefined) {
        setActiveDatasetOverlayId(persistedMapViewState.activeDatasetOverlayId ?? null);
      }

      setAnalysisResult({
        runId: run.id,
        title: run.title,
        createdAt: run.created_at,
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

  useEffect(() => {
    if (!workspaceId || scenarioDeepLinkAppliedRef.current) {
      return;
    }

    const requestedRunId = searchParams.get("runId");
    const requestedBaselineRunId = searchParams.get("baselineRunId");

    if (!requestedRunId && !requestedBaselineRunId) {
      scenarioDeepLinkAppliedRef.current = true;
      return;
    }

    scenarioDeepLinkAppliedRef.current = true;

    const applyScenarioDeepLink = async () => {
      try {
        const response = await fetch(
          `/api/runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=200`,
          { method: "GET" }
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to load linked scenario runs.");
        }

        const payload = (await response.json()) as { runs?: Run[] };
        const runs = payload.runs ?? [];
        const currentRun = requestedRunId ? runs.find((run) => run.id === requestedRunId) ?? null : null;
        const baseline = requestedBaselineRunId ? runs.find((run) => run.id === requestedBaselineRunId) ?? null : null;

        if (requestedRunId) {
          if (!currentRun) {
            throw new Error("Linked scenario run was not found in this workspace.");
          }

          loadRun(currentRun);
        }

        if (baseline && baseline.id !== requestedRunId) {
          setComparisonRun(baseline);
        }
      } catch (deepLinkError) {
        setError(deepLinkError instanceof Error ? deepLinkError.message : "Failed to open the scenario-linked review.");
      }
    };

    void applyScenarioDeepLink();
  }, [loadRun, searchParams, workspaceId]);

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

  const exportMetrics = () => {
    if (!analysisResult) {
      return;
    }

    try {
      downloadMetricsCsv(
        {
          ...analysisResult.metrics,
          mapViewState: currentMapViewState,
        },
        `openplan-${analysisResult.runId}-metrics.csv`
      );
    } catch {
      setError("Failed to export metrics CSV.");
    }
  };

  const exportGeojson = () => {
    if (!analysisResult) {
      return;
    }

    try {
      downloadGeojson(
        {
          ...analysisResult.geojson,
          metadata: {
            mapViewState: currentMapViewState,
          },
        } as GeoJSON.FeatureCollection,
        `openplan-${analysisResult.runId}-result.geojson`
      );
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

  const clearComparison = useCallback(() => {
    setError("");
    setComparisonRun(null);
  }, []);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    const currentRunId = analysisResult?.runId ?? null;
    const baselineRunId = comparisonRun?.id ?? null;

    if (currentRunId) {
      nextParams.set("runId", currentRunId);
    } else {
      nextParams.delete("runId");
    }

    if (baselineRunId) {
      nextParams.set("baselineRunId", baselineRunId);
    } else {
      nextParams.delete("baselineRunId");
    }

    const currentRunParam = searchParams.get("runId");
    const currentBaselineParam = searchParams.get("baselineRunId");

    if (currentRunParam === currentRunId && currentBaselineParam === baselineRunId) {
      return;
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [analysisResult?.runId, comparisonRun?.id, pathname, router, searchParams]);

  const comparisonDeltas = useMemo(() => {
    if (!analysisResult || !comparisonRun?.metrics) {
      return [];
    }

    return buildMetricDeltas(analysisResult.metrics, comparisonRun.metrics);
  }, [analysisResult, comparisonRun]);

  const comparisonMapViewState = useMemo(
    () => normalizeMapViewState(comparisonRun?.metrics?.mapViewState),
    [comparisonRun]
  );

  const activeDatasetOverlay = useMemo(
    () => analysisContext?.linkedDatasets.find((dataset) => dataset.datasetId === activeDatasetOverlayId) ?? null,
    [analysisContext, activeDatasetOverlayId]
  );

  const currentMapViewState = useMemo<MapViewState>(
    () => ({
      tractMetric,
      showTracts,
      showCrashes,
      crashSeverityFilter,
      crashUserFilter,
      activeDatasetOverlayId,
      activeOverlayContext: activeDatasetOverlay
        ? {
            datasetId: activeDatasetOverlay.datasetId,
            datasetName: activeDatasetOverlay.name,
            overlayMode: activeDatasetOverlay.thematicReady ? "thematic_overlay" : "coverage_footprint",
            geometryAttachment: activeDatasetOverlay.geometryAttachment,
            thematicMetricKey: activeDatasetOverlay.thematicMetricKey,
            thematicMetricLabel: activeDatasetOverlay.thematicMetricLabel,
            connectorLabel: activeDatasetOverlay.connectorLabel,
          }
        : null,
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

  const currentMapViewSummary = useMemo(
    () => summarizeMapViewState(currentMapViewState),
    [currentMapViewState]
  );

  const baselineMapViewSummary = useMemo(
    () => summarizeMapViewState(comparisonMapViewState),
    [comparisonMapViewState]
  );

  const mapViewComparisonRows = useMemo(() => {
    const currentSummaryMap = new globalThis.Map(currentMapViewSummary.map((item) => [item.label, item.value]));
    const baselineSummaryMap = new globalThis.Map(baselineMapViewSummary.map((item) => [item.label, item.value]));
    const labels = Array.from(new Set([...currentSummaryMap.keys(), ...baselineSummaryMap.keys()]));

    return labels.map((label) => {
      const current = currentSummaryMap.get(label) ?? "N/A";
      const baseline = baselineSummaryMap.get(label) ?? "N/A";
      return {
        label,
        current,
        baseline,
        changed: current !== baseline,
      };
    });
  }, [baselineMapViewSummary, currentMapViewSummary]);

  const comparisonExportRows = useMemo(() => {
    const metricRows = comparisonDeltas.map((delta) => ({
      rowType: "metric_delta",
      key: delta.key,
      label: delta.label,
      current: delta.current,
      baseline: delta.baseline,
      delta: delta.delta,
      deltaPct: delta.deltaPct,
    }));

    const mapRows = mapViewComparisonRows.map((row) => ({
      rowType: "map_view",
      label: row.label,
      current: row.current,
      baseline: row.baseline,
      changed: row.changed,
    }));

    return [...metricRows, ...mapRows];
  }, [comparisonDeltas, mapViewComparisonRows]);

  const exportComparisonCsv = () => {
    if (!analysisResult || !comparisonRun?.metrics) {
      setError("Load a baseline run before exporting a comparison artifact.");
      return;
    }

    try {
      downloadRecordsCsv(
        comparisonExportRows,
        `openplan-${analysisResult.runId}-vs-${comparisonRun.id}-comparison.csv`
      );
    } catch {
      setError("Failed to export comparison CSV.");
    }
  };

  const exportComparisonJson = () => {
    if (!analysisResult || !comparisonRun?.metrics) {
      setError("Load a baseline run before exporting a comparison artifact.");
      return;
    }

    try {
      const payload = {
        generatedAt: new Date().toISOString(),
        currentRun: {
          id: analysisResult.runId,
          title: "Current analysis run",
          mapViewState: currentMapViewState,
        },
        baselineRun: {
          id: comparisonRun.id,
          title: comparisonRun.title,
          createdAt: comparisonRun.created_at,
          mapViewState: comparisonMapViewState,
        },
        metricDeltas: comparisonDeltas,
        mapViewComparison: mapViewComparisonRows,
      };

      downloadText(
        JSON.stringify(payload, null, 2),
        `openplan-${analysisResult.runId}-vs-${comparisonRun.id}-comparison.json`,
        "application/json;charset=utf-8"
      );
    } catch {
      setError("Failed to export comparison JSON.");
    }
  };

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

  const resultScoreTiles: Array<{ label: string; value: string; note: string; emphasis?: boolean }> = [];

  if (analysisResult) {
    if (typeof analysisResult.metrics.overallScore === "number") {
      resultScoreTiles.push({
        label: "Overall",
        value: `${analysisResult.metrics.overallScore}`,
        note: "Composite corridor score across the current analysis run.",
        emphasis: true,
      });
    }

    resultScoreTiles.push(
      {
        label: "Accessibility",
        value: `${analysisResult.metrics.accessibilityScore}`,
        note: "Transit reach, service availability, and jobs-access posture.",
      },
      {
        label: "Safety",
        value: `${analysisResult.metrics.safetyScore}`,
        note: "Crash-risk lane informed by the active safety source and filters.",
      },
      {
        label: "Equity",
        value: `${analysisResult.metrics.equityScore}`,
        note: "Corridor equity screening signal from the current demographic layer.",
      }
    );
  }

  const resultStatusBadges: Array<{ label: string; tone: StatusTone }> = [];

  if (analysisResult?.metrics.transitAccessTier) {
    resultStatusBadges.push({
      label: `Transit access: ${String(analysisResult.metrics.transitAccessTier)}`,
      tone: resolveStatusTone(String(analysisResult.metrics.transitAccessTier)),
    });
  }

  if (analysisResult?.metrics.confidence) {
    resultStatusBadges.push({
      label: `Confidence: ${String(analysisResult.metrics.confidence)}`,
      tone: resolveStatusTone(String(analysisResult.metrics.confidence)),
    });
  }

  const sourceReviewCount = sourceTransparency.filter((item) => item.tone === "warning" || item.tone === "danger").length;
  const comparisonMetricChangeCount = comparisonDeltas.filter((delta) => delta.delta !== null && delta.delta !== 0).length;
  const comparisonViewDifferenceCount = mapViewComparisonRows.filter((row) => row.changed).length;
  const comparisonHeadlineDeltas = comparisonDeltas.filter((delta) => COMPARISON_HEADLINE_KEYS.has(delta.key));
  const comparisonSupportingDeltas = comparisonDeltas.filter((delta) => !COMPARISON_HEADLINE_KEYS.has(delta.key));
  const comparisonChangedDeltas = comparisonDeltas.filter((delta) => delta.delta !== null && delta.delta !== 0);
  const comparisonNarrativeLead = getComparisonNarrativeLead(comparisonMetricChangeCount, comparisonViewDifferenceCount);
  const prioritizedMapViewComparisonRows = prioritizeMapComparisonRows(mapViewComparisonRows);
  const changedMapViewRows = prioritizedMapViewComparisonRows.filter((row) => row.changed);
  const alignedMapViewRows = prioritizedMapViewComparisonRows.filter((row) => !row.changed);
  const currentRunTitle = analysisResult?.title ?? buildRunTitle(queryText);
  const currentRunTimestampLabel = analysisResult?.createdAt ? formatRunTimestamp(analysisResult.createdAt) : "Active in current session";
  const currentRunNarrativeLabel = analysisResult?.aiInterpretationSource === "ai" ? "AI-assisted" : "Deterministic";
  const currentRunMapContextLabel = currentMapViewSummary.length > 0 ? `${currentMapViewSummary.length} saved checks` : "Pending";
  const currentRunOverallScore = typeof analysisResult?.metrics.overallScore === "number" ? `${analysisResult.metrics.overallScore}` : "Not scored";
  const baselineRunMetrics = comparisonRun?.metrics as AnalysisResult["metrics"] | null | undefined;
  const baselineRunNarrativeLabel =
    (typeof baselineRunMetrics?.aiInterpretationSource === "string" && baselineRunMetrics.aiInterpretationSource === "ai") ||
    (typeof baselineRunMetrics?.dataQuality?.aiInterpretationSource === "string" && baselineRunMetrics.dataQuality.aiInterpretationSource === "ai") ||
    Boolean(comparisonRun?.ai_interpretation)
      ? "AI-assisted"
      : "Deterministic";
  const baselineRunMapContextLabel = baselineMapViewSummary.length > 0 ? `${baselineMapViewSummary.length} saved checks` : "Not captured";
  const baselineRunOverallScore = typeof baselineRunMetrics?.overallScore === "number" ? `${baselineRunMetrics.overallScore}` : "Not scored";
  const currentHistoryHref = analysisResult?.runId ? "#analysis-run-history-current" : "#analysis-run-history";
  const baselineHistoryHref = comparisonRun?.id ? "#analysis-run-history-baseline" : "#analysis-run-history";
  const disclosureItems = [
    {
      title: "AI acceleration",
      detail: "AI is used to accelerate drafting and interpretation; final analysis and conclusions still require human review and approval.",
      tone: "info" as const,
    },
    {
      title: "Verification gate",
      detail: "Regulatory and policy-sensitive claims should be citation-backed or explicitly marked for verification before release.",
      tone: "warning" as const,
    },
    {
      title: "Source limitations",
      detail: "This run relies on available source data and proxy methods where direct sources are unavailable or incomplete.",
      tone: "neutral" as const,
    },
    {
      title: "Equity safeguard",
      detail: "Recommendations should be checked for equity impacts and must not shift disproportionate burden onto disadvantaged communities.",
      tone: "warning" as const,
    },
  ];

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
      return `Connected to ${displayName} (${role}).`;
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

  const crashPointFeatures = useMemo(
    () =>
      analysisResult?.geojson.features.filter(
        (feature) => feature.geometry?.type === "Point" && (feature.properties as Record<string, unknown> | undefined)?.kind === "crash_point"
      ) ?? [],
    [analysisResult]
  );

  const crashPointCount = crashPointFeatures.length;

  const filteredCrashPointCount = useMemo(
    () =>
      crashPointFeatures.filter((feature) => {
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        const severityBucket = String(properties.severityBucket ?? "");
        const pedestrianInvolved = properties.pedestrianInvolved === true || properties.pedestrianInvolved === "true";
        const bicyclistInvolved = properties.bicyclistInvolved === true || properties.bicyclistInvolved === "true";

        const severityMatches = crashSeverityFilter === "all" || severityBucket === crashSeverityFilter;
        const userMatches =
          crashUserFilter === "all"
            ? true
            : crashUserFilter === "pedestrian"
              ? pedestrianInvolved
              : crashUserFilter === "bicycle"
                ? bicyclistInvolved
                : pedestrianInvolved || bicyclistInvolved;

        return severityMatches && userMatches;
      }).length,
    [crashPointFeatures, crashSeverityFilter, crashUserFilter]
  );

  const switrsPointLayerAvailable = analysisResult?.metrics.sourceSnapshots?.crashes?.source === "switrs-local" && crashPointCount > 0;

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

  const activeOverlayLegend = useMemo<{
    label: string;
    note: string;
    items: TractLegendItem[];
  } | null>(() => {
    if (!activeDatasetOverlay?.thematicReady) {
      return null;
    }

    if (activeDatasetOverlay.geometryAttachment === "analysis_crash_points") {
      if (activeDatasetOverlay.thematicMetricKey === "pedestrianInvolved") {
        return {
          label: "Pedestrian involvement",
          note: "Crash-point overlay colored by whether the collision involved a pedestrian.",
          items: [
            { label: "Pedestrian involved", color: "#ec4899" },
            { label: "No pedestrian flag", color: "#334155" },
          ],
        };
      }

      if (activeDatasetOverlay.thematicMetricKey === "bicyclistInvolved") {
        return {
          label: "Bicyclist involvement",
          note: "Crash-point overlay colored by whether the collision involved a bicyclist.",
          items: [
            { label: "Bicyclist involved", color: "#22c55e" },
            { label: "No bicyclist flag", color: "#334155" },
          ],
        };
      }

      if (activeDatasetOverlay.thematicMetricKey === "fatalCount") {
        return {
          label: "Fatality count",
          note: "Crash-point overlay scaled and colored by fatality count on the collision record.",
          items: [
            { label: "0", color: "#fbbf24" },
            { label: "1", color: "#f97316" },
            { label: "2+", color: "#dc2626" },
          ],
        };
      }

      if (activeDatasetOverlay.thematicMetricKey === "injuryCount") {
        return {
          label: "Injury count",
          note: "Crash-point overlay scaled and colored by injury count on the collision record.",
          items: [
            { label: "0", color: "#38bdf8" },
            { label: "1–2", color: "#2563eb" },
            { label: "3+", color: "#172554" },
          ],
        };
      }

      return {
        label: "Crash severity bucket",
        note: "Crash-point overlay colored by SWITRS severity bucket.",
        items: [
          { label: "Fatal", color: "#ef4444" },
          { label: "Severe injury", color: "#fb923c" },
          { label: "Injury", color: "#facc15" },
        ],
      };
    }

    if (activeDatasetOverlay.geometryAttachment === "analysis_corridor") {
      return {
        label: activeDatasetOverlay.thematicMetricLabel ?? titleize(activeDatasetOverlay.thematicMetricKey),
        note: "Corridor overlay colored by real run-level corridor scoring already present in the current analysis.",
        items: [
          { label: "Low", color: "#7f1d1d" },
          { label: "Moderate", color: "#f59e0b" },
          { label: "High", color: "#10b981" },
          { label: "Very high", color: "#0ea5e9" },
        ],
      };
    }

    return {
      label: activeDatasetOverlay.thematicMetricLabel ?? titleize(activeDatasetOverlay.thematicMetricKey),
      note: "Tract overlay colored by the bound thematic metric on real census tract geometry.",
      items: [
        { label: "Low", color: "#123047" },
        { label: "Mid", color: "#2563eb" },
        { label: "High", color: "#34d399" },
      ],
    };
  }, [activeDatasetOverlay]);

  const tractLegend = useMemo<{
    label: string;
    note: string;
    items: TractLegendItem[];
  }>(() => {
    if (tractMetric === "poverty") {
      return {
        label: "Poverty share",
        note: "Share of residents below poverty threshold in corridor-context tracts.",
        items: [
          { label: "0–10%", color: "#0b3b2e" },
          { label: "10–20%", color: "#15803d" },
          { label: "20–30%", color: "#65a30d" },
          { label: "30–45%", color: "#ca8a04" },
          { label: "45%+", color: "#b91c1c" },
        ],
      };
    }

    if (tractMetric === "income") {
      return {
        label: "Median income",
        note: "Weighted ACS median household income for each intersecting tract.",
        items: [
          { label: "<$45k", color: "#7f1d1d" },
          { label: "$45k–$70k", color: "#b45309" },
          { label: "$70k–$100k", color: "#0f766e" },
          { label: "$100k–$150k", color: "#0ea5e9" },
          { label: "$150k+", color: "#e0f2fe" },
        ],
      };
    }

    if (tractMetric === "disadvantaged") {
      return {
        label: "Disadvantaged flag",
        note: "Binary flag based on lower income plus elevated poverty, minority share, zero-vehicle, or transit dependence.",
        items: [
          { label: "Flagged", color: "#ef4444" },
          { label: "Not flagged", color: "#1f2937" },
        ],
      };
    }

    return {
      label: "Minority share",
      note: "Share of residents identified in the current equity-screening minority population field.",
      items: [
        { label: "0–30%", color: "#123047" },
        { label: "30–55%", color: "#1d4ed8" },
        { label: "55–75%", color: "#2563eb" },
        { label: "75–100%", color: "#0f766e" },
        { label: "Highest concentration", color: "#34d399" },
      ],
    };
  }, [tractMetric]);

  const hoveredTractMetricValue = useMemo(() => {
    if (!hoveredTract) {
      return "Hover a tract to inspect values";
    }

    if (tractMetric === "income") {
      return formatCurrency(hoveredTract.medianIncome);
    }

    if (tractMetric === "poverty") {
      return formatPercent(hoveredTract.pctBelowPoverty);
    }

    if (tractMetric === "disadvantaged") {
      return hoveredTract.isDisadvantaged ? "Flagged" : "Not flagged";
    }

    return formatPercent(hoveredTract.pctMinority);
  }, [hoveredTract, tractMetric]);

  const mapExperienceReady = MAPBOX_ACCESS_TOKEN.length > 0;
  const analysisSummary = activeDatasetOverlay
    ? `Current overlay: ${activeDatasetOverlay.name}`
    : "Choose a corridor and add an overlay to begin comparing conditions.";

  const linkedDatasetPreview = analysisContext?.linkedDatasets.slice(0, 4) ?? [];
  const activeOverlayGeometryLabel = activeDatasetOverlay?.geometryAttachment === "analysis_corridor"
    ? "corridor"
    : activeDatasetOverlay?.geometryAttachment === "analysis_crash_points"
      ? "crash-point"
      : "tract";

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

            {/* Map layer controls — moved from dead floating panel */}
            <section className="analysis-studio-surface">
              <div className="analysis-studio-header">
                <div className="analysis-studio-heading">
                  <p className="analysis-studio-label">Map layers</p>
                  <h3 className="analysis-studio-title">Layer visibility</h3>
                </div>
                <StatusBadge tone={mapReady ? "success" : "neutral"}>{mapReady ? "Ready" : "Init"}</StatusBadge>
              </div>
              <div className="analysis-studio-body">
                <div className="analysis-sidepanel-stack">
                  <button
                    type="button"
                    onClick={() => setShowPolygonFill((v) => !v)}
                    className={["analysis-sidepanel-row is-interactive", showPolygonFill ? "is-active" : "is-muted"].join(" ")}
                  >
                    <div className="analysis-sidepanel-head">
                      <p className="analysis-sidepanel-title">Corridor fill</p>
                      <StatusBadge tone={showPolygonFill ? "success" : "neutral"}>{showPolygonFill ? "Visible" : "Hidden"}</StatusBadge>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTracts((v) => !v)}
                    className={["analysis-sidepanel-row is-interactive", showTracts ? "is-active" : "is-muted"].join(" ")}
                  >
                    <div className="analysis-sidepanel-head">
                      <p className="analysis-sidepanel-title">Census tracts</p>
                      <StatusBadge tone={showTracts ? "success" : "neutral"}>{showTracts ? "Visible" : "Hidden"}</StatusBadge>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCrashes((v) => !v)}
                    className={["analysis-sidepanel-row is-interactive", showCrashes && switrsPointLayerAvailable ? "is-warning" : "is-muted"].join(" ")}
                  >
                    <div className="analysis-sidepanel-head">
                      <p className="analysis-sidepanel-title">Crash data</p>
                      <StatusBadge tone={showCrashes && switrsPointLayerAvailable ? "warning" : "neutral"}>
                        {switrsPointLayerAvailable ? (showCrashes ? "Visible" : "Hidden") : "No data"}
                      </StatusBadge>
                    </div>
                  </button>
                </div>
                <div className="mt-3 space-y-1.5">
                  <p className="analysis-studio-inline-meta-label">Tract theme</p>
                  <select
                    value={tractMetric}
                    onChange={(event) => setTractMetric(event.target.value as typeof tractMetric)}
                    className="analysis-sidepanel-select"
                  >
                    <option value="minority">Minority share</option>
                    <option value="poverty">Poverty share</option>
                    <option value="income">Median income</option>
                    <option value="disadvantaged">Disadvantaged flag</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Map intelligence — tract legend + live hover inspectors */}
            {(showTracts || switrsPointLayerAvailable) ? (
              <section className="analysis-studio-surface">
                <div className="analysis-studio-header">
                  <div className="analysis-studio-heading">
                    <p className="analysis-studio-label">Map intelligence</p>
                    <h3 className="analysis-studio-title">Live hover inspector</h3>
                    <p className="analysis-studio-description">Hover a census tract or crash point on the map to inspect its attributes here.</p>
                  </div>
                  <StatusBadge tone={hoveredTract || hoveredCrash ? "success" : "neutral"}>
                    {hoveredTract || hoveredCrash ? "Active" : "Idle"}
                  </StatusBadge>
                </div>
                <div className="analysis-studio-body">
                  <div className="analysis-sidepanel-stack">
                    {showTracts ? (
                      <>
                        <div className="analysis-sidepanel-row">
                          <div className="analysis-sidepanel-head">
                            <div className="analysis-sidepanel-main">
                              <p className="analysis-sidepanel-title">{tractLegend.label}</p>
                              <p className="analysis-sidepanel-body">{tractLegend.note}</p>
                            </div>
                            <StatusBadge tone="info">Legend</StatusBadge>
                          </div>
                          <div className="mt-2 space-y-1">
                            {tractLegend.items.map((item) => (
                              <div key={`legend-${item.label}`} className="flex items-center gap-2 py-0.5 text-xs text-slate-300/90">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/15" style={{ backgroundColor: item.color }} />
                                {item.label}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className={["analysis-sidepanel-row", hoveredTract ? "is-active" : "is-muted"].join(" ")}>
                          <div className="analysis-sidepanel-head">
                            <div className="analysis-sidepanel-main">
                              <div className="analysis-sidepanel-kicker">
                                <span className="analysis-sidepanel-chip">Tract inspector</span>
                              </div>
                              <p className="analysis-sidepanel-title">
                                {hoveredTract ? hoveredTract.name : "No tract hovered"}
                              </p>
                              <p className="analysis-sidepanel-body">
                                {hoveredTract ? `GEOID ${hoveredTract.geoid}` : "Hover a visible census tract to inspect its attributes."}
                              </p>
                            </div>
                            <StatusBadge tone={hoveredTract?.isDisadvantaged ? "warning" : "neutral"}>
                              {hoveredTract ? hoveredTractMetricValue : "Idle"}
                            </StatusBadge>
                          </div>
                          {hoveredTract ? (
                            <div className="analysis-sidepanel-stat-grid cols-2">
                              <div className="analysis-sidepanel-stat">
                                <p className="analysis-sidepanel-label">Population</p>
                                <p className="analysis-sidepanel-value">{hoveredTract.population?.toLocaleString() ?? "N/A"}</p>
                              </div>
                              <div className="analysis-sidepanel-stat">
                                <p className="analysis-sidepanel-label">Median income</p>
                                <p className="analysis-sidepanel-value">{formatCurrency(hoveredTract.medianIncome)}</p>
                              </div>
                              <div className="analysis-sidepanel-stat">
                                <p className="analysis-sidepanel-label">Minority share</p>
                                <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.pctMinority)}</p>
                              </div>
                              <div className="analysis-sidepanel-stat">
                                <p className="analysis-sidepanel-label">Poverty share</p>
                                <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.pctBelowPoverty)}</p>
                              </div>
                              <div className="analysis-sidepanel-stat">
                                <p className="analysis-sidepanel-label">Zero-vehicle HH</p>
                                <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.zeroVehiclePct)}</p>
                              </div>
                              <div className="analysis-sidepanel-stat">
                                <p className="analysis-sidepanel-label">Transit commute</p>
                                <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.transitCommutePct)}</p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}

                    {switrsPointLayerAvailable ? (
                      <div className={["analysis-sidepanel-row", hoveredCrash ? "is-warning" : "is-muted"].join(" ")}>
                        <div className="analysis-sidepanel-head">
                          <div className="analysis-sidepanel-main">
                            <div className="analysis-sidepanel-kicker">
                              <span className="analysis-sidepanel-chip">Crash inspector</span>
                            </div>
                            <p className="analysis-sidepanel-title">
                              {hoveredCrash ? hoveredCrash.severityLabel : "Crash details"}
                            </p>
                            <p className="analysis-sidepanel-body">
                              {hoveredCrash
                                ? `${titleize(crashSeverityFilter)} · ${formatCrashUserFilterLabel(crashUserFilter)}`
                                : "Hover a SWITRS collision point to inspect severity and VRU flags."}
                            </p>
                          </div>
                          <StatusBadge tone={hoveredCrash ? "warning" : "neutral"}>
                            {hoveredCrash ? "Hovering" : "Idle"}
                          </StatusBadge>
                        </div>
                        {hoveredCrash ? (
                          <div className="analysis-sidepanel-stat-grid cols-2">
                            <div className="analysis-sidepanel-stat">
                              <p className="analysis-sidepanel-label">Collision</p>
                              <p className="analysis-sidepanel-value">{hoveredCrash.severityLabel}</p>
                            </div>
                            <div className="analysis-sidepanel-stat">
                              <p className="analysis-sidepanel-label">Year</p>
                              <p className="analysis-sidepanel-value">{hoveredCrash.collisionYear ?? "Unknown"}</p>
                            </div>
                            <div className="analysis-sidepanel-stat">
                              <p className="analysis-sidepanel-label">Fatalities</p>
                              <p className="analysis-sidepanel-value">{hoveredCrash.fatalCount}</p>
                            </div>
                            <div className="analysis-sidepanel-stat">
                              <p className="analysis-sidepanel-label">Injured</p>
                              <p className="analysis-sidepanel-value">{hoveredCrash.injuryCount}</p>
                            </div>
                            <div className="analysis-sidepanel-stat sm:col-span-2">
                              <p className="analysis-sidepanel-label">VRU flags</p>
                              <p className="analysis-sidepanel-value">
                                {[
                                  hoveredCrash.pedestrianInvolved ? "Ped" : null,
                                  hoveredCrash.bicyclistInvolved ? "Bike" : null,
                                ].filter(Boolean).join(" · ") || "None"}
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            <section className="analysis-studio-surface">
              <div className="analysis-studio-header">
                <div className="analysis-studio-heading">
                  <p className="analysis-studio-label">Study brief</p>
                  <h3 className="analysis-studio-title">Question and outputs</h3>
                  <p className="analysis-studio-description">Frame the planning question, choose the reporting lane, then run or export the analysis from the same rail.</p>
                </div>
              </div>

              <div className="analysis-studio-body">
                <div className="analysis-studio-input-stack">
                  <Textarea
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    placeholder="Example: Evaluate transit accessibility, safety risk, and equity implications for this corridor."
                    rows={4}
                    maxLength={ANALYSIS_QUERY_MAX_CHARS}
                  />
                  <p className="analysis-studio-note">
                    Query length: {queryCharacterCount}/{ANALYSIS_QUERY_MAX_CHARS} characters.
                  </p>
                  {isQueryTooLong ? (
                    <p className="text-[0.72rem] text-destructive">
                      Trim the prompt before running analysis.
                    </p>
                  ) : null}
                </div>

                <div className="analysis-sidepanel-row is-muted">
                  <div className="analysis-sidepanel-head">
                    <div className="analysis-sidepanel-main">
                      <p className="analysis-sidepanel-title">Report template</p>
                      <p className="analysis-sidepanel-body">Keep the current grant or program framing visible while you generate HTML or PDF outputs.</p>
                    </div>
                    <div className="analysis-sidepanel-actions">
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
                    </div>
                  </div>
                  <p className="analysis-studio-note">Current template: {reportTemplate.toUpperCase()}</p>
                </div>

                <div className="space-y-2">
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void runAnalysis()}
                    disabled={!canSubmit || isSubmitting}
                  >
                    {isSubmitting ? "Running analysis…" : "Run Analysis"}
                  </Button>
                  {analysisResult?.runId ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => void generateReport()}
                        disabled={isGeneratingReport}
                      >
                        {isGeneratingReport ? "Generating…" : `${reportTemplate.toUpperCase()} Report`}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="flex-1"
                        onClick={() => void downloadPdfReport()}
                        disabled={isDownloadingPdf}
                      >
                        {isDownloadingPdf ? "Preparing…" : "PDF"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {error ? <ErrorState compact title="Please review" description={error} /> : null}
              </div>
            </section>
          </div>
        </div>

        {analysisResult ? (
          <>
            <div className="analysis-run-pair-stack analysis-explore-results-stack">
              <Card
                className={[
                  "analysis-explore-surface analysis-explore-surface-current",
                  comparisonRun?.metrics ? "is-paired" : "",
                ].join(" ")}
              >
                <CardHeader className="gap-3 border-b border-white/8 px-6 py-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="info">Current result</StatusBadge>
                    <StatusBadge tone={comparisonRun?.metrics ? "warning" : "neutral"}>
                      {comparisonRun?.metrics ? "Paired with baseline" : "Standalone review"}
                    </StatusBadge>
                    <StatusBadge tone={analysisResult.aiInterpretationSource === "ai" ? "info" : "warning"}>
                      {analysisResult.aiInterpretationSource === "ai" ? "AI-assisted narrative" : "Deterministic narrative"}
                    </StatusBadge>
                    <StatusBadge tone={currentMapViewSummary.length > 0 ? "success" : "neutral"}>
                      {currentMapViewSummary.length > 0 ? "Map context captured" : "Map context pending"}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <CardTitle className="text-[1.05rem] font-semibold tracking-[-0.02em] text-white">Current Result</CardTitle>
                      <CardDescription className="max-w-xl text-sm leading-6 text-slate-300/76">
                        {comparisonRun?.metrics
                          ? "The active run stays paired with the pinned baseline below so the comparison stays easy to follow."
                          : analysisResult.aiInterpretationSource === "ai"
                            ? "Operator-facing summary of the current run with AI-assisted narrative support. Human review remains mandatory before release."
                            : "Operator-facing summary of the current run using deterministic fallback logic rather than AI narrative output."}
                      </CardDescription>
                    </div>
                    <div className="analysis-run-identity-panel is-current">
                      <p className="analysis-run-identity-eyebrow">Active run</p>
                      <p className="analysis-run-identity-title">{currentRunTitle}</p>
                      <p className="analysis-run-identity-meta">{currentRunTimestampLabel}</p>
                      <p className="analysis-run-identity-record">{analysisResult.runId}</p>
                      <div className="analysis-run-identity-chip-row">
                        <span className="analysis-run-identity-chip">{currentRunNarrativeLabel} narrative</span>
                        <span className="analysis-run-identity-chip">{currentRunMapContextLabel} map context</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 px-6 py-5">
                  {comparisonRun?.metrics ? (
                    <div className="analysis-run-pair-bridge">
                      <div>
                        <p className="analysis-run-pair-bridge-label">Current ↔ baseline bridge</p>
                        <p className="analysis-run-pair-bridge-copy">
                          Review identity, capture timing, and map posture in one pass before reading the comparison board. The current result stays live; the baseline stays pinned.
                        </p>
                      </div>
                      <div className="analysis-run-pair-bridge-badges">
                        <StatusBadge tone={comparisonMetricChangeCount > 0 ? "info" : "neutral"}>
                          {comparisonMetricChangeCount > 0 ? `${comparisonMetricChangeCount} metric shifts pending review` : "Metrics currently flat"}
                        </StatusBadge>
                        <StatusBadge tone={comparisonViewDifferenceCount > 0 ? "warning" : "success"}>
                          {comparisonViewDifferenceCount > 0 ? `${comparisonViewDifferenceCount} view posture differences` : "View posture aligned"}
                        </StatusBadge>
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-[0.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,28,39,0.94),rgba(11,20,29,0.9))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-[16rem]">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-cyan-200/76">Current run posture</p>
                        <p className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white">
                          {typeof analysisResult.metrics.overallScore === "number" ? analysisResult.metrics.overallScore : "—"}
                        </p>
                        <p className="mt-2 text-sm text-slate-300/76">
                          {typeof analysisResult.metrics.overallScore === "number"
                            ? "Composite corridor score for the currently loaded analysis result."
                            : "Composite overall score is not available for this run, but the underlying domain scores are captured below."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {resultStatusBadges.map((item) => (
                          <StatusBadge key={item.label} tone={item.tone}>
                            {item.label}
                          </StatusBadge>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {resultScoreTiles.map((item) => (
                        <div
                          key={item.label}
                          className={[
                            "rounded-[0.5rem] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
                            item.emphasis ? "sm:col-span-2 bg-[linear-gradient(180deg,rgba(34,197,94,0.12),rgba(255,255,255,0.035))]" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                          <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">{item.value}</p>
                          <p className="mt-2 text-xs leading-5 text-slate-300/72">{item.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[0.5rem] border border-white/8 bg-black/15 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Output actions</p>
                        <p className="mt-2 text-sm text-slate-300/74">
                          Export the numeric record or geometry package for audit, sharing, or downstream reporting.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={exportMetrics}>
                          Export Metrics CSV
                        </Button>
                        <Button type="button" variant="outline" onClick={exportGeojson}>
                          Export Result GeoJSON
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[0.5rem] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Map review context</p>
                        <p className="mt-2 text-sm text-slate-300/74">
                          Captures the current tract, crash, and overlay posture that shaped this visible result surface.
                        </p>
                      </div>
                      <StatusBadge tone={currentMapViewSummary.length > 0 ? "success" : "neutral"}>
                        {currentMapViewSummary.length > 0 ? `${currentMapViewSummary.length} context checks saved` : "No saved context"}
                      </StatusBadge>
                    </div>
                    {currentMapViewSummary.length > 0 ? (
                      <div className="analysis-context-summary-grid mt-4">
                        {currentMapViewSummary.map((item) => (
                          <div key={`${item.label}-${item.value}`} className="analysis-context-summary-row">
                            <p className="analysis-context-summary-label">{item.label}</p>
                            <p className="analysis-context-summary-value">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-xs text-slate-400">
                        OpenPlan will preserve the active map-view context once those settings are saved on the run record.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-[0.5rem] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Summary brief</p>
                      <p className="mt-3 text-sm leading-6 text-slate-100/90">{analysisResult.summary}</p>
                    </div>

                    {analysisResult.aiInterpretation ? (
                      <div className="rounded-[0.5rem] border border-cyan-300/16 bg-[linear-gradient(180deg,rgba(14,35,48,0.88),rgba(11,20,29,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cyan-200/78">AI interpretation</p>
                          <StatusBadge tone="info">Human review required</StatusBadge>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-100/88">{analysisResult.aiInterpretation}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-[0.5rem] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Data source checks</p>
                        <p className="mt-2 text-sm text-slate-300/74">Review source quality, fallback behavior, and narrative inputs before sharing results.</p>
                      </div>
                      <StatusBadge tone={sourceReviewCount > 0 ? "warning" : "success"}>
                        {sourceReviewCount > 0 ? `${sourceReviewCount} items to review` : "Source checks look good"}
                      </StatusBadge>
                    </div>
                    <div className="mt-4 space-y-3">
                      {sourceTransparency.map((item) => (
                        <div key={item.key} className="rounded-[0.5rem] border border-white/8 bg-black/18 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-white">{item.label}</p>
                            <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-300/74">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {comparisonRun && comparisonRun.metrics ? (
                <Card className="analysis-explore-surface analysis-explore-surface-comparison">
                  <CardHeader className="gap-3 border-b border-white/8 px-6 py-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="warning">Pinned baseline</StatusBadge>
                      <StatusBadge tone={comparisonMetricChangeCount > 0 ? "info" : "neutral"}>
                        {comparisonMetricChangeCount > 0 ? `${comparisonMetricChangeCount} metric shifts` : "No material metric shift"}
                      </StatusBadge>
                      <StatusBadge tone={comparisonViewDifferenceCount > 0 ? "warning" : "success"}>
                        {comparisonViewDifferenceCount > 0 ? `${comparisonViewDifferenceCount} view differences` : "Map view aligned"}
                      </StatusBadge>
                      <StatusBadge tone={comparisonNarrativeLead.tone}>
                        {comparisonViewDifferenceCount > 0
                          ? "Evidence caution"
                          : comparisonMetricChangeCount > 0
                            ? "Like-for-like read"
                            : "Stable comparison"}
                      </StatusBadge>
                    </div>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <CardTitle className="text-[1.02rem] font-semibold tracking-[-0.02em] text-white">Run comparison</CardTitle>
                        <CardDescription className="max-w-2xl text-sm leading-6 text-slate-300/76">
                          Compare the current run against a pinned baseline without losing the map or result context.
                        </CardDescription>
                      </div>
                      <div className="analysis-run-identity-panel is-baseline">
                        <p className="analysis-run-identity-eyebrow">Baseline run</p>
                        <p className="analysis-run-identity-title">{comparisonRun.title}</p>
                        <p className="analysis-run-identity-meta">{formatRunTimestamp(comparisonRun.created_at)}</p>
                        <p className="analysis-run-identity-record">{comparisonRun.id}</p>
                        <div className="analysis-run-identity-chip-row">
                          <span className="analysis-run-identity-chip">{baselineRunNarrativeLabel} narrative</span>
                          <span className="analysis-run-identity-chip">{baselineRunMapContextLabel} map context</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 px-6 py-5">
                    <div className="analysis-comparison-story">
                      <div className="analysis-comparison-story-step">
                        <div className="analysis-run-pair-board">
                          <div className="analysis-run-pair-board-header">
                            <div>
                              <p className="analysis-run-pair-board-label">Step 1 · select the two runs</p>
                              <p className="analysis-run-pair-board-copy">
                                Review the current run and the pinned baseline side by side before reading score or narrative changes.
                              </p>
                            </div>
                            <div className="analysis-run-pair-board-badges">
                              <StatusBadge tone="info">Current live</StatusBadge>
                              <StatusBadge tone="warning">Pinned baseline</StatusBadge>
                            </div>
                          </div>

                          <div className="analysis-run-pair-board-grid">
                            <section className="analysis-run-pair-surface is-current">
                              <div className="analysis-run-pair-surface-header">
                                <div>
                                  <p className="analysis-run-pair-surface-eyebrow">Current result</p>
                                  <p className="analysis-run-pair-surface-title">{currentRunTitle}</p>
                                </div>
                                <StatusBadge tone="info">Active result</StatusBadge>
                              </div>
                              <p className="analysis-run-pair-surface-body">
                                This is the active run currently driving the visible results and exports.
                              </p>
                              <div className="analysis-run-pair-field-grid">
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Run record</p>
                                  <p className="analysis-run-pair-field-value break-all">{analysisResult.runId}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Captured</p>
                                  <p className="analysis-run-pair-field-value">{currentRunTimestampLabel}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Narrative mode</p>
                                  <p className="analysis-run-pair-field-value">{currentRunNarrativeLabel}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Map posture</p>
                                  <p className="analysis-run-pair-field-value">{currentRunMapContextLabel}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Overall score</p>
                                  <p className="analysis-run-pair-field-value">{currentRunOverallScore}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Suggested action</p>
                                  <p className="analysis-run-pair-field-value">Export current results</p>
                                </div>
                              </div>
                            </section>

                            <section className="analysis-run-pair-surface is-baseline">
                              <div className="analysis-run-pair-surface-header">
                                <div>
                                  <p className="analysis-run-pair-surface-eyebrow">Baseline reference</p>
                                  <p className="analysis-run-pair-surface-title">{comparisonRun.title}</p>
                                </div>
                                <StatusBadge tone="warning">Pinned for comparison</StatusBadge>
                              </div>
                              <p className="analysis-run-pair-surface-body">
                                This baseline stays pinned until you replace it or clear the comparison.
                              </p>
                              <div className="analysis-run-pair-field-grid">
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Run record</p>
                                  <p className="analysis-run-pair-field-value break-all">{comparisonRun.id}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Captured</p>
                                  <p className="analysis-run-pair-field-value">{formatRunTimestamp(comparisonRun.created_at)}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Narrative mode</p>
                                  <p className="analysis-run-pair-field-value">{baselineRunNarrativeLabel}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Map posture</p>
                                  <p className="analysis-run-pair-field-value">{baselineRunMapContextLabel}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Overall score</p>
                                  <p className="analysis-run-pair-field-value">{baselineRunOverallScore}</p>
                                </div>
                                <div className="analysis-run-pair-field">
                                  <p className="analysis-run-pair-field-label">Suggested action</p>
                                  <p className="analysis-run-pair-field-value">Replace or clear baseline</p>
                                </div>
                              </div>
                            </section>
                          </div>
                        </div>
                      </div>

                      <div className="analysis-comparison-story-step">
                        <div className="analysis-run-history-handoff">
                          <div className="analysis-run-history-handoff-header">
                            <div>
                              <p className="analysis-run-history-handoff-label">Step 2 · review in run history</p>
                              <p className="analysis-run-history-handoff-copy">
                                Jump to either run in history to reload the current result, replace the baseline, or clear the comparison.
                              </p>
                            </div>
                            <div className="analysis-run-history-handoff-badges">
                              <StatusBadge tone="info">Current row linked</StatusBadge>
                              <StatusBadge tone="warning">Baseline row linked</StatusBadge>
                            </div>
                          </div>

                          <div className="analysis-run-history-handoff-grid">
                            <div className="analysis-run-history-handoff-card is-current">
                              <p className="analysis-run-history-handoff-card-label">Current run</p>
                              <p className="analysis-run-history-handoff-card-title">{currentRunTitle}</p>
                              <p className="analysis-run-history-handoff-card-copy">
                                Active result · {currentRunTimestampLabel}. Reload another run here only if you want to replace the current side of the comparison.
                              </p>
                            </div>
                            <div className="analysis-run-history-handoff-card is-baseline">
                              <p className="analysis-run-history-handoff-card-label">Baseline run</p>
                              <p className="analysis-run-history-handoff-card-title">{comparisonRun.title}</p>
                              <p className="analysis-run-history-handoff-card-copy">
                                Pinned baseline · {formatRunTimestamp(comparisonRun.created_at)}. Replace or clear this row to change the baseline.
                              </p>
                            </div>
                          </div>

                          <div className="analysis-run-history-handoff-actions">
                            <Button asChild type="button" variant="ghost">
                              <a href={currentHistoryHref}>Jump to current row</a>
                            </Button>
                            <Button asChild type="button" variant="ghost">
                              <a href={baselineHistoryHref}>Jump to pinned baseline row</a>
                            </Button>
                            <Button type="button" variant="ghost" onClick={clearComparison}>
                              Clear baseline
                            </Button>
                          </div>
                        </div>
                      </div>

                      <section className="analysis-comparison-story-step analysis-comparison-narrative">
                        <div className="analysis-comparison-narrative-header">
                          <div>
                            <p className="analysis-comparison-narrative-label">Step 3 · review the differences</p>
                            <h3 className="analysis-comparison-narrative-title">{comparisonNarrativeLead.title}</h3>
                            <p className="analysis-comparison-narrative-copy">{comparisonNarrativeLead.detail}</p>
                          </div>
                          <div className="analysis-comparison-narrative-badges">
                            <StatusBadge tone={comparisonMetricChangeCount > 0 ? "info" : "neutral"}>
                              {comparisonMetricChangeCount > 0 ? `${comparisonMetricChangeCount} score or count shifts` : "Headline metrics flat"}
                            </StatusBadge>
                            <StatusBadge tone={comparisonViewDifferenceCount > 0 ? "warning" : "success"}>
                              {comparisonViewDifferenceCount > 0 ? `${comparisonViewDifferenceCount} evidence differences` : "Evidence posture aligned"}
                            </StatusBadge>
                          </div>
                        </div>

                        <div className="analysis-comparison-narrative-section">
                          <div className="analysis-comparison-section-header">
                            <div>
                              <p className="analysis-comparison-section-label">Headline deltas</p>
                              <p className="analysis-comparison-section-copy">
                                The four score lanes carry the first read. Treat them as the top-line story before moving into supporting counts and context evidence.
                              </p>
                            </div>
                            <StatusBadge tone={comparisonChangedDeltas.length > 0 ? "info" : "neutral"}>
                              {comparisonChangedDeltas.length > 0 ? `${comparisonChangedDeltas.length} metrics moved` : "No metric movement"}
                            </StatusBadge>
                          </div>

                          <div className="analysis-comparison-headline-grid">
                            {comparisonHeadlineDeltas.map((delta) => {
                              const normalizedDelta = delta.delta ?? 0;
                              const directionTone = delta.delta === null ? "flat" : deltaTone(normalizedDelta);
                              const statusTone = delta.delta === null ? "neutral" : toneFromDelta(normalizedDelta);

                              return (
                                <article
                                  key={delta.key}
                                  className={[
                                    "analysis-comparison-headline-card",
                                    directionTone === "up" ? "is-up" : "",
                                    directionTone === "down" ? "is-down" : "",
                                    directionTone === "flat" ? "is-flat" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                >
                                  <div className="analysis-comparison-headline-card-head">
                                    <div>
                                      <p className="analysis-comparison-headline-label">{delta.label}</p>
                                      <p className="analysis-comparison-headline-value">
                                        {formatDelta(delta.delta)}
                                        {delta.deltaPct !== null ? <span> ({formatDelta(delta.deltaPct)}%)</span> : null}
                                      </p>
                                    </div>
                                    <StatusBadge tone={statusTone}>
                                      {directionTone === "flat" ? "No change" : directionTone === "up" ? "Up" : "Down"}
                                    </StatusBadge>
                                  </div>
                                  <p className="analysis-comparison-headline-detail">Current: {delta.current ?? "N/A"}</p>
                                  <p className="analysis-comparison-headline-detail">Baseline: {delta.baseline ?? "N/A"}</p>
                                </article>
                              );
                            })}
                          </div>
                        </div>

                        <div className="analysis-comparison-narrative-section">
                          <div className="analysis-comparison-section-header">
                            <div>
                              <p className="analysis-comparison-section-label">Supporting evidence</p>
                              <p className="analysis-comparison-section-copy">
                                Secondary counts help explain why the headline score movement matters operationally or why it should be treated cautiously.
                              </p>
                            </div>
                            <StatusBadge tone="neutral">Audit trail kept visible</StatusBadge>
                          </div>

                          <div className="analysis-comparison-support-list">
                            {comparisonSupportingDeltas.map((delta: MetricDelta) => {
                              const normalizedDelta = delta.delta ?? 0;
                              const directionTone = delta.delta === null ? "flat" : deltaTone(normalizedDelta);
                              const statusTone = delta.delta === null ? "neutral" : toneFromDelta(normalizedDelta);

                              return (
                                <div key={delta.key} className="analysis-comparison-support-row">
                                  <div>
                                    <p className="analysis-comparison-support-label">{delta.label}</p>
                                    <p className="analysis-comparison-support-copy">
                                      Current {delta.current ?? "N/A"} · Baseline {delta.baseline ?? "N/A"}
                                    </p>
                                  </div>
                                  <div className="analysis-comparison-support-value">
                                    <p>
                                      {formatDelta(delta.delta)}
                                      {delta.deltaPct !== null ? ` (${formatDelta(delta.deltaPct)}%)` : ""}
                                    </p>
                                    <StatusBadge tone={statusTone}>
                                      {directionTone === "flat" ? "No change" : directionTone === "up" ? "Up" : "Down"}
                                    </StatusBadge>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="analysis-comparison-narrative-section is-context-evidence">
                          <div className="analysis-comparison-section-header">
                            <div>
                              <p className="analysis-comparison-section-label">Map-context evidence</p>
                              <p className="analysis-comparison-section-copy">
                                Use these checks to confirm whether both runs were reviewed with the same tract, crash, and overlay context.
                              </p>
                            </div>
                            <StatusBadge tone={comparisonViewDifferenceCount > 0 ? "warning" : "success"}>
                              {comparisonViewDifferenceCount > 0 ? `${comparisonViewDifferenceCount} context conflicts` : "All context checks aligned"}
                            </StatusBadge>
                          </div>

                          {prioritizedMapViewComparisonRows.length > 0 ? (
                            <div className="analysis-comparison-evidence-stack">
                              <div className="analysis-comparison-evidence-group">
                                <div className="analysis-comparison-evidence-group-head">
                                  <p className="analysis-comparison-evidence-group-label">Differences requiring interpretation</p>
                                  <p className="analysis-comparison-evidence-group-copy">
                                    {changedMapViewRows.length > 0
                                      ? "These differences may explain part of the score change above, or they may show that the two runs were reviewed under different map conditions."
                                      : "No tract, crash, or overlay posture conflicts were detected between current and baseline."}
                                  </p>
                                </div>
                                <div className="analysis-comparison-evidence-list">
                                  {changedMapViewRows.length > 0 ? (
                                    changedMapViewRows.map((row) => (
                                      <article key={row.label} className="analysis-comparison-evidence-row is-changed">
                                        <div className="analysis-comparison-evidence-row-head">
                                          <p className="analysis-comparison-evidence-row-label">{row.label}</p>
                                          <StatusBadge tone="warning">Different</StatusBadge>
                                        </div>
                                        <div className="analysis-comparison-evidence-values">
                                          <p>
                                            <span>Current</span>
                                            <strong>{row.current}</strong>
                                          </p>
                                          <p>
                                            <span>Baseline</span>
                                            <strong>{row.baseline}</strong>
                                          </p>
                                        </div>
                                      </article>
                                    ))
                                  ) : (
                                    <div className="analysis-comparison-evidence-empty">
                                      <p>All saved map-context checks are aligned across the active pair.</p>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {alignedMapViewRows.length > 0 ? (
                                <div className="analysis-comparison-evidence-group is-secondary">
                                  <div className="analysis-comparison-evidence-group-head">
                                    <p className="analysis-comparison-evidence-group-label">Aligned context checks</p>
                                    <p className="analysis-comparison-evidence-group-copy">
                                      These matching checks support a like-for-like reading of the comparison where the evidence frame stayed constant.
                                    </p>
                                  </div>
                                  <div className="analysis-comparison-evidence-list">
                                    {alignedMapViewRows.map((row) => (
                                      <article key={row.label} className="analysis-comparison-evidence-row is-aligned">
                                        <div className="analysis-comparison-evidence-row-head">
                                          <p className="analysis-comparison-evidence-row-label">{row.label}</p>
                                          <StatusBadge tone="neutral">Aligned</StatusBadge>
                                        </div>
                                        <div className="analysis-comparison-evidence-values is-single">
                                          <p>
                                            <span>Current / baseline</span>
                                            <strong>{row.current}</strong>
                                          </p>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="analysis-comparison-evidence-empty">
                              <p>No saved map context is attached to the baseline yet, so compare the results with extra caution.</p>
                            </div>
                          )}
                        </div>

                        <div className="analysis-comparison-actions">
                          <div>
                            <p className="analysis-comparison-section-label">Controls & exports</p>
                            <p className="analysis-comparison-section-copy">
                              Export the comparison artifact, jump straight into the pinned baseline record, or clear the baseline to return the studio to a single-run posture.
                            </p>
                          </div>
                          <div className="analysis-comparison-action-buttons">
                            <Button asChild type="button" variant="ghost">
                              <a href={baselineHistoryHref}>Jump to pinned baseline row</a>
                            </Button>
                            <Button type="button" variant="outline" onClick={exportComparisonCsv}>
                              Export Comparison CSV
                            </Button>
                            <Button type="button" variant="outline" onClick={exportComparisonJson}>
                              Export Comparison JSON
                            </Button>
                            <Button type="button" variant="ghost" onClick={clearComparison}>
                              Clear baseline
                            </Button>
                          </div>
                        </div>
                      </section>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <Card className="analysis-explore-surface">
              <CardHeader className="gap-3 border-b border-white/8 px-6 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="neutral">Supporting briefing</StatusBadge>
                  <StatusBadge tone="info">Corridor context</StatusBadge>
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-[1.02rem] font-semibold tracking-[-0.02em] text-white">Geospatial Intelligence Briefing</CardTitle>
                  <CardDescription className="max-w-xl text-sm leading-6 text-slate-300/76">
                    Real corridor-context signals and source posture for planning, grant, and engagement workflows.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-6 py-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {planningSignals.map((signal) => (
                    <div key={signal.label} className="rounded-[0.5rem] border border-border/80 bg-background p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{signal.label}</p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{signal.value}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{signal.note}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-[0.75rem] border border-border/80 bg-[linear-gradient(180deg,rgba(11,19,27,0.98),rgba(15,24,33,0.94))] p-5 text-slate-100 shadow-[0_20px_48px_rgba(0,0,0,0.16)]">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Data fabric status</p>
                    <div className="mt-4 space-y-3">
                      {geospatialSourceCards.map((item) => (
                        <div key={item.label} className="rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-white">{item.label}</p>
                            <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                          </div>
                          <p className="mt-2 text-xs text-slate-300/82">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[0.75rem] border border-border/80 bg-background p-5 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Citations & next geospatial lanes</p>
                    <div className="mt-4 space-y-3">
                      <div className="rounded-[0.5rem] border border-border/80 bg-card p-3.5">
                        <p className="text-sm font-medium text-foreground">Census retrieval</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {sourceSnapshots?.census?.retrievalUrl ?? "Census retrieval URL not captured for this run."}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Fetched: {sourceSnapshots?.census?.fetchedAt ? formatRunTimestamp(sourceSnapshots.census.fetchedAt) : "Unknown"}
                        </p>
                      </div>
                      <div className="rounded-[0.5rem] border border-border/80 bg-card p-3.5">
                        <p className="text-sm font-medium text-foreground">Crash lane posture</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Current crash source: {formatSourceToken(sourceSnapshots?.crashes?.source)}.
                          {sourceSnapshots?.crashes?.source !== "switrs-local"
                            ? " SWITRS remains the preferred California-grade upgrade path for richer safety layers."
                            : " SWITRS-backed safety coverage is active for this corridor run."}
                        </p>
                      </div>
                      <div className="rounded-[0.5rem] border border-border/80 bg-card p-3.5">
                        <p className="text-sm font-medium text-foreground">Next layer buildout</p>
                        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                          <li>Census tract geometry + choropleth overlays</li>
                          <li>SWITRS collision point layer + severity filters</li>
                          <li>Project and engagement overlays tied into the workspace</li>
                          <li>CARTO workflow lane for derived spatial products and scheduled refreshes</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="analysis-explore-surface analysis-explore-surface-warning">
              <CardHeader className="gap-3 border-b border-white/8 px-6 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="warning">Release guardrail</StatusBadge>
                  <StatusBadge tone="neutral">Client-safe disclosure</StatusBadge>
                  <StatusBadge tone="info">Human approval required</StatusBadge>
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-[1.02rem] font-semibold tracking-[-0.02em] text-white">Methods, Assumptions &amp; AI Disclosure</CardTitle>
                  <CardDescription className="max-w-xl text-sm leading-6 text-slate-300/78">
                    Audit notes that should travel with this result before it becomes a client memo, grant attachment, or public-facing narrative.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-6 py-5">
                <div className="rounded-[0.5rem] border border-amber-400/18 bg-amber-400/8 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-amber-200/80">Operator release note</p>
                  <p className="mt-3 text-sm leading-6 text-slate-100/88">
                    Treat the cards above as working analysis surfaces, not self-certifying deliverables. Before external use, verify citations, source posture, and equity implications.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {disclosureItems.map((item) => (
                    <div key={item.title} className="rounded-[0.5rem] border border-white/8 bg-black/18 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-white">{item.title}</p>
                        <StatusBadge tone={item.tone}>{item.tone === "warning" ? "Review" : item.tone === "info" ? "Disclosure" : "Assumption"}</StatusBadge>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-slate-300/74">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <section className="analysis-studio-surface analysis-studio-surface--empty">
            <div className="analysis-studio-heading">
              <p className="analysis-studio-label">Result board</p>
              <h3 className="analysis-studio-title">No analysis selected</h3>
              <p className="analysis-studio-description">Run a corridor analysis or load a prior run to review metrics, narrative output, and comparisons.</p>
            </div>
            <div className="analysis-studio-inline-meta">
              <p className="analysis-studio-inline-meta-label">Next step</p>
              <p className="analysis-studio-inline-meta-value">Upload a corridor, enter the planning question, and run the study to populate this board.</p>
            </div>
          </section>
        )}

        <RunHistory
          workspaceId={workspaceId}
          onLoadRun={loadRun}
          onCompareRun={compareRun}
          onClearComparison={clearComparison}
          currentRunId={analysisResult?.runId}
          currentRunTitle={analysisResult?.title ?? buildRunTitle(queryText)}
          currentRunCreatedAt={analysisResult?.createdAt ?? null}
          comparisonRunId={comparisonRun?.id}
          comparisonRunTitle={comparisonRun?.title ?? null}
          comparisonRunCreatedAt={comparisonRun?.created_at ?? null}
        />
      </aside>
    </section>
  );
}
