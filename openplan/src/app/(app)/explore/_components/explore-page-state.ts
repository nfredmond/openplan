import type {
  CrashSeverityFilter,
  CrashUserFilter,
  MapViewState,
} from "@/lib/analysis/map-view-state";
import { ANALYSIS_QUERY_MAX_CHARS } from "@/lib/analysis/query";
import type {
  AnalysisContextResponse,
  AnalysisResult,
  CorridorGeometry,
  TractMetric,
  WorkspaceLoadState,
} from "./_types";

type LinkedDataset = AnalysisContextResponse["linkedDatasets"][number];

/**
 * Whether the run gate is open.
 *
 * A study area is a study area whatever produced it — a place searched from the
 * any-place picker, an area drawn on the map, an uploaded boundary file, or a
 * reloaded run. This gate deliberately asks only whether one is SET, so no input
 * path can become privileged over another.
 */
export function canRunAnalysis({
  workspaceId,
  queryText,
  corridorGeojson,
}: {
  workspaceId: string;
  queryText: string;
  corridorGeojson: CorridorGeometry | null;
}): boolean {
  const trimmed = queryText.trim();
  return Boolean(
    workspaceId && trimmed.length > 0 && trimmed.length <= ANALYSIS_QUERY_MAX_CHARS && corridorGeojson
  );
}

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

/**
 * Whether there is a crash point layer to interact with.
 *
 * This used to require `crashes.source === "switrs-local"`. No code has emitted
 * that token since the crash lane moved to the adapter registry — the snapshot
 * now carries the adapter's own id (`ccrs-ca`, `fars-national`, ...) — so the
 * test could never pass and the crash layer was permanently unreachable on
 * Explore even when live crashes had been fetched and mapped.
 *
 * The honest test is simply whether points exist: `getCrashPointFeatures` reads
 * them from the run's own GeoJSON, and points are only ever emitted for an
 * observed source. Nothing here may name a specific adapter, or the next one
 * registered breaks it again.
 */
export function hasCrashPointLayer(_analysisResult: AnalysisResult | null, crashPointCount: number): boolean {
  return crashPointCount > 0;
}

export function getLinkedDatasetPreview(
  analysisContext: AnalysisContextResponse | null,
  limit = 4
): LinkedDataset[] {
  return analysisContext?.linkedDatasets.slice(0, limit) ?? [];
}
