"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import type { PlaceOfRecord } from "@/lib/geographies/place-of-record";
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
} from "./_types";
import {
  buildRunTitle,
  titleize,
} from "./_helpers";
import { ExploreHoverInspector } from "./explore-hover-inspector";
import { ExploreLayerVisibilityControls } from "./explore-layer-visibility-controls";
import { ExploreWorkspaceLayersPanel } from "./explore-workspace-layers-panel";
import { exploreWorkspaceGisAnchorLayerId } from "./explore-workspace-gis-anchor";
import { useExploreWorkspaceGisHover } from "./explore-workspace-gis-hover";
import { useWorkspaceGisMapBinding } from "@/components/cartographic/use-workspace-gis-map-binding";
import { useAerialOrthoMapBinding } from "@/components/cartographic/use-aerial-ortho-map-binding";
import { ExploreResultsBoard } from "./explore-results-board";
import { describeRequestFailure } from "@/lib/http/request-failure";
import { ExploreRunHistoryPanel } from "./explore-run-history-panel";
import {
  buildCurrentMapViewState,
  canRunAnalysis,
  describeRunAnalysisBlock,
  getCrashPointFeatures,
  hasCrashPointLayer,
  resolveActiveDatasetOverlay,
  resolveWorkspaceHelperText,
  resolveWorkspaceStatusLabel,
} from "./explore-page-state";
import { buildLinkedDatasetQueueState } from "./explore-linked-dataset-state";
import { ExploreStudyAreaPanel } from "./explore-study-area-panel";
import { ExploreStudyBriefControls } from "./explore-study-brief-controls";
import { useExploreStudyArea } from "./use-explore-study-area";
import { useExploreMapInstance } from "./use-explore-map-instance";
import { useExploreMapLayerEffects } from "./use-explore-map-layer-effects";
import { useExploreRunHistory } from "./use-explore-run-history";

/**
 * Everything Analysis Studio does once the page is on screen.
 *
 * WHY THIS IS NOT `page.tsx` ANY MORE. It used to be, and the study area it
 * opened on came from one client fetch of the workspace's home geography — the
 * only geography a client page could reach. That made Explore the last of the
 * three study-area front doors still analyzing the workspace's county for an
 * agency whose project was a corridor. The loader above now reads the project
 * named in `?projectId=` — a row no client-reachable endpoint exposes, and none
 * was invented for it — and hands its area of record down as a candidate. The
 * workbench stays a client component because the map, the run history and the
 * workspace bootstrap all live in the browser.
 */
type ExploreWorkbenchProps = {
  /**
   * The area of record of the project this page was opened for, or null when no
   * project was named or its area could not be used. Outranks the workspace home
   * geography — see `resolveStudyArea`.
   */
  projectPlace: PlaceOfRecord | null;
  /** That project's identity, when the row was read and belongs to this workspace. */
  openedForProject: { id: string; name: string | null } | null;
  /** Why the project's area is not the one on screen, when it isn't. */
  projectAreaNotice: string | null;
};

