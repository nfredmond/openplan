"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AnalysisResult } from "./_types";
import type {
  MapViewSummaryItem,
  ResultScoreTile,
  ResultStatusBadge,
  SourceTransparency,
} from "./explore-results-types";

type ExploreCurrentResultCardProps = {
  analysisResult: AnalysisResult;
  comparisonActive: boolean;
  currentRunTitle: string;
  currentRunTimestampLabel: string;
  currentRunNarrativeLabel: string;
  currentRunMapContextLabel: string;
  currentMapViewSummary: MapViewSummaryItem[];
  resultScoreTiles: ResultScoreTile[];
  resultStatusBadges: ResultStatusBadge[];
  sourceTransparency: SourceTransparency[];
  sourceReviewCount: number;
  comparisonMetricChangeCount: number;
  comparisonViewDifferenceCount: number;
  onExportMetrics: () => void;
  onExportGeojson: () => void;
};

export function ExploreCurrentResultCard({
  analysisResult,
  comparisonActive,
  currentRunTitle,
  currentRunTimestampLabel,
  currentRunNarrativeLabel,
  currentRunMapContextLabel,
  currentMapViewSummary,
  resultScoreTiles,
  resultStatusBadges,
  sourceTransparency,
  sourceReviewCount,
  comparisonMetricChangeCount,
  comparisonViewDifferenceCount,
  onExportMetrics,
  onExportGeojson,
}: ExploreCurrentResultCardProps) {
  return (
    <Card
      className={[
        "analysis-explore-surface analysis-explore-surface-current",
        comparisonActive ? "is-paired" : "",
      ].join(" ")}
    >
      <CardHeader className="gap-3 border-b border-white/8 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="info">Current result</StatusBadge>
          <StatusBadge tone={comparisonActive ? "warning" : "neutral"}>
            {comparisonActive ? "Paired with baseline" : "Standalone review"}
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
              {comparisonActive
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
        {comparisonActive ? (
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
              <Button type="button" variant="outline" onClick={onExportMetrics}>
                Export Metrics CSV
              </Button>
              <Button type="button" variant="outline" onClick={onExportGeojson}>
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
  );
}
