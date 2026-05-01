"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  buildRunTitle,
  titleize,
} from "./_components/_helpers";
import { ExploreHoverInspector } from "./_components/explore-hover-inspector";
import { ExploreLayerVisibilityControls } from "./_components/explore-layer-visibility-controls";
import { ExploreResultsBoard } from "./_components/explore-results-board";
import { ExploreRunHistoryPanel } from "./_components/explore-run-history-panel";
import {
  buildCurrentMapViewState,
  getCrashPointFeatures,
  hasSwitrsPointLayer,
  resolveActiveDatasetOverlay,
  resolveWorkspaceHelperText,
  resolveWorkspaceStatusLabel,
} from "./_components/explore-page-state";
import { buildLinkedDatasetQueueState } from "./_components/explore-linked-dataset-state";
import { ExploreStudyBriefControls } from "./_components/explore-study-brief-controls";
import { useExploreMapInstance } from "./_components/use-explore-map-instance";
import { useExploreMapLayerEffects } from "./_components/use-explore-map-layer-effects";
import { useExploreRunHistory } from "./_components/use-explore-run-history";

export default function ExplorePage() {
  const { mapContainerRef, mapRef, mapReady } = useExploreMapInstance();

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

  const workspaceStatusLabel = useMemo(() => resolveWorkspaceStatusLabel(workspaceLoadState), [workspaceLoadState]);

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

  const linkedDatasetQueueState = useMemo(
    () =>
      buildLinkedDatasetQueueState({
        datasets: analysisContext?.linkedDatasets,
        activeDatasetOverlayId,
      }),
    [analysisContext?.linkedDatasets, activeDatasetOverlayId]
  );

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
