import type {
  CrashSeverityFilter,
  CrashUserFilter,
  MapViewState,
} from "@/lib/analysis/map-view-state";
import type {
  AnalysisContextResponse,
  AnalysisResult,
  TractMetric,
  WorkspaceLoadState,
} from "./_types";

type LinkedDataset = AnalysisContextResponse["linkedDatasets"][number];

export function resolveActiveDatasetOverlay(
  analysisContext: AnalysisContextResponse | null,
  activeDatasetOverlayId: string | null
): LinkedDataset | null {
  return analysisContext?.linkedDatasets.find((dataset) => dataset.datasetId === activeDatasetOverlayId) ?? null;
}

export function buildCurrentMapViewState({
  tractMetric,
  showTracts,
  showCrashes,
  crashSeverityFilter,
  crashUserFilter,
  activeDatasetOverlayId,
  activeDatasetOverlay,
}: {
  tractMetric: TractMetric;
  showTracts: boolean;
  showCrashes: boolean;
  crashSeverityFilter: CrashSeverityFilter;
  crashUserFilter: CrashUserFilter;
  activeDatasetOverlayId: string | null;
  activeDatasetOverlay: LinkedDataset | null;
}): MapViewState {
  return {
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
  };
}

export function resolveWorkspaceHelperText({
  workspaceLoadState,
  workspaceName,
  workspaceRole,
}: {
  workspaceLoadState: WorkspaceLoadState;
  workspaceName: string | null;
  workspaceRole: string | null;
}): string {
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
}

export function resolveWorkspaceStatusLabel(workspaceLoadState: WorkspaceLoadState): string {
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
}

export function getCrashPointFeatures(analysisResult: AnalysisResult | null): GeoJSON.Feature[] {
  return (
    analysisResult?.geojson.features.filter(
      (feature) => feature.geometry?.type === "Point" && (feature.properties as Record<string, unknown> | undefined)?.kind === "crash_point"
    ) ?? []
  );
}

export function hasSwitrsPointLayer(analysisResult: AnalysisResult | null, crashPointCount: number): boolean {
  return analysisResult?.metrics.sourceSnapshots?.crashes?.source === "switrs-local" && crashPointCount > 0;
}

export function getLinkedDatasetPreview(
  analysisContext: AnalysisContextResponse | null,
  limit = 4
): LinkedDataset[] {
  return analysisContext?.linkedDatasets.slice(0, limit) ?? [];
}
