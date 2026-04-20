"use client";

import type { Run } from "@/components/runs/RunHistory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { deltaTone, formatDelta } from "@/lib/analysis/compare";
import { toneFromDelta } from "@/lib/ui/status";
import { formatRunTimestamp } from "./_helpers";
import type { AnalysisResult } from "./_types";
import type {
  ComparisonDelta,
  ComparisonNarrativeLead,
  MapViewComparisonRow,
} from "./explore-results-types";

type ExploreRunComparisonCardProps = {
  analysisResult: AnalysisResult;
  comparisonRun: Run;
  comparisonMetricChangeCount: number;
  comparisonViewDifferenceCount: number;
  comparisonNarrativeLead: ComparisonNarrativeLead;
  comparisonHeadlineDeltas: ComparisonDelta[];
  comparisonSupportingDeltas: ComparisonDelta[];
  comparisonChangedDeltas: ComparisonDelta[];
  prioritizedMapViewComparisonRows: MapViewComparisonRow[];
  changedMapViewRows: MapViewComparisonRow[];
  alignedMapViewRows: MapViewComparisonRow[];
  currentRunTitle: string;
  currentRunTimestampLabel: string;
  currentRunNarrativeLabel: string;
  currentRunMapContextLabel: string;
  currentRunOverallScore: string;
  baselineRunNarrativeLabel: string;
  baselineRunMapContextLabel: string;
  baselineRunOverallScore: string;
  currentHistoryHref: string;
  baselineHistoryHref: string;
  onClearComparison: () => void;
  onExportComparisonCsv: () => void;
  onExportComparisonJson: () => void;
};

export function ExploreRunComparisonCard({
  analysisResult,
  comparisonRun,
  comparisonMetricChangeCount,
  comparisonViewDifferenceCount,
  comparisonNarrativeLead,
  comparisonHeadlineDeltas,
  comparisonSupportingDeltas,
  comparisonChangedDeltas,
  prioritizedMapViewComparisonRows,
  changedMapViewRows,
  alignedMapViewRows,
  currentRunTitle,
  currentRunTimestampLabel,
  currentRunNarrativeLabel,
  currentRunMapContextLabel,
  currentRunOverallScore,
  baselineRunNarrativeLabel,
  baselineRunMapContextLabel,
  baselineRunOverallScore,
  currentHistoryHref,
  baselineHistoryHref,
  onClearComparison,
  onExportComparisonCsv,
  onExportComparisonJson,
}: ExploreRunComparisonCardProps) {
  return (
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
                {comparisonSupportingDeltas.map((delta) => {
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
                <Button type="button" variant="outline" onClick={onExportComparisonCsv}>
                  Export Comparison CSV
                </Button>
                <Button type="button" variant="outline" onClick={onExportComparisonJson}>
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
  );
}
