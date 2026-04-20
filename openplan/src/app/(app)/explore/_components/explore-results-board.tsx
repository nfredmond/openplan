"use client";

import { useMemo } from "react";
import type { Run } from "@/components/runs/RunHistory";
import { buildMetricDeltas } from "@/lib/analysis/compare";
import {
  normalizeMapViewState,
  summarizeMapViewState,
  type MapViewState,
} from "@/lib/analysis/map-view-state";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { downloadGeojson, downloadMetricsCsv, downloadRecordsCsv, downloadText } from "@/lib/export/download";
import { resolveStatusTone } from "@/lib/ui/status";
import {
  buildRunTitle,
  formatCurrency,
  formatRunTimestamp,
  formatSourceToken,
  getComparisonNarrativeLead,
  prioritizeMapComparisonRows,
} from "./_helpers";
import type { AnalysisResult } from "./_types";
import { ExploreCurrentResultCard } from "./explore-current-result-card";
import { ExploreDisclosureCard } from "./explore-disclosure-card";
import { ExploreEmptyResultBoard } from "./explore-empty-result-board";
import { ExploreGeospatialBriefing } from "./explore-geospatial-briefing";
import { ExploreRunComparisonCard } from "./explore-run-comparison-card";
import type { DisclosureItem, GeospatialSourceCard, PlanningSignal, ResultScoreTile, ResultStatusBadge } from "./explore-results-types";

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
      return [] satisfies PlanningSignal[];
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
    ] satisfies PlanningSignal[];
  }, [analysisResult]);

  const sourceSnapshots = analysisResult?.metrics.sourceSnapshots;

  const geospatialSourceCards = useMemo(() => {
    if (!analysisResult) {
      return [] satisfies GeospatialSourceCard[];
    }

    return [
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
    ] satisfies GeospatialSourceCard[];
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

  const resultScoreTiles: ResultScoreTile[] = [];

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

  const resultStatusBadges: ResultStatusBadge[] = [];

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
  const disclosureItems: DisclosureItem[] = [
    {
      title: "AI acceleration",
      detail: "AI is used to accelerate drafting and interpretation; final analysis and conclusions still require human review and approval.",
      tone: "info",
    },
    {
      title: "Verification gate",
      detail: "Regulatory and policy-sensitive claims should be citation-backed or explicitly marked for verification before release.",
      tone: "warning",
    },
    {
      title: "Source limitations",
      detail: "This run relies on available source data and proxy methods where direct sources are unavailable or incomplete.",
      tone: "neutral",
    },
    {
      title: "Equity safeguard",
      detail: "Recommendations should be checked for equity impacts and must not shift disproportionate burden onto disadvantaged communities.",
      tone: "warning",
    },
  ];

  return (
    <>
      <div className="analysis-run-pair-stack analysis-explore-results-stack">
        <ExploreCurrentResultCard
          analysisResult={analysisResult}
          comparisonActive={Boolean(comparisonRun?.metrics)}
          currentRunTitle={currentRunTitle}
          currentRunTimestampLabel={currentRunTimestampLabel}
          currentRunNarrativeLabel={currentRunNarrativeLabel}
          currentRunMapContextLabel={currentRunMapContextLabel}
          currentMapViewSummary={currentMapViewSummary}
          resultScoreTiles={resultScoreTiles}
          resultStatusBadges={resultStatusBadges}
          sourceTransparency={sourceTransparency}
          sourceReviewCount={sourceReviewCount}
          comparisonMetricChangeCount={comparisonMetricChangeCount}
          comparisonViewDifferenceCount={comparisonViewDifferenceCount}
          onExportMetrics={exportMetrics}
          onExportGeojson={exportGeojson}
        />

        {comparisonRun?.metrics ? (
          <ExploreRunComparisonCard
            analysisResult={analysisResult}
            comparisonRun={comparisonRun}
            comparisonMetricChangeCount={comparisonMetricChangeCount}
            comparisonViewDifferenceCount={comparisonViewDifferenceCount}
            comparisonNarrativeLead={comparisonNarrativeLead}
            comparisonHeadlineDeltas={comparisonHeadlineDeltas}
            comparisonSupportingDeltas={comparisonSupportingDeltas}
            comparisonChangedDeltas={comparisonChangedDeltas}
            prioritizedMapViewComparisonRows={prioritizedMapViewComparisonRows}
            changedMapViewRows={changedMapViewRows}
            alignedMapViewRows={alignedMapViewRows}
            currentRunTitle={currentRunTitle}
            currentRunTimestampLabel={currentRunTimestampLabel}
            currentRunNarrativeLabel={currentRunNarrativeLabel}
            currentRunMapContextLabel={currentRunMapContextLabel}
            currentRunOverallScore={currentRunOverallScore}
            baselineRunNarrativeLabel={baselineRunNarrativeLabel}
            baselineRunMapContextLabel={baselineRunMapContextLabel}
            baselineRunOverallScore={baselineRunOverallScore}
            currentHistoryHref={currentHistoryHref}
            baselineHistoryHref={baselineHistoryHref}
            onClearComparison={onClearComparison}
            onExportComparisonCsv={exportComparisonCsv}
            onExportComparisonJson={exportComparisonJson}
          />
        ) : null}
      </div>

      <ExploreGeospatialBriefing
        planningSignals={planningSignals}
        geospatialSourceCards={geospatialSourceCards}
        sourceSnapshots={sourceSnapshots}
      />

      <ExploreDisclosureCard disclosureItems={disclosureItems} />
    </>
  );
}
