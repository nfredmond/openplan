"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Run } from "@/components/runs/RunHistory";
import {
  normalizeMapViewState,
  type CrashSeverityFilter,
  type CrashUserFilter,
} from "@/lib/analysis/map-view-state";
import { stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import type { AnalysisResult, CorridorGeometry, TractMetric } from "./_types";

type UseExploreRunHistoryParams = {
  workspaceId: string;
  analysisResult: AnalysisResult | null;
  setAnalysisResult: Dispatch<SetStateAction<AnalysisResult | null>>;
  setQueryText: Dispatch<SetStateAction<string>>;
  setSelectedProjectId: Dispatch<SetStateAction<string>>;
  setCorridorGeojson: Dispatch<SetStateAction<CorridorGeometry | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setTractMetric: Dispatch<SetStateAction<TractMetric>>;
  setShowTracts: Dispatch<SetStateAction<boolean>>;
  setShowCrashes: Dispatch<SetStateAction<boolean>>;
  setCrashSeverityFilter: Dispatch<SetStateAction<CrashSeverityFilter>>;
  setCrashUserFilter: Dispatch<SetStateAction<CrashUserFilter>>;
  setActiveDatasetOverlayId: Dispatch<SetStateAction<string | null>>;
};

type UseExploreRunHistoryResult = {
  comparisonRun: Run | null;
  loadRun: (run: Run) => void;
  compareRun: (run: Run) => void;
  clearComparison: () => void;
};

export function useExploreRunHistory({
  workspaceId,
  analysisResult,
  setAnalysisResult,
  setQueryText,
  setSelectedProjectId,
  setCorridorGeojson,
  setError,
  setTractMetric,
  setShowTracts,
  setShowCrashes,
  setCrashSeverityFilter,
  setCrashUserFilter,
  setActiveDatasetOverlayId,
}: UseExploreRunHistoryParams): UseExploreRunHistoryResult {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const runDeepLinkAppliedRef = useRef(false);
  const [isApplyingRunDeepLink, setIsApplyingRunDeepLink] = useState(
    () => Boolean(searchParams.get("runId") || searchParams.get("baselineRunId")),
  );
  const [comparisonRun, setComparisonRun] = useState<Run | null>(null);

  const loadRun = useCallback(
    (run: Run) => {
      setQueryText(run.query_text);
      setSelectedProjectId(run.project_id ?? "");

      if (run.corridor_geojson) {
        setCorridorGeojson(run.corridor_geojson as CorridorGeometry);
      }

      if (!run.metrics || !run.result_geojson || !run.summary_text) {
        setError("Selected run is missing result data and cannot be loaded.");
        return;
      }

      setComparisonRun((current) => (current?.id === run.id ? null : current));
      setError("");

      const runMetrics = run.metrics as AnalysisResult["metrics"];
      const persistedMapViewState = normalizeMapViewState(runMetrics?.mapViewState);

      if (persistedMapViewState?.tractMetric) setTractMetric(persistedMapViewState.tractMetric);
      if (typeof persistedMapViewState?.showTracts === "boolean") setShowTracts(persistedMapViewState.showTracts);
      if (typeof persistedMapViewState?.showCrashes === "boolean") setShowCrashes(persistedMapViewState.showCrashes);
      if (persistedMapViewState?.crashSeverityFilter) setCrashSeverityFilter(persistedMapViewState.crashSeverityFilter);
      if (persistedMapViewState?.crashUserFilter) setCrashUserFilter(persistedMapViewState.crashUserFilter);
      if (persistedMapViewState?.activeDatasetOverlayId !== undefined) {
        setActiveDatasetOverlayId(persistedMapViewState.activeDatasetOverlayId ?? null);
      }

      setAnalysisResult({
        runId: run.id,
        projectId: run.project_id ?? null,
        title: run.title,
        createdAt: run.created_at,
        metrics: runMetrics,
        geojson: run.result_geojson,
        summary: run.summary_text,
        aiInterpretation: run.ai_interpretation ? stripFactCitationTokens(run.ai_interpretation) : undefined,
        aiInterpretationSource:
          (typeof runMetrics.aiInterpretationSource === "string" && runMetrics.aiInterpretationSource) ||
          (typeof runMetrics.dataQuality?.aiInterpretationSource === "string" && runMetrics.dataQuality?.aiInterpretationSource) ||
          (run.ai_interpretation ? "ai" : "fallback"),
      });
    },
    [
      setActiveDatasetOverlayId,
      setAnalysisResult,
      setCorridorGeojson,
      setCrashSeverityFilter,
      setCrashUserFilter,
      setError,
      setQueryText,
      setSelectedProjectId,
      setShowCrashes,
      setShowTracts,
      setTractMetric,
    ]
  );

  useEffect(() => {
    if (!workspaceId || runDeepLinkAppliedRef.current) {
      return;
    }

    const requestedRunId = searchParams.get("runId");
    const requestedBaselineRunId = searchParams.get("baselineRunId");

    if (!requestedRunId && !requestedBaselineRunId) {
      runDeepLinkAppliedRef.current = true;
      setIsApplyingRunDeepLink(false);
      return;
    }

    runDeepLinkAppliedRef.current = true;

    const applyRunDeepLink = async () => {
      try {
        const response = await fetch(
          `/api/runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=200`,
          { method: "GET" }
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to load linked scenario runs.");
        }

        const payload = (await response.json()) as { runs?: Run[] };
        const runs = payload.runs ?? [];
        const currentRun = requestedRunId ? runs.find((run) => run.id === requestedRunId) ?? null : null;
        const baseline = requestedBaselineRunId ? runs.find((run) => run.id === requestedBaselineRunId) ?? null : null;

        if (requestedRunId) {
          if (!currentRun) {
            throw new Error("Linked scenario run was not found in this workspace.");
          }

          loadRun(currentRun);
        }

        if (baseline && baseline.id !== requestedRunId) {
          setComparisonRun(baseline);
        }
      } catch (deepLinkError) {
        setError(deepLinkError instanceof Error ? deepLinkError.message : "Failed to open the scenario-linked review.");
      } finally {
        setIsApplyingRunDeepLink(false);
      }
    };

    void applyRunDeepLink();
  }, [loadRun, searchParams, setError, workspaceId]);

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
    [analysisResult, setError]
  );

  const clearComparison = useCallback(() => {
    setError("");
    setComparisonRun(null);
  }, [setError]);

  useEffect(() => {
    // Do not erase a requested run before the asynchronous history read has a
    // chance to restore it. Both effects run after the same initial render;
    // the old URL-sync effect deleted runId while the read was still in flight.
    if (isApplyingRunDeepLink) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    const currentRunId = analysisResult?.runId ?? null;
    const baselineRunId = comparisonRun?.id ?? null;
    const currentProjectId = analysisResult?.projectId ?? null;

    if (currentRunId) {
      nextParams.set("runId", currentRunId);
    } else {
      nextParams.delete("runId");
    }

    if (baselineRunId) {
      nextParams.set("baselineRunId", baselineRunId);
    } else {
      nextParams.delete("baselineRunId");
    }

    // Once a saved run is loaded, its database attribution becomes the URL
    // context. Before any run is loaded, leave an explicitly opened projectId
    // alone so entering Explore from a project does not clear itself.
    if (analysisResult) {
      if (currentProjectId) nextParams.set("projectId", currentProjectId);
      else nextParams.delete("projectId");
    }

    const currentRunParam = searchParams.get("runId");
    const currentBaselineParam = searchParams.get("baselineRunId");
    const currentProjectParam = searchParams.get("projectId");

    if (
      currentRunParam === currentRunId &&
      currentBaselineParam === baselineRunId &&
      (!analysisResult || currentProjectParam === currentProjectId)
    ) {
      return;
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [analysisResult, comparisonRun?.id, isApplyingRunDeepLink, pathname, router, searchParams]);

  return {
    comparisonRun,
    loadRun,
    compareRun,
    clearComparison,
  };
}