export function ExploreWorkbench({
  projectPlace,
  openedForProject,
  projectAreaNotice,
}: ExploreWorkbenchProps) {
  const { mapContainerRef, mapRef, mapReady, mapUnavailableReason } = useExploreMapInstance();

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
  // Opening for a project means opening for it in both senses: the study area
  // below is inherited from it, and the runs saved here are attributed to it.
  // Analyzing a project's corridor and filing the run under whichever project
  // was updated most recently would be a quieter version of the same defect.
  const [selectedProjectId, setSelectedProjectId] = useState(openedForProject?.id ?? "");
  const [workspaceProjects, setWorkspaceProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [activeDatasetOverlayId, setActiveDatasetOverlayId] = useState<string | null>(null);
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
  /**
   * The workspace layer the planner is pointing at in the rail, or null.
   *
   * Transient and never persisted — pointer in, pointer out, focus in, focus
   * out. It exists because a workspace with six uploaded layers is six sets of
   * lines a planner has to tell apart, and "which of these is the bike network"
   * is a question the map can answer for a second without becoming a mode
   * anybody has to switch off afterwards.
   */
  const [emphasisLayerId, setEmphasisLayerId] = useState<string | null>(null);

  /**
   * The agency's own uploaded layers, on Corridor Analysis's map.
   *
   * THE SAME HOOK THE SHELL BACKDROP CALLS. Explore builds its own
   * `mapboxgl.Map` and the shell backdrop suppresses itself here, which is why
   * this page drew none of a workspace's layers until now — the one page a
   * planner opens in order to READ a map was the one page their own data never
   * reached. The repair is the second caller of one capability, not a second
   * implementation of it: what differs between the two maps is the anchor (what
   * these layers sit beneath) and the basemap theme, and both are arguments.
   *
   * `enabled` waits for the workspace, because a catalog read before the
   * bootstrap knows which workspace this is can only fail — and a failed read
   * registers a catalog error the panel would then show a planner who did
   * nothing wrong.
   */
  const { workspaceLayers, workspaceLayerVisibility } = useWorkspaceGisMapBinding({
    mapRef,
    ready: mapReady,
    enabled: mapReady && workspaceId !== "",
    workspaceId: workspaceId || null,
    // Explore's basemap is dark-v11 whatever the app chrome is set to, so the
    // casing under every workspace line is the dark ink. Passing the app theme
    // here would put a white halo on a dark map.
    theme: "dark",
    resolveAnchorLayerId: exploreWorkspaceGisAnchorLayerId,
    emphasisLayerId,
  });
  useAerialOrthoMapBinding({
    mapRef,
    ready: mapReady,
    enabled: mapReady && workspaceId !== "",
    resolveAnchorLayerId: (map) => exploreWorkspaceGisAnchorLayerId(map),
  });

  const hoveredWorkspaceFeature = useExploreWorkspaceGisHover({
    mapRef,
    mapReady,
    layers: workspaceLayers,
    visibility: workspaceLayerVisibility,
  });

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
        const projectParam = selectedProjectId
          ? `&projectId=${encodeURIComponent(selectedProjectId)}`
          : "";
        const response = await fetch(
          `/api/analysis/context?workspaceId=${encodeURIComponent(workspaceId)}${projectParam}`,
          { method: "GET" },
        );

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
  }, [workspaceId, selectedProjectId]);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspaceProjects() {
      if (!workspaceId) {
        setWorkspaceProjects([]);
        return;
      }

      try {
        const response = await fetch("/api/projects", { method: "GET" });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          projects?: Array<{ id: string; name: string; workspace_id: string }>;
        };
        if (isCancelled) return;
        setWorkspaceProjects(
          (payload.projects ?? [])
            .filter((project) => project.workspace_id === workspaceId)
            .map((project) => ({ id: project.id, name: project.name })),
        );
      } catch {
        // The picker is an attribution convenience; analysis works without it.
      }
    }

    void loadWorkspaceProjects();

    return () => {
      isCancelled = true;
    };
  }, [workspaceId]);

  // Which area this study opens on: the project this page was opened for, else
  // where the agency works, else nothing. A planner who has already stated
  // either does not re-pick it on arrival, and an unset or unreachable geography
  // preselects nothing — never a guessed place.
  const { studyArea, loadState: homeGeographyLoadState } = useExploreStudyArea({
    workspaceId,
    projectPlace,
    setCorridorGeojson,
  });

  useExploreMapLayerEffects({
    mapRef,
    mapReady,
    analysisContext,
    activeDatasetOverlayId,
    analysisResult,
    corridorGeojson,
    cameraMode,
    showPolygonFill,
    showPoints,
    showTracts,
    showCrashes,
    tractMetric,
    crashSeverityFilter,
    crashUserFilter,
    setHoveredTract,
    setHoveredCrash,
  });

  const trimmedQueryText = queryText.trim();
  const isQueryTooLong = trimmedQueryText.length > ANALYSIS_QUERY_MAX_CHARS;

  const canSubmit = useMemo(
    () => canRunAnalysis({ workspaceId, queryText, corridorGeojson }),
    [workspaceId, queryText, corridorGeojson]
  );
  /** The same three inputs, said out loud — see describeRunAnalysisBlock. */
  const runBlockReason = useMemo(
    () => describeRunAnalysisBlock({ workspaceId, queryText, corridorGeojson }),
    [workspaceId, queryText, corridorGeojson]
  );
  /**
   * The same question, asked about a question the workbench has not seen yet.
   * The brief sheet collects the text and submits in the same tick, so it cannot
   * use `runBlockReason` — that describes the render it is still standing in.
   */
  const evaluateRunBlock = useCallback(
    (candidateQueryText: string) =>
      describeRunAnalysisBlock({ workspaceId, queryText: candidateQueryText, corridorGeojson }),
    [workspaceId, corridorGeojson]
  );

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
          ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
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
      setError(describeRequestFailure(submitError, "run the analysis"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const bootstrapWorkspace = async () => {
    const trimmedName = bootstrapWorkspaceName.trim();

    if (!trimmedName) {
      // No "pilot": OpenPlan is self-serve, and the person reading this is
      // creating their own workspace with nobody supervising it.
      setError("Enter a name for your workspace before creating it.");
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
        body: JSON.stringify({ workspaceName: trimmedName }),
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
      setError(describeRequestFailure(bootstrapError, "create the workspace"));
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
      setError(describeRequestFailure(reportError, "generate the report"));
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

  const workspaceStatusLabel = useMemo(() => resolveWorkspaceStatusLabel(workspaceLoadState), [workspaceLoadState]);

  const crashPointFeatures = useMemo(
    () => getCrashPointFeatures(analysisResult),
    [analysisResult]
  );

  const crashPointCount = crashPointFeatures.length;

  const crashPointLayerAvailable = hasCrashPointLayer(analysisResult, crashPointCount);

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

  const linkedDatasetQueueState = useMemo(
    () =>
      buildLinkedDatasetQueueState({
        datasets: analysisContext?.linkedDatasets,
        activeDatasetOverlayId,
      }),
    [analysisContext?.linkedDatasets, activeDatasetOverlayId]
  );

  /*
      THE MAP STAGE NEEDS A DEFINITE HEIGHT, AND THE MAP NEEDS A REAL SIZE.

      Two bugs stacked here, and the map rendered blank because of both.

      1. `min-h-[calc(100dvh-3rem)]` set a FLOOR, not a height, so the grid row
         sized to its tallest cell — the right-hand rail, which is a long
         scrolling column. Measured on a live workspace: the stage had grown to
         16,286px. `100dvh` was also the wrong quantity, because this page is
         rendered inside the cartographic surface, whose height is not the
         viewport's. `lg:h-full` takes the height the surface actually gives it,
         and `lg:grid-rows-[minmax(0,1fr)]` stops the row expanding past it, so
         the rail scrolls inside itself as it was always meant to.

      2. The map container was `absolute inset-0`. `mapbox-gl.css` sets
         `.mapboxgl-map { position: relative }` — the same specificity as
         Tailwind's `.absolute`, and it loads later, so it WINS and cancels the
         positioning the sizing depended on. The container then had no height at
         all: computed 0px inside a 16,286px parent. `h-full w-full` does not
         depend on positioning and survives the override.

      /safety was healthy throughout because its map container is sized
      directly rather than through `inset-0`.
  */
  return (
    <section className="analysis-explore-shell grid min-h-[520px] gap-0 overflow-hidden lg:h-full lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[minmax(0,1fr)]">
      <div className="analysis-explore-mapstage relative min-h-[360px] overflow-hidden lg:min-h-0">
        <div ref={mapContainerRef} className="h-full w-full" />

        {/*
          AN EMPTY MAP PANE MUST SAY WHY IT IS EMPTY. Without a usable Mapbox
          token the hook never creates the map, and this stage rendered as a
          permanently blank rectangle — the 2026-08-03 review's finding #6. A
          planner reads silence as broken software; the analysis lanes still
          work without the basemap, and this says both things.
        */}
        {mapUnavailableReason ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center p-6"
            data-testid="explore-map-unavailable"
          >
            <div className="max-w-md rounded-[0.5rem] border border-dashed border-white/25 bg-slate-900/85 px-5 py-4 text-sm text-slate-300 shadow-lg backdrop-blur-sm">
              <p className="font-medium text-white">No map key is configured on this deployment</p>
              <p className="mt-1.5">
                {mapUnavailableReason === "unusable_token"
                  ? "A Mapbox token is set but is not a public key. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a token beginning with pk. — a secret sk. token is deliberately refused rather than sent to the browser."
                  : "Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (it begins with pk.) and this map will draw."}
              </p>
              <p className="mt-1.5">
                Analyses still run without the basemap — only the map display is affected.
              </p>
            </div>
          </div>
        ) : null}

        {/*
          WHAT THE POINTER IS OVER, in the corner of the map rather than in the
          rail. Explore already answers a hover over a tract and over a crash;
          this is the same gesture for the agency's own shapes, and it sits on
          the map because that is where the planner is looking when they ask.

          `aria-live="polite"` rather than silence: a readout that only exists
          for sighted pointer users is a readout half the product cannot use.
          Polite rather than assertive because a pointer sweeping across a
          parcel fabric would otherwise interrupt continuously.
        */}
        {hoveredWorkspaceFeature ? (
          <div
            className="analysis-explore-workspace-hover"
            data-testid="explore-workspace-layer-hover"
            aria-live="polite"
          >
            <p className="analysis-explore-workspace-hover__layer">
              {hoveredWorkspaceFeature.layerName}
            </p>
            {hoveredWorkspaceFeature.label ? (
              <p className="analysis-explore-workspace-hover__label">
                {hoveredWorkspaceFeature.label}
              </p>
            ) : null}
            {hoveredWorkspaceFeature.attributes.length > 0 ? (
              <dl className="analysis-explore-workspace-hover__attrs">
                {hoveredWorkspaceFeature.attributes.map((attribute) => (
                  <div key={attribute.field}>
                    <dt>{attribute.field}</dt>
                    <dd>{attribute.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}

        {!analysisResult && !mapUnavailableReason ? (
          <div className="analysis-explore-map-intro absolute left-4 top-4 z-10 max-w-[min(84%,360px)] text-white sm:left-5 sm:top-5">
            <p className="text-[0.64rem] font-bold uppercase tracking-[0.2em] text-cyan-300/70">
              Corridor Analysis
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
              Start with your study area.
            </h2>
            <p className="mt-1.5 text-[0.82rem] leading-relaxed text-slate-300/80">
              Search for your county, city, or metro area — or draw it, or upload a boundary file. Then
              frame the planning question and run the analysis.
            </p>
          </div>
        ) : null}
      </div>

      <aside className="analysis-explore-rail flex min-h-0 flex-col overflow-y-auto">
        <div className="analysis-explore-rail-header">
          {/* One heading, not two. The eyebrow said "Corridor Analysis" and the
              heading under it said "Corridor Analysis" again, and this page had
              no h1 at all — so the first heading a screen reader met was a
              duplicate of the label above it. */}
          <h1 className="text-lg font-semibold tracking-tight text-white">Corridor Analysis</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300/78">Use the map on the left and the controls here to set the study area, compare conditions, and review outputs.</p>
          {/* WHERE THIS PAGE SITS, said on the page itself.
              Nathaniel, 2026-08-13: "the analysis section with modelling and
              corridor analysis and whatnot is super confusing." Four of the five
              entries in this nav group are one procedure with an order; this one
              is not in it, and it writes a different history table from the
              modeling runs. Nothing on screen said so, so a planner looking for
              step one of the modeling work could reasonably start here. */}
          <p className="mt-2 text-sm leading-6 text-slate-300/78">
            This is a separate tool from Models, Scenarios and Model Validation. Those three are one
            job in a set order; this page is a map for looking at one corridor, and it keeps its own
            history.{" "}
            <Link href="/models" className="underline underline-offset-2 hover:text-white">
              See how the modeling work fits together
            </Link>
            .
          </p>
        </div>
        <div className="space-y-5 px-5 py-4">
          <div className="space-y-3.5">
            <section className="analysis-studio-surface">
              <div className="analysis-studio-header">
                <div className="analysis-studio-heading">
                  <p className="analysis-studio-label">Study setup</p>
                  <h3 className="analysis-studio-title">Workspace and intake</h3>
                  <p className="analysis-studio-description">Connect the workspace and confirm membership. The study area is set below — pick a place, draw one, or upload a boundary file.</p>
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
                      <p className="analysis-sidepanel-body">No workspace membership detected. Create a workspace to start using Corridor Analysis.</p>
                    </div>
                    <div className="analysis-studio-input-stack">
                      <Input
                        value={bootstrapWorkspaceName}
                        onChange={(event) => setBootstrapWorkspaceName(event.target.value)}
                        placeholder="Your agency or firm's name"
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
                    <p className="analysis-studio-inline-meta-label">Getting started in this workspace</p>
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
                        ? analysisContext.projectSelection === "explicit"
                          ? "Runs you save will be attributed to this project."
                          : "Showing the most recently updated project — pick one to attribute your runs."
                        : analysisContextLoadState === "error"
                          ? "Project context is temporarily unavailable."
                          : "No project is attached to this workspace yet."}
                  </p>
                </div>
                <div className="module-record-actions">
                  {workspaceProjects.length > 0 ? (
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                      aria-label="Attribute analysis to project"
                      value={selectedProjectId}
                      onChange={(event) => setSelectedProjectId(event.target.value)}
                    >
                      <option value="">No project selected</option>
                      {workspaceProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {analysisContext?.project && analysisContext.projectSelection === "explicit" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/projects/${analysisContext.project.id}`}>Open Project</Link>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/data-hub">Open Data Hub</Link>
                  </Button>
                </div>
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
                    label="Across your workspace"
                    title="What needs attention next"
                    description="The most pressing work anywhere in this workspace, kept in view so it does not get lost while you are in here."
                  />

                  {analysisContext.migrationPending ? (
                    <div className="module-alert text-xs">
                      Data Hub is wired into Corridor Analysis, but the current database still needs the latest migration before linked datasets can fully appear here.
                    </div>
                  ) : linkedDatasetQueueState.items.length > 0 ? (
                    <div className="space-y-3">
                      <div>
                        <p className="module-section-label">Map-linked dataset queue</p>
                        <p className="module-summary-detail mt-1">
                          Select a dataset to compare coverage vs thematic states without leaving the analysis panel.
                        </p>
                      </div>
                      <div className="module-record-list">
                        {linkedDatasetQueueState.items.map((item) => {
                          const { dataset } = item;
                          return (
                            <article
                              key={dataset.datasetId}
                              className={item.rowClassName}
                            >
                              <div className="module-record-head">
                                <div className="module-record-main">
                                  <div className="module-record-kicker">
                                    <StatusBadge tone={resolveStatusTone(dataset.status)}>{titleize(dataset.status)}</StatusBadge>
                                    <StatusBadge tone="info">{titleize(dataset.relationshipType)}</StatusBadge>
                                    <StatusBadge tone={item.overlayStatusTone}>{item.overlayStatusLabel}</StatusBadge>
                                    {item.thematicReady ? <StatusBadge tone="warning">Thematic-ready</StatusBadge> : null}
                                  </div>
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <p className="module-record-title">{dataset.name}</p>
                                    <p className="module-record-stamp">
                                      {item.refreshedLabel}
                                    </p>
                                  </div>
                                  <p className="module-record-summary">{item.summary}</p>
                                  <div className="module-record-meta">
                                    <span className="module-record-chip">Scope {titleize(dataset.geographyScope)}</span>
                                    <span className="module-record-chip">Source {item.sourceLabel}</span>
                                    {dataset.vintageLabel ? <span className="module-record-chip">Vintage {dataset.vintageLabel}</span> : null}
                                    {dataset.thematicMetricLabel ? <span className="module-record-chip">Metric {dataset.thematicMetricLabel}</span> : null}
                                  </div>
                                </div>

                                <div className="module-record-actions">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={item.buttonVariant}
                                    disabled={item.buttonDisabled}
                                    onClick={() =>
                                      setActiveDatasetOverlayId((current) =>
                                        current === dataset.datasetId ? null : dataset.datasetId
                                      )
                                    }
                                  >
                                    {item.buttonLabel}
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
            <ExploreStudyAreaPanel
              corridorGeojson={corridorGeojson}
              onCorridorChange={setCorridorGeojson}
              studyArea={studyArea}
              homeGeographyLoadState={homeGeographyLoadState}
              openedForProject={openedForProject}
              projectAreaNotice={projectAreaNotice}
            />

            <ExploreLayerVisibilityControls
              mapReady={mapReady}
              showPolygonFill={showPolygonFill}
              onTogglePolygonFill={() => setShowPolygonFill((v) => !v)}
              showTracts={showTracts}
              onToggleTracts={() => setShowTracts((v) => !v)}
              showCrashes={showCrashes}
              onToggleCrashes={() => setShowCrashes((v) => !v)}
              crashPointLayerAvailable={crashPointLayerAvailable}
              tractMetric={tractMetric}
              onChangeTractMetric={(value) => setTractMetric(value)}
            />

            {/*
              Directly under the built-in toggles, because to a planner these
              are the same question — "what is drawn on this map" — and the fact
              that one set is OpenPlan's records and the other is their own
              uploads is an implementation detail of where the rows live.
            */}
            <ExploreWorkspaceLayersPanel onEmphasize={setEmphasisLayerId} />

            <ExploreHoverInspector
              showTracts={showTracts}
              crashPointLayerAvailable={crashPointLayerAvailable}
              tractMetric={tractMetric}
              hoveredTract={hoveredTract}
              hoveredCrash={hoveredCrash}
              crashSeverityFilter={crashSeverityFilter}
              crashUserFilter={crashUserFilter}
            />

            <ExploreStudyBriefControls
              projects={workspaceProjects}
              selectedProjectId={selectedProjectId}
              onSelectedProjectIdChange={setSelectedProjectId}
              queryText={queryText}
              isQueryTooLong={isQueryTooLong}
              reportTemplate={reportTemplate}
              canSubmit={canSubmit}
              blockReason={runBlockReason}
              evaluateRunBlock={evaluateRunBlock}
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
