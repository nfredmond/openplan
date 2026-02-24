"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Run = {
  id: string;
  title: string;
  query_text: string;
  created_at: string;
};

type RunHistoryProps = {
  workspaceId: string;
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function RunHistory({ workspaceId }: RunHistoryProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) {
      setRuns([]);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/runs?workspaceId=${encodeURIComponent(workspaceId)}`,
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
    setError("");

    const response = await fetch(`/api/runs?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Failed to delete run.");
      return;
    }

    await fetchRuns();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Run History</CardTitle>
        <CardDescription>Recent analysis runs in this workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading runs...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {!isLoading && !error && runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet. Submit an analysis to populate history.</p>
        ) : null}

        {runs.map((run) => (
          <article key={run.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{run.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{run.query_text}</p>
                <p className="text-xs text-muted-foreground">{formatDate(run.created_at)}</p>
              </div>
              <Button type="button" variant="destructive" size="sm" onClick={() => void deleteRun(run.id)}>
                Delete
              </Button>
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
