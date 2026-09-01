"use client";

import { useMemo } from "react";
import type { Run } from "@/components/runs/RunHistory";
import { buildMetricDeltas } from "@/lib/analysis/compare";
import { resolveTransitMethod, transitFrequencyHalfNote } from "@/lib/data-sources/transit/method";
import { FREQUENT_SERVICE_HEADWAY_MINUTES } from "@/lib/gtfs/service-levels";
import {
  normalizeMapViewState,
  summarizeMapViewState,
  type MapViewState,
} from "@/lib/analysis/map-view-state";
import {
  describeEstimatedAccessibilityInputs,
  estimatedSourceNote,
  resolveEstimatedDomains,
} from "@/lib/analysis/estimated-source";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { resolveDecisionUseDisclosure } from "@/lib/analysis/decision-use";
import {
  resolveCensusScoreInputCoverage,
  withCensusInputCaveat,
} from "@/lib/analysis/census-score-inputs";
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
import { unmeasuredCrashNote } from "@/lib/safety/unmeasured-crash-note";
import { ExploreCurrentResultCard } from "./explore-current-result-card";
import { ExploreDisclosureCard } from "./explore-disclosure-card";
import { ExploreEmptyResultBoard } from "./explore-empty-result-board";
import { ExploreGeospatialBriefing } from "./explore-geospatial-briefing";
import { ExploreRunComparisonCard } from "./explore-run-comparison-card";
import type { DisclosureItem, GeospatialSourceCard, PlanningSignal, ResultScoreTile, ResultStatusBadge } from "./explore-results-types";

const COMPARISON_HEADLINE_KEYS = new Set(["overallScore", "accessibilityScore", "safetyScore", "equityScore"]);
const RESULT_GEOJSON_METADATA_SCHEMA = "openplan.corridor-analysis-geojson-metadata.v1";

function resultGeojsonLayerInventory(features: GeoJSON.Feature[]) {
  const layers = new Map<string, { featureCount: number; geometryTypes: Set<string> }>();
  for (const feature of features) {
    const rawKind = feature.properties?.kind;
    const name = typeof rawKind === "string" && rawKind.trim() ? rawKind.trim() : "unclassified";
    const layer = layers.get(name) ?? { featureCount: 0, geometryTypes: new Set<string>() };
    layer.featureCount += 1;
    layer.geometryTypes.add(feature.geometry?.type ?? "null");
    layers.set(name, layer);
  }
  return [...layers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, layer]) => ({
      name,
      featureCount: layer.featureCount,
      geometryTypes: [...layer.geometryTypes].sort(),
    }));
}

function resultGeojsonExport(
  collection: GeoJSON.FeatureCollection,
  mapViewState: MapViewState
): GeoJSON.FeatureCollection & { metadata: Record<string, unknown> } {
  return {
    ...collection,
    metadata: {
      schema: RESULT_GEOJSON_METADATA_SCHEMA,
      coordinateReferenceSystem: {
        authority: "OGC",
        code: "CRS84",
        axisOrder: "longitude,latitude",
        units: "decimal_degrees",
      },
      featureCount: collection.features.length,
      layerInventory: resultGeojsonLayerInventory(collection.features),
      mapViewState,
    },
  };
}

/**
 * What a tile shows when the underlying figure was never measured.
 *
 * "N/A" was the old answer and it is ambiguous — it reads as "not applicable
 * here", which is a claim about the corridor. "Not measured" is a claim about the
 * READ, which is the true one. Every unmeasured figure on this board says the same
 * two words so a planner learns them once.
 */
const NOT_MEASURED = "Not measured";

/**
 * Render a numeric metric, or say plainly that it was not measured.
 *
 * The defect this closes: score tiles interpolated their value into a template
 * literal (`` `${metrics.safetyScore}` ``), so a null — which is what
 * `computeSafety` returns whenever no crash source answered, the ordinary case
 * outside a registered adapter's coverage — rendered as the four characters
 * "null" in a headline tile. It looked like a bug to a planner and like a value to
 * anyone screenshotting the board.
 */
