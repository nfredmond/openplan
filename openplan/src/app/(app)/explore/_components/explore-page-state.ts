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

/**
 * WHY THE RUN GATE IS CLOSED, in the words of the thing that is actually missing.
 *
 * WHERE THIS CAME FROM. A tester searched a place, watched the panel say "Study
 * area set" with its area in km², pressed Run, and was told to DRAW A CORRIDOR —
 * the one thing they had just done. They had not yet typed the question, and the
 * refusal said so nowhere. They filed it as a blocker and reported the panel and
 * the run wizard as disagreeing about what counts as a corridor. They were not
 * disagreeing: the gate wants three things and the refusal only ever named one.
 *
 * Being told to redo work you have already done is worse than being told
 * nothing, because it sends a planner back to a map that was never the problem.
 *
 * ONE DEFINITION, because the disabled trigger's hint and the wizard's own
 * refusal used to be two hand-written strings that could not both stay true.
 * Returns null when the gate is OPEN, so a caller cannot render a reason that
 * does not exist.
 */
export function describeRunAnalysisBlock({
  workspaceId,
  queryText,
  corridorGeojson,
}: {
  workspaceId: string;
  queryText: string;
  corridorGeojson: CorridorGeometry | null;
}): string | null {
  if (!workspaceId) {
    return "This workspace is still loading. Give it a moment, and reload the page if it does not settle.";
  }

  const trimmed = queryText.trim();
  const needsArea = !corridorGeojson;
  const needsQuestion = trimmed.length === 0;

  // Both missing is the opening state, and naming both is what stops a planner
  // fixing one and being refused again for the other.
  if (needsArea && needsQuestion) {
    return "Set the study area — search a place or draw one — and write the question this run should answer.";
  }
  if (needsArea) {
    return "Set the study area first: search a place, draw one on the map, or upload a boundary file.";
  }
  if (needsQuestion) {
    return "Write the question this run should answer. The study area is set.";
  }
  if (trimmed.length > ANALYSIS_QUERY_MAX_CHARS) {
    return `The question is ${trimmed.length.toLocaleString()} characters, and the limit is ${ANALYSIS_QUERY_MAX_CHARS.toLocaleString()}. Shorten it and run again.`;
  }
  return null;
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
