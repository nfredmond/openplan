"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeMapViewState, summarizeMapViewState } from "@/lib/analysis/map-view-state";

export type Run = {
  id: string;
  title: string;
  query_text: string;
  created_at: string;
  corridor_geojson?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  metrics?: Record<string, unknown> | null;
  result_geojson?: GeoJSON.FeatureCollection | null;
  summary_text?: string | null;
  ai_interpretation?: string | null;
};

type RunHistoryProps = {
  workspaceId: string;
  onLoadRun?: (run: Run) => void;
  onCompareRun?: (run: Run) => void;
  onClearComparison?: () => void;
  currentRunId?: string;
  currentRunTitle?: string | null;
  currentRunCreatedAt?: string | null;
  comparisonRunId?: string;
  comparisonRunTitle?: string | null;
  comparisonRunCreatedAt?: string | null;
};

const RUN_HISTORY_LIMIT = 25;
const MAP_CONTEXT_PRIORITY = [
  "Project overlay",
  "Crash filter",
  "Tract theme",
  "Overlay mode",
  "Overlay geometry",
  "Census tracts",
  "SWITRS lane",
] as const;

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function prioritizeMapContext(items: Array<{ label: string; value: string }>): Array<{ label: string; value: string }> {
  const priority = new Map<string, number>(MAP_CONTEXT_PRIORITY.map((label, index) => [label, index]));

  return [...items].sort((left, right) => {
    const leftPriority = priority.get(left.label) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priority.get(right.label) ?? Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority || left.label.localeCompare(right.label);
  });
}

function getStoredOutputs(run: Run): string[] {
  const outputs: string[] = [];

  if (run.metrics) outputs.push("Metrics");
  if (run.summary_text) outputs.push("Summary");
  if (run.ai_interpretation) outputs.push("AI brief");
  if (run.result_geojson) outputs.push("Geometry");

  return outputs;
}

function describeRunState(
  isCurrent: boolean,
  isComparison: boolean,
  hasActiveComparison: boolean
): { label: string; detail: string } {
  if (isCurrent) {
    return {
      label: hasActiveComparison ? "Active pair · current side" : "Driving result stack",
      detail: hasActiveComparison
        ? "This row is driving the current side of the active Current ↔ Baseline pair above. Reloading another run here replaces the live result surface."
        : "This run is currently loaded into Analysis Studio and is anchoring the live result surfaces above.",
    };
  }

  if (isComparison) {
    return {
      label: "Active pair · pinned baseline",
      detail:
        "This exact row is feeding the pinned baseline in the active pair above. Replace it, clear it, or reload it as current without leaving Run History.",
    };
  }

  if (hasActiveComparison) {
    return {
      label: "Stored replacement candidate",
      detail: "Ready to replace the pinned baseline or reload into the live result stack without disturbing the current side of the active pair.",
    };
  }

  return {
    label: "Stored run",
    detail: "Available to load into the live result stack or promote to the active comparison baseline.",
  };
}

