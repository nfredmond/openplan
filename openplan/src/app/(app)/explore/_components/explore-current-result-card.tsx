"use client";

import Link from "next/link";
import {
  CORRIDOR_ANALYSIS_DOES_NOT_ANSWER,
  CORRIDOR_ANALYSIS_TRAFFIC_HREF,
} from "@/lib/analysis/what-this-answers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DecisionUseDisclosure } from "@/lib/analysis/decision-use";
import type { AnalysisResult } from "./_types";
import { withPlanningContext } from "@/lib/projects/planning-context";
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
  /** How far this run may be carried into a decision — rendered as visible text. */
  decisionUse: DecisionUseDisclosure;
  resultScoreTiles: ResultScoreTile[];
  resultStatusBadges: ResultStatusBadge[];
  sourceTransparency: SourceTransparency[];
  sourceReviewCount: number;
  comparisonMetricChangeCount: number;
  comparisonViewDifferenceCount: number;
  onExportMetrics: () => void;
  onExportGeojson: () => void;
  projectId?: string | null;
};

export function ExploreCurrentResultCard({
  analysisResult,
  comparisonActive,
  currentRunTitle,
  currentRunTimestampLabel,
  currentRunNarrativeLabel,
  currentRunMapContextLabel,
  currentMapViewSummary,
  decisionUse,
  resultScoreTiles,
  resultStatusBadges,
  sourceTransparency,
  sourceReviewCount,
  comparisonMetricChangeCount,
  comparisonViewDifferenceCount,
  onExportMetrics,
  onExportGeojson,
  projectId = null,
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
                  ? "OpenPlan screening composite. No qualitative score bands have been validated."
                  : analysisResult.metrics.scorePresentation?.overall.withheldReason ?? "Composite overall score is withheld because required source evidence is unavailable; supported component evidence remains below."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {resultStatusBadges.map((item) => (
                <StatusBadge key={item.label} tone={item.tone} title={item.title}>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                  {item.estimated ? (
                    <StatusBadge tone="warning" title={item.estimatedNote}>
                      Estimated
                    </StatusBadge>
                  ) : null}
                </div>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">{item.value}</p>
                <p className="mt-2 text-xs leading-5 text-slate-300/72">{item.note}</p>
                {item.estimated && item.estimatedNote ? (
                  <p className="mt-1 text-xs leading-5 text-slate-400/85">{item.estimatedNote}</p>
                ) : null}
              </div>
            ))}
          </div>

          {/*
            The run's decision-use boundary, in visible text rather than only a
            badge tooltip. It sits directly under the scores because it is the
            sentence that bounds them: the scores are a screen, and the one thing
            a planner must not do is carry a screen into a determination.
          */}
          <div className="mt-4 rounded-[0.5rem] border border-amber-300/20 bg-amber-400/[0.06] px-4 py-3">
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-amber-200/80">
              {decisionUse.label}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-200/85">{decisionUse.detail}</p>
            {/*
              WHAT THIS RESULT IS NOT, beside the result rather than in help.

              A tester ran this to answer "how much traffic and how much
              driving", read scores for accessibility, safety and equity, and had
              to work out for themselves that the question had not been answered.
              Saying it here costs one sentence; not saying it cost them the job.
            */}
            <p className="mt-2 text-xs leading-5 text-slate-200/85">
              {CORRIDOR_ANALYSIS_DOES_NOT_ANSWER}{" "}
              <Link
                href={withPlanningContext(CORRIDOR_ANALYSIS_TRAFFIC_HREF, projectId)}
                className="underline underline-offset-2"
              >
                Run a travel model
              </Link>
              .
            </p>
            {projectId ? (
              <div className="mt-4 border-t border-amber-200/15 pt-4" data-testid="project-effect-answer">
                <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-amber-200/80">
                  Answer to the project question
                </p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold text-slate-100">Traffic after the build</dt>
                    <dd className="mt-1 text-xs leading-5 text-slate-300/85">
                      Not measured by this run. These are current conditions, not a project forecast.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-100">Change in miles driven</dt>
                    <dd className="mt-1 text-xs leading-5 text-slate-300/85">
                      Not measured by this run. No checked baseline-versus-build result is attached.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-100">Whether benefits justify cost</dt>
                    <dd className="mt-1 text-xs leading-5 text-slate-300/85">
                      Cannot be determined from a current-conditions screen. Do not treat the scores below as project benefits.
                    </dd>
                  </div>
                </dl>
                <Link
                  href={withPlanningContext(CORRIDOR_ANALYSIS_TRAFFIC_HREF, projectId)}
                  className="mt-3 inline-flex text-xs font-semibold text-amber-100 underline underline-offset-2"
                >
                  Start the guided baseline-versus-build setup
                </Link>
              </div>
            ) : null}
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
