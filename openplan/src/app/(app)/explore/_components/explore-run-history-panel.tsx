"use client";

import type { Run } from "@/components/runs/RunHistory";
import { RunHistory } from "@/components/runs/RunHistory";
import type { AnalysisResult } from "./_types";
import { buildRunTitle } from "./_helpers";

type ExploreRunHistoryPanelProps = {
  workspaceId: string;
  analysisResult: AnalysisResult | null;
  comparisonRun: Run | null;
  queryText: string;
  onLoadRun: (run: Run) => void;
  onCompareRun: (run: Run) => void;
  onClearComparison: () => void;
};

export function ExploreRunHistoryPanel({
  workspaceId,
  analysisResult,
  comparisonRun,
  queryText,
  onLoadRun,
  onCompareRun,
  onClearComparison,
}: ExploreRunHistoryPanelProps) {
  return (
    <RunHistory
      workspaceId={workspaceId}
      onLoadRun={onLoadRun}
      onCompareRun={onCompareRun}
      onClearComparison={onClearComparison}
      currentRunId={analysisResult?.runId}
      currentRunTitle={analysisResult?.title ?? buildRunTitle(queryText)}
      currentRunCreatedAt={analysisResult?.createdAt ?? null}
      comparisonRunId={comparisonRun?.id}
      comparisonRunTitle={comparisonRun?.title ?? null}
      comparisonRunCreatedAt={comparisonRun?.created_at ?? null}
    />
  );
}