export function RunHistory({
  workspaceId,
  onLoadRun,
  onCompareRun,
  onClearComparison,
  currentRunId,
  currentRunTitle,
  currentRunCreatedAt,
  comparisonRunId,
  comparisonRunTitle,
  comparisonRunCreatedAt,
}: RunHistoryProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) {
      setRuns([]);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=${RUN_HISTORY_LIMIT}`,
        {
          method: "GET",
        }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to load runs.");
      }

      const payload = (await response.json()) as { runs?: Run[] };
      setRuns(payload.runs ?? []);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Failed to load runs.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const deleteRun = async (id: string) => {
    if (deletingRunId) {
      return;
    }

    const confirmed = window.confirm("Delete this analysis run? This action cannot be undone.");

    if (!confirmed) {
      return;
    }

    setError("");
    setDeletingRunId(id);

    try {
      const response = await fetch(`/api/runs?id=${encodeURIComponent(id)}&confirm=true`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Failed to delete run.");
        return;
      }

      await fetchRuns();
    } finally {
      setDeletingRunId((current) => (current === id ? null : current));
    }
  };

  const hasActiveComparison = Boolean(comparisonRunId);
  const hasLoadedRun = Boolean(currentRunId);
  const formattedCurrentTimestamp = currentRunCreatedAt ? formatDate(currentRunCreatedAt) : null;
  const formattedComparisonTimestamp = comparisonRunCreatedAt ? formatDate(comparisonRunCreatedAt) : null;

  return (
    <article
      id="analysis-run-history"
      className={[
        "module-section-surface",
        "module-run-history-surface",
        hasActiveComparison ? "has-active-baseline" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Run history</p>
          <h2 className="module-section-title">Analysis run history</h2>
          <p className="module-section-description">
            {hasActiveComparison
              ? "The baseline lifecycle stays pinned here — replace it from the stored rows, clear it, or reload a prior run without leaving the operator record."
              : "The operator record directly beneath the live result stack — reload a prior run, promote a baseline, or retire stale work."}
          </p>
        </div>

        <div className="module-run-history-toolbar">
          <StatusBadge tone="neutral">{runs.length} stored</StatusBadge>
          {currentRunId ? <StatusBadge tone="info">Current loaded</StatusBadge> : null}
          {comparisonRunId ? <StatusBadge tone="warning">Baseline pinned</StatusBadge> : null}
          {hasActiveComparison ? <StatusBadge tone="info">Active pair linked</StatusBadge> : null}
        </div>
      </div>

      {hasLoadedRun ? (
        <div className={["module-run-history-bridge", hasActiveComparison ? "is-active" : "is-idle"].join(" ")}>
          <div className="module-run-history-bridge-grid">
            <div className="module-run-history-bridge-block">
              <p className="module-run-history-bridge-label">Current stack</p>
              <p className="module-run-history-bridge-value">
                {currentRunTitle ?? (hasActiveComparison ? "Live result stack held steady" : "Single-run review active")}
              </p>
              <p className="module-run-history-bridge-meta">
                {formattedCurrentTimestamp ?? (hasActiveComparison ? "Current side of active pair" : "Live operator review")}
              </p>
              <p className="module-run-history-bridge-copy">
                {hasActiveComparison
                  ? "Keep this current run loaded while the rows below replace or retire the pinned baseline without breaking the live review posture."
                  : "Promote any stored run below when you need a baseline reference for the current result stack."}
              </p>
            </div>

            <div className="module-run-history-bridge-flow" aria-hidden="true">
              <span className="module-run-history-bridge-dot" />
            </div>

            <div className="module-run-history-bridge-block">
              <p className="module-run-history-bridge-label">Baseline lifecycle</p>
              <p className="module-run-history-bridge-value">{comparisonRunTitle ?? "Awaiting baseline selection"}</p>
              <p className="module-run-history-bridge-meta">
                {formattedComparisonTimestamp ?? (comparisonRunTitle ? "Pinned from Run History" : "No baseline pinned")}
              </p>
              <p className="module-run-history-bridge-copy">
                {comparisonRunTitle
                  ? `Pinned from Run History${formattedComparisonTimestamp ? ` on ${formattedComparisonTimestamp}` : " for this review cycle"}. Select another stored run below to replace it, or clear it to return to single-run review.`
                  : "No baseline is pinned yet. Choose a stored run below to send it into the active pair above."}
              </p>
            </div>

            {hasActiveComparison && onClearComparison ? (
              <div className="module-run-history-bridge-actions">
                <Button type="button" variant="ghost" size="sm" onClick={onClearComparison}>
                  Clear baseline
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-5 module-record-list">
        {isLoading ? (
          <LoadingState compact label="Loading run history" description="Refreshing workspace records." />
        ) : null}
        {error ? <ErrorState compact title="Run history unavailable" description={error} /> : null}

        {!isLoading && !error && runs.length === 0 ? (
          <EmptyState
            compact
            title="No analysis runs yet"
            description="Run your first corridor analysis to populate this timeline."
          />
        ) : null}

        {runs.map((run) => {
          const isCurrent = run.id === currentRunId;
          const isComparison = run.id === comparisonRunId;
          const mapViewSummary = prioritizeMapContext(
            summarizeMapViewState(normalizeMapViewState(run.metrics?.mapViewState))
          );
          const primaryMapContext = mapViewSummary.slice(0, 4);
          const additionalContextCount = Math.max(0, mapViewSummary.length - primaryMapContext.length);
          const storedOutputs = getStoredOutputs(run);
          const runState = describeRunState(isCurrent, isComparison, hasActiveComparison);
          const compareDisabled = isCurrent || isComparison || !run.metrics;
          const compareLabel = isCurrent
            ? "Current loaded"
            : isComparison
              ? "Pinned baseline"
              : run.metrics
                ? hasActiveComparison
                  ? "Replace baseline"
                  : "Use as baseline"
                : "Needs metrics";
          const loadLabel = isCurrent ? "Loaded current" : isComparison ? "Reload as current" : "Load current";
          const pairLinkState = isCurrent
            ? {
                label: hasActiveComparison ? "Active pair · current row" : "Current live row",
                copy: hasActiveComparison
                  ? "This row is holding the current side of the active pair above. Loading another run here replaces that current side."
                  : "This row is the live current review surface above.",
                tone: "is-current",
              }
            : isComparison
              ? {
                  label: "Active pair · pinned baseline row",
                  copy:
                    "This exact row is feeding the pinned baseline above. Replace baseline, clear baseline, or reload it as current from here.",
                  tone: "is-baseline",
                }
              : hasActiveComparison
                ? {
                    label: "Baseline replacement candidate",
                    copy: "Replacing the baseline from this row updates the active pair above without disturbing the current side.",
                    tone: "is-candidate",
                  }
                : null;
          const showClearBaselineAction = Boolean(isComparison && onClearComparison);

          return (
            <article
              key={run.id}
              id={isComparison ? "analysis-run-history-baseline" : isCurrent ? "analysis-run-history-current" : undefined}
              className={[
                "module-record-row",
                "module-run-history-row",
                "is-interactive",
                isCurrent ? "is-selected" : "",
                !isCurrent && isComparison ? "is-comparison" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="module-record-head module-run-history-layout">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone="neutral">Run record</StatusBadge>
                    {isCurrent ? <StatusBadge tone="info">Current</StatusBadge> : null}
                    {isComparison ? <StatusBadge tone="warning">Baseline</StatusBadge> : null}
                    {run.metrics ? <StatusBadge tone="success">Metrics saved</StatusBadge> : null}
                    <StatusBadge tone={mapViewSummary.length > 0 ? "info" : "neutral"}>
                      {mapViewSummary.length > 0 ? "Context saved" : "Context pending"}
                    </StatusBadge>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="module-record-title">{run.title}</p>
                      <p className="module-record-stamp">{formatDate(run.created_at)}</p>
                    </div>
                    <p className="module-record-summary line-clamp-2">
                      {run.query_text || "Run record captured without a saved query prompt."}
                    </p>
                  </div>

                  {pairLinkState ? (
                    <div className={["module-run-history-sync-banner", pairLinkState.tone].join(" ")}>
                      <p className="module-run-history-sync-label">{pairLinkState.label}</p>
                      <p className="module-run-history-sync-copy">{pairLinkState.copy}</p>
                    </div>
                  ) : null}

                  <div className="module-run-history-detail-grid">
                    <div className="module-run-history-detail">
                      <p className="module-run-history-detail-label">Review context</p>
                      {primaryMapContext.length > 0 ? (
                        <div className="module-record-meta">
                          {primaryMapContext.map((item) => (
                            <span key={`${run.id}-${item.label}`} className="module-record-chip">
                              {item.label}: {item.value}
                            </span>
                          ))}
                          {additionalContextCount > 0 ? (
                            <span className="module-record-chip">+{additionalContextCount} more context checks</span>
                          ) : null}
                        </div>
                      ) : (
                        <p className="module-run-history-detail-copy">
                          No saved tract / crash / overlay posture on this run yet.
                        </p>
                      )}
                    </div>

                    <div className="module-run-history-detail">
                      <p className="module-run-history-detail-label">Stored outputs</p>
                      {storedOutputs.length > 0 ? (
                        <div className="module-record-meta">
                          {storedOutputs.map((item) => (
                            <span key={`${run.id}-${item}`} className="module-record-chip">
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="module-run-history-detail-copy">
                          Core run record only — no summary, AI brief, or geometry package has been captured yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <aside className="module-run-history-sidecar">
                  <div
                    className={[
                      "module-run-history-statebox",
                      isCurrent ? "is-current" : "",
                      isComparison ? "is-comparison" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <p className="module-run-history-state-label">{runState.label}</p>
                    <p className="module-run-history-state-copy">{runState.detail}</p>
                  </div>

                  <div className="module-run-history-action-group">
                    {onLoadRun ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => onLoadRun(run)} disabled={isCurrent}>
                        {loadLabel}
                      </Button>
                    ) : null}
                    {onCompareRun ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onCompareRun(run)}
                        disabled={compareDisabled}
                      >
                        {compareLabel}
                      </Button>
                    ) : null}
                    {showClearBaselineAction ? (
                      <Button type="button" variant="ghost" size="sm" onClick={onClearComparison}>
                        Clear baseline
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void deleteRun(run.id)}
                      disabled={Boolean(deletingRunId)}
                    >
                      {deletingRunId === run.id ? "Deleting…" : "Delete run"}
                    </Button>
                  </div>
                </aside>
              </div>
            </article>
          );
        })}
      </div>
    </article>
  );
}
