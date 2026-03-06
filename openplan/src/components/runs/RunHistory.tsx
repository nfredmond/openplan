"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

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
  currentRunId?: string;
  comparisonRunId?: string;
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

const RUN_HISTORY_LIMIT = 25;

export function RunHistory({
  workspaceId,
  onLoadRun,
  onCompareRun,
  currentRunId,
  comparisonRunId,
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

    const confirmed = window.confirm(
      "Delete this analysis run? This action cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setDeletingRunId(id);

    try {
      const response = await fetch(
        `/api/runs?id=${encodeURIComponent(id)}&confirm=true`,
        {
          method: "DELETE",
        }
      );

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Analysis Run History</CardTitle>
        <CardDescription>Recent runs for this workspace, ready to reload or compare.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3.5">
        {isLoading ? <LoadingState compact label="Loading run history" description="Refreshing workspace records." /> : null}
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

          return (
            <article
              key={run.id}
              className={`rounded-xl border p-3.5 transition-colors ${
                isCurrent
                  ? "border-[color:var(--pine)]/35 bg-[color:var(--pine)]/6"
                  : isComparison
                    ? "border-[color:var(--accent)]/35 bg-[color:var(--accent)]/6"
                    : "border-border/80 bg-background"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold tracking-tight">{run.title}</p>
                    {isCurrent ? <StatusBadge tone="info">Current run</StatusBadge> : null}
                    {isComparison ? <StatusBadge tone="neutral">Comparison baseline</StatusBadge> : null}
                  </div>

                  <p className="line-clamp-2 text-xs text-muted-foreground">{run.query_text}</p>
                  <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                    {formatDate(run.created_at)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {onLoadRun ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onLoadRun(run)}
                      disabled={isCurrent}
                    >
                      {isCurrent ? "Loaded" : "Load"}
                    </Button>
                  ) : null}
                  {onCompareRun ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onCompareRun(run)}
                      disabled={isCurrent || !run.metrics}
                    >
                      {isComparison ? "Comparing" : "Compare"}
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
              </div>
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}
