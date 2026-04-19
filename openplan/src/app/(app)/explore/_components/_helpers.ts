import type { ExpressionSpecification, LngLatBoundsLike } from "mapbox-gl";
import {
  titleizeMapViewValue,
  type CrashSeverityFilter,
  type CrashUserFilter,
} from "@/lib/analysis/map-view-state";
import type { StatusTone } from "@/lib/ui/status";
import type { AnalysisContextResponse, CorridorGeometry, Position } from "./_types";

export function collectPositions(geometry: CorridorGeometry): Position[] {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }

  return geometry.coordinates.flat(2);
}

export function getBoundsFromGeometry(geometry: CorridorGeometry): LngLatBoundsLike | null {
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

export function formatRunTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function titleize(value: string | null | undefined): string {
  return titleizeMapViewValue(value);
}

export function formatSourceToken(value: string | undefined): string {
  if (!value) return "Unknown";
  return value
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const MAP_CONTEXT_PRIORITY = [
  "Project overlay",
  "Crash filter",
  "Tract theme",
  "Overlay mode",
  "Overlay geometry",
  "Census tracts",
  "SWITRS lane",
] as const;

export function buildRunTitle(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Untitled corridor analysis";
  }

  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

export function prioritizeMapComparisonRows(
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

export function getComparisonNarrativeLead(
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

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return `${value}%`;
}

export function canRenderDatasetCoverageOverlay(
  dataset: AnalysisContextResponse["linkedDatasets"][number] | null | undefined
): boolean {
  if (!dataset?.overlayReady) {
    return false;
  }

  return ["tract", "corridor", "route"].includes(dataset.geographyScope);
}

export function canRenderDatasetThematicOverlay(
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

export function buildThematicOverlayPaintExpression(metricKey: string | null | undefined): ExpressionSpecification {
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

export function buildPointThematicOverlayColorExpression(metricKey: string | null | undefined): ExpressionSpecification {
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

export function buildCrashLayerFilter(
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
