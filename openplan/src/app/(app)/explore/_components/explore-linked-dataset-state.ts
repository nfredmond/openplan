import type { StatusTone } from "@/lib/ui/status";
import {
  canRenderDatasetCoverageOverlay,
  canRenderDatasetThematicOverlay,
  formatRunTimestamp,
  titleize,
} from "./_helpers";
import type { AnalysisContextResponse } from "./_types";

type LinkedDataset = AnalysisContextResponse["linkedDatasets"][number];

export type LinkedDatasetQueueItem = {
  dataset: LinkedDataset;
  canRenderCoverage: boolean;
  isActiveOverlay: boolean;
  thematicReady: boolean;
  rowClassName: string;
  overlayStatusLabel: string;
  overlayStatusTone: StatusTone;
  refreshedLabel: string;
  summary: string;
  sourceLabel: string;
  buttonLabel: string;
  buttonVariant: "secondary" | "outline";
  buttonDisabled: boolean;
};

export type LinkedDatasetQueueState = {
  items: LinkedDatasetQueueItem[];
};

function resolveDatasetGeometryLabel(geometryAttachment: string): string {
  if (geometryAttachment === "analysis_corridor") {
    return "corridor";
  }

  if (geometryAttachment === "analysis_crash_points") {
    return "crash-point";
  }

  return "tract";
}

function buildDatasetRowClassName({
  canRenderCoverage,
  isActiveOverlay,
  thematicReady,
}: {
  canRenderCoverage: boolean;
  isActiveOverlay: boolean;
  thematicReady: boolean;
}): string {
  return [
    "module-record-row",
    canRenderCoverage ? "is-interactive" : "",
    isActiveOverlay ? "is-selected" : thematicReady ? "is-comparison" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildDatasetButtonLabel({
  canRenderCoverage,
  isActiveOverlay,
  thematicReady,
}: {
  canRenderCoverage: boolean;
  isActiveOverlay: boolean;
  thematicReady: boolean;
}): string {
  if (isActiveOverlay) {
    return thematicReady ? "Hide thematic" : "Hide coverage";
  }

  if (canRenderCoverage) {
    return thematicReady ? "Show thematic" : "Show coverage";
  }

  return "Not drawable";
}

export function buildLinkedDatasetQueueItem({
  dataset,
  activeDatasetOverlayId,
}: {
  dataset: LinkedDataset;
  activeDatasetOverlayId: string | null;
}): LinkedDatasetQueueItem {
  const canRenderCoverage = canRenderDatasetCoverageOverlay(dataset);
  const isActiveOverlay = activeDatasetOverlayId === dataset.datasetId;
  const thematicReady = canRenderDatasetThematicOverlay(dataset);
  const geometryLabel = resolveDatasetGeometryLabel(dataset.geometryAttachment);

  return {
    dataset,
    canRenderCoverage,
    isActiveOverlay,
    thematicReady,
    rowClassName: buildDatasetRowClassName({ canRenderCoverage, isActiveOverlay, thematicReady }),
    overlayStatusLabel: dataset.overlayReady ? "Overlay-ready" : "Registry-only",
    overlayStatusTone: dataset.overlayReady ? "success" : "neutral",
    refreshedLabel: dataset.lastRefreshedAt ? `Refreshed ${formatRunTimestamp(dataset.lastRefreshedAt)}` : "Refresh pending",
    summary: thematicReady
      ? `Uses real ${geometryLabel} geometry + ${dataset.thematicMetricLabel ?? titleize(dataset.thematicMetricKey)}.`
      : dataset.overlayReady
        ? "Coverage footprint only — dataset values stay honest until a thematic binding exists."
        : "Registry record only for now; geometry attachment is not drawable yet.",
    sourceLabel: dataset.connectorLabel ?? "Manual source",
    buttonLabel: buildDatasetButtonLabel({ canRenderCoverage, isActiveOverlay, thematicReady }),
    buttonVariant: isActiveOverlay ? "secondary" : "outline",
    buttonDisabled: !canRenderCoverage,
  };
}

export function buildLinkedDatasetQueueState({
  datasets,
  activeDatasetOverlayId,
  limit = 4,
}: {
  datasets: LinkedDataset[] | null | undefined;
  activeDatasetOverlayId: string | null;
  limit?: number;
}): LinkedDatasetQueueState {
  return {
    items: (datasets ?? [])
      .slice(0, limit)
      .map((dataset) => buildLinkedDatasetQueueItem({ dataset, activeDatasetOverlayId })),
  };
}
