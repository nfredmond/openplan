"use client";

import { useMemo } from "react";
import type { Run } from "@/components/runs/RunHistory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildMetricDeltas, deltaTone, formatDelta, type MetricDelta } from "@/lib/analysis/compare";
import {
  normalizeMapViewState,
  summarizeMapViewState,
  type MapViewState,
} from "@/lib/analysis/map-view-state";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { downloadGeojson, downloadMetricsCsv, downloadRecordsCsv, downloadText } from "@/lib/export/download";
import { resolveStatusTone, toneFromDelta, type StatusTone } from "@/lib/ui/status";
import {
  buildRunTitle,
  formatCurrency,
  formatRunTimestamp,
  formatSourceToken,
  getComparisonNarrativeLead,
  prioritizeMapComparisonRows,
} from "./_helpers";
import type { AnalysisResult } from "./_types";
import { ExploreEmptyResultBoard } from "./explore-empty-result-board";

const COMPARISON_HEADLINE_KEYS = new Set(["overallScore", "accessibilityScore", "safetyScore", "equityScore"]);

type ExploreResultsBoardProps = {
  analysisResult: AnalysisResult | null;
  comparisonRun: Run | null;
  queryText: string;
  currentMapViewState: MapViewState;
  onClearComparison: () => void;
  onError: (message: string) => void;
};

export function ExploreResultsBoard({
  analysisResult,
  comparisonRun,
  queryText,
  currentMapViewState,
  onClearComparison,
  onError,
}: ExploreResultsBoardProps) {
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

  if (!analysisResult) {
    return <ExploreEmptyResultBoard />;
  }

  const exportMetrics = () => {
    try {
      downloadMetricsCsv(
        {
          ...analysisResult.metrics,
          mapViewState: currentMapViewState,
        },
        `openplan-${analysisResult.runId}-metrics.csv`
      );
    } catch {
      onError("Failed to export metrics CSV.");
    }
  };

  const exportGeojson = () => {
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
      onError("Failed to export result GeoJSON.");
    }
  };

  const exportComparisonCsv = () => {
    if (!comparisonRun?.metrics) {
      onError("Load a baseline run before exporting a comparison artifact.");
      return;
    }

    try {
      downloadRecordsCsv(
        comparisonExportRows,
        `openplan-${analysisResult.runId}-vs-${comparisonRun.id}-comparison.csv`
      );
    } catch {
      onError("Failed to export comparison CSV.");
    }
  };

  const exportComparisonJson = () => {
    if (!comparisonRun?.metrics) {
      onError("Load a baseline run before exporting a comparison artifact.");
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
      onError("Failed to export comparison JSON.");
    }
  };

  const resultScoreTiles: Array<{ label: string; value: string; note: string; emphasis?: boolean }> = [];

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

  const resultStatusBadges: Array<{ label: string; tone: StatusTone }> = [];

  if (analysisResult.metrics.transitAccessTier) {
    resultStatusBadges.push({
      label: `Transit access: ${String(analysisResult.metrics.transitAccessTier)}`,
      tone: resolveStatusTone(String(analysisResult.metrics.transitAccessTier)),
    });
  }

  if (analysisResult.metrics.confidence) {
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
  const currentRunTitle = analysisResult.title ?? buildRunTitle(queryText);
  const currentRunTimestampLabel = analysisResult.createdAt ? formatRunTimestamp(analysisResult.createdAt) : "Active in current session";
  const currentRunNarrativeLabel = analysisResult.aiInterpretationSource === "ai" ? "AI-assisted" : "Deterministic";
  const currentRunMapContextLabel = currentMapViewSummary.length > 0 ? `${currentMapViewSummary.length} saved checks` : "Pending";
  const currentRunOverallScore = typeof analysisResult.metrics.overallScore === "number" ? `${analysisResult.metrics.overallScore}` : "Not scored";
  const baselineRunMetrics = comparisonRun?.metrics as AnalysisResult["metrics"] | null | undefined;
  const baselineRunNarrativeLabel =
    (typeof baselineRunMetrics?.aiInterpretationSource === "string" && baselineRunMetrics.aiInterpretationSource === "ai") ||
    (typeof baselineRunMetrics?.dataQuality?.aiInterpretationSource === "string" && baselineRunMetrics.dataQuality.aiInterpretationSource === "ai") ||
    Boolean(comparisonRun?.ai_interpretation)
      ? "AI-assisted"
      : "Deterministic";
  const baselineRunMapContextLabel = baselineMapViewSummary.length > 0 ? `${baselineMapViewSummary.length} saved checks` : "Not captured";
  const baselineRunOverallScore = typeof baselineRunMetrics?.overallScore === "number" ? `${baselineRunMetrics.overallScore}` : "Not scored";
  const currentHistoryHref = analysisResult.runId ? "#analysis-run-history-current" : "#analysis-run-history";
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

  return (
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
                      <Button type="button" variant="ghost" onClick={onClearComparison}>
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
                      <Button type="button" variant="ghost" onClick={onClearComparison}>
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
  );
}
