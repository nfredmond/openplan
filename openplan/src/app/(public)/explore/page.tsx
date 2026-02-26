"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import maplibregl, { LngLatBoundsLike, Map } from "maplibre-gl";
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
import { buildMetricDeltas, deltaTone, formatDelta } from "@/lib/analysis/compare";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { downloadGeojson, downloadMetricsCsv } from "@/lib/export/download";
import { resolveStatusTone, toneFromDelta } from "@/lib/ui/status";

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
    dataQuality?: {
      censusAvailable?: boolean;
      crashDataAvailable?: boolean;
      lodesSource?: string;
      equitySource?: string;
      aiInterpretationSource?: string;
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
  const [error, setError] = useState("");
  const [workspaceLoadState, setWorkspaceLoadState] = useState<WorkspaceLoadState>("loading");
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null);
  const [bootstrapWorkspaceName, setBootstrapWorkspaceName] = useState("");
  const [isBootstrappingWorkspace, setIsBootstrappingWorkspace] = useState(false);
  const [bootstrapChecklist, setBootstrapChecklist] = useState<string[]>([]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [-96, 38],
      zoom: 3,
    });

    map.on("load", () => {
      map.addSource("analysis-result", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "analysis-fill",
        type: "fill",
        source: "analysis-result",
        paint: {
          "fill-color": "#0f766e",
          "fill-opacity": 0.3,
        },
        filter: ["==", ["geometry-type"], "Polygon"],
      });

      map.addLayer({
        id: "analysis-outline",
        type: "line",
        source: "analysis-result",
        paint: {
          "line-color": "#115e59",
          "line-width": 2,
        },
      });

      map.addLayer({
        id: "analysis-points",
        type: "circle",
        source: "analysis-result",
        paint: {
          "circle-radius": 6,
          "circle-color": "#be123c",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
        filter: ["==", ["geometry-type"], "Point"],
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
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
    if (!analysisResult || !mapRef.current) {
      return;
    }

    const source = mapRef.current.getSource("analysis-result") as
      | maplibregl.GeoJSONSource
      | undefined;

    if (source) {
      source.setData(analysisResult.geojson);
    }

    if (corridorGeojson) {
      const bounds = getBoundsFromGeometry(corridorGeojson);
      if (bounds) {
        mapRef.current.fitBounds(bounds, { padding: 40, duration: 450 });
      }
    }
  }, [analysisResult, corridorGeojson]);

  const canSubmit = useMemo(() => {
    return Boolean(workspaceId && queryText.trim().length > 0 && corridorGeojson);
  }, [workspaceId, queryText, corridorGeojson]);

  const runAnalysis = async () => {
    if (!corridorGeojson || !workspaceId || !queryText.trim()) {
      setError("Workspace ID, corridor, and query are required.");
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
          queryText: queryText.trim(),
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
        body: JSON.stringify({ runId: analysisResult.runId }),
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
        body: JSON.stringify({ runId: analysisResult.runId, format: "pdf" }),
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

  return (
    <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
      <div className="overflow-hidden rounded-2xl border border-border/80 shadow-[0_10px_30px_rgba(20,33,43,0.08)]">
        <div ref={mapContainerRef} className="h-[560px] w-full" />
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Corridor Analysis Studio</CardTitle>
            <CardDescription>Upload a corridor, frame the planning question, and generate grant-ready outputs.</CardDescription>
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
            <Textarea
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Example: Evaluate transit accessibility, safety risk, and equity implications for this corridor."
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void runAnalysis()} disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Running analysis..." : "Run Corridor Analysis"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void generateReport()}
                disabled={!analysisResult?.runId || isGeneratingReport}
              >
                {isGeneratingReport ? "Generating report..." : "Open HTML Report"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void downloadPdfReport()}
                disabled={!analysisResult?.runId || isDownloadingPdf}
              >
                {isDownloadingPdf ? "Preparing PDF..." : "Download PDF Report"}
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