function metricDisplay(
  value: unknown,
  format: (value: number) => string = (n) => `${n}`
): { value: string; measured: boolean } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value: format(value), measured: true };
  }
  return { value: NOT_MEASURED, measured: false };
}

type ExploreResultsBoardProps = {
  analysisResult: AnalysisResult | null;
  comparisonRun: Run | null;
  queryText: string;
  currentMapViewState: MapViewState;
  onClearComparison: () => void;
  onError: (message: string) => void;
  projectId?: string | null;
};

export function ExploreResultsBoard({
  analysisResult,
  comparisonRun,
  queryText,
  currentMapViewState,
  onClearComparison,
  onError,
  projectId = null,
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
      // Exported alongside the empty delta, because a spreadsheet with a blank
      // cell and no reason is where a reader supplies their own.
      incomparable: delta.incomparable,
      incomparableReason: delta.incomparableReason,
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

  const estimatedDomains = useMemo(
    () => resolveEstimatedDomains(analysisResult?.metrics ?? null),
    [analysisResult]
  );

  /**
   * How this run measured transit, read off the run itself.
   *
   * Never re-derived from today's registry: a run stored before an adapter
   * existed must keep describing itself the way it did when it was stored, and
   * `resolveTransitMethod` reports NOT RECORDED rather than assuming one.
   */
  const transitMethod = useMemo(
    () => resolveTransitMethod(analysisResult?.metrics),
    [analysisResult]
  );

  /**
   * The frequent-service share, as a tile.
   *
   * IT EXISTS BECAUSE THE NUMBER NOW MOVES THE SCORE. Half the accessibility
   * score's transit term is this share whenever the run's source could measure
   * it, and a figure that drives a score while appearing on no screen is the
   * shipped-invisible defect class — the planner sees the score fall and has
   * nothing to look at that explains it.
   *
   * The three states are distinct on purpose. A source that cannot speak to
   * frequency at all ("Not measured") did not find zero frequent stops, and a
   * corridor where a real feed found none genuinely has none.
   */
  const transitFrequency = useMemo(() => {
    const snapshot = analysisResult?.metrics.sourceSnapshots?.transit;
    const share = typeof snapshot?.frequentServiceShare === "number" ? snapshot.frequentServiceShare : null;
    const headwayMinutes =
      typeof snapshot?.frequentServiceHeadwayMinutes === "number"
        ? snapshot.frequentServiceHeadwayMinutes
        : null;

    if (share === null) {
      return {
        headwayMinutes,
        display: NOT_MEASURED,
        // The note comes from the method registry rather than from here, so the
        // tile, the corridor narrative and the exported report cannot describe a
        // withheld share three different ways — and so the SCORING consequence
        // travels with it. A planner whose accessibility score fell because their
        // feed covers part of the corridor reads it on this tile.
        note: transitMethod.frequencyTermApplied
          ? "This run recorded no frequent-service share."
          : transitFrequencyHalfNote(transitMethod),
      };
    }

    return {
      headwayMinutes,
      display: `${Math.round(share * 1000) / 10}%`,
      note: transitFrequencyHalfNote(transitMethod),
    };
  }, [analysisResult, transitMethod]);

  const planningSignals = useMemo(() => {
    if (!analysisResult) {
      return [] satisfies PlanningSignal[];
    }

    // Census figures come through `censusReportedFigures` on the API side, so a
    // null here means the ACS universe behind the figure was EMPTY — nothing was
    // measured. It used to arrive as 0 and render as a finding: "Population: 0",
    // "Transit mode share: 0%". A corridor nobody could read looked like a
    // corridor with nobody in it.
    const population = metricDisplay(analysisResult.metrics.totalPopulation, (n) => n.toLocaleString());
    const medianIncome = metricDisplay(analysisResult.metrics.medianIncome, (n) => formatCurrency(n));
    const transitShare = metricDisplay(analysisResult.metrics.pctTransit, (n) => `${n}%`);
    const zeroVehicle = metricDisplay(analysisResult.metrics.pctZeroVehicle, (n) => `${n}%`);

    return [
      {
        label: "Population",
        value: population.value,
        note: population.measured
          ? "Census tract population intersecting the corridor bounding area."
          : "No census tract population universe was returned for this study area — this is an unanswered read, not a count of zero.",
      },
      {
        label: "Median income",
        value: medianIncome.value,
        note: medianIncome.measured
          ? "Weighted ACS household income for corridor-context tracts."
          : "No corridor-context tract reported a median household income that could be weighted.",
      },
      {
        label: "Transit mode share",
        value: transitShare.value,
        note: transitShare.measured
          ? "Transit share of commute trips from corridor-context tracts."
          : "No commuter universe was returned for these tracts, so no mode share was measured.",
      },
      {
        label: "Zero-vehicle households",
        value: zeroVehicle.value,
        note: zeroVehicle.measured
          ? "Households with no vehicle access, used as an equity / accessibility signal."
          : "No household universe was returned for these tracts, so vehicle access was not measured.",
      },
      {
        label: "Stops / sq mi",
        value: metricDisplay(analysisResult.metrics.stopsPerSquareMile).value,
        // The METHOD, not a fixed sentence about a "proxy layer". Two runs of the
        // same corridor can now carry stop counts on two different scales, and a
        // tile that describes only one of them is the reason a planner would
        // conclude the product is broken when their number moves.
        note: `Transit stop density. ${transitMethod.label}.`,
        estimated: estimatedDomains.transit,
        estimatedNote: estimatedDomains.transit ? estimatedSourceNote("transit") : undefined,
      },
      {
        label: `Stops at a ${transitFrequency.headwayMinutes ?? FREQUENT_SERVICE_HEADWAY_MINUTES}-min headway`,
        value: transitFrequency.display,
        note: transitFrequency.note,
      },
      {
        label: "Crash intensity",
        value: metricDisplay(analysisResult.metrics.crashesPerSquareMile, (n) => `${n}/sq mi`).value,
        note: "Crash density from the active crash source or fallback estimator.",
        estimated: estimatedDomains.crashes,
        estimatedNote: estimatedDomains.crashes ? estimatedSourceNote("crashes") : undefined,
      },
    ] satisfies PlanningSignal[];
  }, [analysisResult, estimatedDomains, transitFrequency, transitMethod]);

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
        // The METHOD'S OWN LABEL when the run recorded one, so a GTFS-backed run
        // reads "Ingested GTFS service levels" rather than the token
        // "Gtfs Feed". Legacy runs fall back to the source token they carry.
        status: transitMethod.id === "not-recorded"
          ? formatSourceToken(sourceSnapshots?.transit?.source)
          : transitMethod.label,
        detail: sourceSnapshots?.transit?.note ?? transitMethod.detail,
        // DERIVED FROM `observed`, NOT FROM TOKEN EQUALITY. This used to test
        // `source === "osm-overpass"`, so the moment a second transit source
        // existed the BETTER one — an agency's own published schedule — rendered
        // with the warning tone reserved for a source that did not answer. A
        // tone comparing against a hardcoded adapter id is a tone that is wrong
        // for every adapter registered after it was written.
        tone:
          sourceSnapshots?.transit?.observed === false ||
          sourceSnapshots?.transit?.source === "unavailable"
            ? "warning"
            : "info",
      },
      {
        label: "Crash safety",
        // Prefer the adapter's own label; fall back to its id. Never name a
        // specific adapter here — coverage advances by registering one.
        status:
          sourceSnapshots?.crashes?.label ??
          formatSourceToken(sourceSnapshots?.crashes?.source ?? sourceSnapshots?.crashes?.state),
        detail: sourceSnapshots?.crashes?.note ?? "Crash metadata not available.",
        // `source` is present only when a source actually answered, so it is
        // the honest availability test. This previously compared against
        // "switrs-local" — a retired token nothing emits — so every run with
        // real, live crash data was rendered with a warning tone.
        tone: sourceSnapshots?.crashes?.source ? "success" : "warning",
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
  }, [analysisResult, sourceSnapshots, transitMethod]);

  if (!analysisResult) {
    return <ExploreEmptyResultBoard projectId={projectId} />;
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
        resultGeojsonExport(analysisResult.geojson, currentMapViewState),
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

  const censusScoreInputs = resolveCensusScoreInputCoverage(analysisResult.metrics);
  const scorePresentation = analysisResult.metrics.scorePresentation;

  if (typeof analysisResult.metrics.overallScore === "number") {
    resultScoreTiles.push({
      label: "Overall",
      value: `${analysisResult.metrics.overallScore}`,
      note: "OpenPlan screening composite. No qualitative score bands have been validated.",
      emphasis: true,
    });
  }

  const accessibilityEstimatedNote = describeEstimatedAccessibilityInputs(estimatedDomains);
  const accessibilityTile = metricDisplay(analysisResult.metrics.accessibilityScore);
  // Null whenever no crash source answered. Absence of crash evidence is not
  // evidence of safety, so there is deliberately no score — and the tile has to
  // say that rather than print the null.
  const safetyTile = metricDisplay(analysisResult.metrics.safetyScore);
  const equityTile = metricDisplay(analysisResult.metrics.equityScore);
  const crashSourceNote = unmeasuredCrashNote({
    state: analysisResult.metrics.sourceSnapshots?.crashes?.state,
    label: analysisResult.metrics.sourceSnapshots?.crashes?.label,
  });

  resultScoreTiles.push(
    {
      label: "Accessibility",
      value: accessibilityTile.value,
      note: accessibilityTile.measured
        ? withCensusInputCaveat(
            "Transit reach, service availability, and jobs-access posture.",
            censusScoreInputs
          )
        : scorePresentation?.accessibility.withheldReason ?? "Accessibility was withheld because required evidence is unavailable.",
      estimated: accessibilityEstimatedNote !== null,
      estimatedNote: accessibilityEstimatedNote ?? undefined,
    },
    {
      label: "Safety",
      value: safetyTile.value,
      note: safetyTile.measured
        ? "Crash-risk lane informed by the active safety source and filters."
        : [scorePresentation?.safety.withheldReason, crashSourceNote].filter(Boolean).join(" ")
          || "Safety was withheld because crash evidence is unavailable.",
      estimated: safetyTile.measured && estimatedDomains.crashes,
      estimatedNote: safetyTile.measured && estimatedDomains.crashes ? estimatedSourceNote("crashes") : undefined,
    },
    {
      label: "Equity",
      value: equityTile.value,
      note: equityTile.measured
        ? withCensusInputCaveat(
            "Corridor equity screening signal from the current demographic layer.",
            censusScoreInputs
          )
        : scorePresentation?.equity.withheldReason ?? "Equity was withheld because required evidence is unavailable.",
    }
  );

  const resultStatusBadges: ResultStatusBadge[] = [];

  // The run has always recorded how far it may be carried into a decision, and
  // until now nothing rendered it. It leads the badge row because it bounds
  // everything below it: a planner who reads the scores without reading this is
  // the person who takes a screening result into a CEQA determination.
  const decisionUse = resolveDecisionUseDisclosure(analysisResult.metrics);
  resultStatusBadges.push({
    label: decisionUse.label,
    tone: decisionUse.notRecorded ? "neutral" : "warning",
    title: decisionUse.detail,
  });

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
  // Every incomparable metric carries the same sentence (the refusal is a
  // property of the PAIR of runs, not of the metric), so the first one is the
  // reason for all of them.
  const comparisonIncomparableDeltas = comparisonDeltas.filter((delta) => delta.incomparable);
  const comparisonIncomparableReason = comparisonIncomparableDeltas[0]?.incomparableReason ?? null;
  const comparisonNarrativeLead = getComparisonNarrativeLead(
    comparisonMetricChangeCount,
    comparisonViewDifferenceCount,
    comparisonIncomparableReason
  );
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
          decisionUse={decisionUse}
          resultScoreTiles={resultScoreTiles}
          resultStatusBadges={resultStatusBadges}
          sourceTransparency={sourceTransparency}
          sourceReviewCount={sourceReviewCount}
          comparisonMetricChangeCount={comparisonMetricChangeCount}
          comparisonViewDifferenceCount={comparisonViewDifferenceCount}
          onExportMetrics={exportMetrics}
          onExportGeojson={exportGeojson}
          projectId={projectId}
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
