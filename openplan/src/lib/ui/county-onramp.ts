import type {
  CountyOnrampBehavioralPrototypeSummary,
  CountyOnrampManifest,
  CountyOnrampScaffoldSummary,
  CountyRunStage,
} from "@/lib/models/county-onramp";
import type { CountyRunListItem } from "@/lib/api/county-onramp";
import {
  getCountyRunAllowedClaim,
  getCountyRunCaveats,
  getCountyRunStageLabel,
  getCountyRunStageTone,
} from "@/lib/models/county-onramp";

export type CountyRunUiCard = {
  title: string;
  stage: CountyRunStage;
  stageLabel: string;
  tone: "neutral" | "info" | "warning" | "success";
  statusLabel: string | null;
  allowedClaim: string;
  caveats: string[];
  nextAction: string;
};

export type CountyBehavioralReadinessBadge = {
  label: string;
  tone: "neutral" | "info" | "warning" | "success";
};

export type CountyBehavioralRuntimeSummary = {
  pipelineLabel: string | null;
  runtimeLabel: string | null;
  modeLabel: string | null;
};

export type CountyBehavioralPrototypeUiCard = {
  pipelineStatus: string | null;
  runtimeStatus: string | null;
  runtimeMode: string | null;
  runtimePosture: string | null;
  evidenceStatusLabel: string;
  evidenceSupportLabel: string;
  evidencePacketReady: boolean;
  comparisonReady: boolean;
  evidencePacketPath: string | null;
  runtimeSummaryPath: string | null;
  ingestionSummaryPath: string | null;
  comparisonSummaryPath: string | null;
  comparisonPacketPath: string | null;
  comparisonSupportLabel: string;
  claim: string;
  caveats: string[];
};

export type CountyActivitySimBundleUiCard = {
  statusLabel: string;
  tone: "neutral" | "info" | "warning" | "success";
  ready: boolean;
  claim: string;
  outputDir: string | null;
  manifestPath: string | null;
  landUseRows: number | null;
  households: number | null;
  persons: number | null;
  skimModeLabel: string | null;
  errorMessage: string | null;
  errorKind: string | null;
};

export type CountyValidationScaffoldUiCard = {
  statusLabel: string;
  tone: "neutral" | "info" | "warning" | "success";
  stationCount: number | null;
  observedVolumeFilledCount: number | null;
  sourceAgencyTbdCount: number | null;
  sourceDescriptionFilledCount: number | null;
  readyStationCount: number | null;
  nextActionLabel: string;
  claim: string;
};

export type CountyRunSort = "updated-desc" | "stage-desc" | "final-gap-asc" | "median-ape-asc";
export type CountyRunQuickView =
  | "all"
  | "needs-attention"
  | "scaffold-backlog"
  | "best-validated"
  | "prototype-blocked"
  | "evidence-ready"
  | "comparison-ready";

export type CountyRunSummaryCounts = {
  totalRuns: number;
  needsAttention: number;
  scaffoldBacklog: number;
  prototypeBlocked: number;
  evidenceReady: number;
  comparisonReady: number;
  validatedScreening: number;
};

export function getCountyRunNextAction(stage: CountyRunStage): string {
  switch (stage) {
    case "bootstrap-incomplete":
      return "Wait for the county onboarding job to finish, then refresh status.";
    case "runtime-complete":
      return "Review the generated scaffold and begin sourcing observed counts.";
    case "validation-scaffolded":
      return "Tighten station definitions or complete count ingestion, then rerun validation.";
    case "validated-screening":
      return "Review the validation report and preserve all screening-grade caveats in any downstream use.";
    default:
      return "Review county state.";
  }
}

export function getCountyRunStatusLabel(manifest: CountyOnrampManifest | null | undefined): string | null {
  return (manifest?.summary?.validation?.screening_gate?.status_label as string | undefined | null) ?? null;
}

export function buildCountyRunUiCard(input: {
  geographyLabel: string;
  manifest: CountyOnrampManifest | null | undefined;
  stage: CountyRunStage;
}): CountyRunUiCard {
  const statusLabel = getCountyRunStatusLabel(input.manifest);
  return {
    title: input.geographyLabel,
    stage: input.stage,
    stageLabel: getCountyRunStageLabel(input.stage),
    tone: getCountyRunStageTone(input.stage),
    statusLabel,
    allowedClaim: getCountyRunAllowedClaim(input.stage),
    caveats: getCountyRunCaveats(input.stage),
    nextAction: getCountyRunNextAction(input.stage),
  };
}

export function getCountyRunMetricHighlights(manifest: CountyOnrampManifest | null | undefined) {
  const run = manifest?.summary?.run;
  const validation = manifest?.summary?.validation?.metrics;

  return {
    zoneCount: run?.zone_count ?? null,
    loadedLinks: run?.loaded_links ?? null,
    totalTrips: run?.total_trips ?? null,
    finalGap: run?.final_gap ?? null,
    medianApe: validation?.median_absolute_percent_error ?? null,
    maxApe: validation?.max_absolute_percent_error ?? null,
  };
}

function getValidationScaffoldClaim(scaffold: CountyOnrampScaffoldSummary | null | undefined): string {
  if (!scaffold) {
    return "Validation scaffold progress has not been recorded for this county run yet.";
  }

  if (scaffold.station_count === 0) {
    return "No starter stations are currently recorded in the validation scaffold.";
  }

  if (scaffold.ready_station_count >= scaffold.station_count) {
    return "All starter stations have observed counts and source metadata recorded; validation can run after any final station cleanup.";
  }

  return `Validation scaffold exists, but only ${scaffold.ready_station_count} of ${scaffold.station_count} starter stations are validator-ready.`;
}

export function buildCountyValidationScaffoldUiCard(
  manifest: CountyOnrampManifest | null | undefined
): CountyValidationScaffoldUiCard {
  const scaffold = manifest?.summary?.scaffold;

  if (!scaffold) {
    return {
      statusLabel: "Not recorded",
      tone: "neutral",
      stationCount: null,
      observedVolumeFilledCount: null,
      sourceAgencyTbdCount: null,
      sourceDescriptionFilledCount: null,
      readyStationCount: null,
      nextActionLabel: "Regenerate or ingest the validation scaffold before sourcing counts.",
      claim: getValidationScaffoldClaim(null),
    };
  }

  if (scaffold.station_count > 0 && scaffold.ready_station_count >= scaffold.station_count) {
    return {
      statusLabel: "Validator-ready",
      tone: "success",
      stationCount: scaffold.station_count,
      observedVolumeFilledCount: scaffold.observed_volume_filled_count,
      sourceAgencyTbdCount: scaffold.source_agency_tbd_count,
      sourceDescriptionFilledCount: scaffold.source_description_filled_count,
      readyStationCount: scaffold.ready_station_count,
      nextActionLabel: scaffold.next_action_label,
      claim: getValidationScaffoldClaim(scaffold),
    };
  }

  return {
    statusLabel: "Counts sourcing in progress",
    tone: "warning",
    stationCount: scaffold.station_count,
    observedVolumeFilledCount: scaffold.observed_volume_filled_count,
    sourceAgencyTbdCount: scaffold.source_agency_tbd_count,
    sourceDescriptionFilledCount: scaffold.source_description_filled_count,
    readyStationCount: scaffold.ready_station_count,
    nextActionLabel: scaffold.next_action_label,
    claim: getValidationScaffoldClaim(scaffold),
  };
}

function formatActivitySimSkimMode(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "copy") return "Copied skims";
  if (value === "symlink") return "Symlinked skims";
  return value;
}

export function buildCountyActivitySimBundleUiCard(
  manifest: CountyOnrampManifest | null | undefined
): CountyActivitySimBundleUiCard {
  const bundle = manifest?.summary?.activitysim_bundle;
  const manifestPath = bundle?.manifest_path ?? manifest?.artifacts?.activitysim_bundle_manifest_json ?? null;

  if (!bundle) {
    return {
      statusLabel: "Not recorded",
      tone: "neutral",
      ready: false,
      claim: "No ActivitySim handoff bundle state has been recorded for this county run.",
      outputDir: null,
      manifestPath,
      landUseRows: null,
      households: null,
      persons: null,
      skimModeLabel: null,
      errorMessage: null,
      errorKind: null,
    };
  }

  if (bundle.status === "completed") {
    return {
      statusLabel: "Bundle ready",
      tone: "info",
      ready: true,
      claim:
        "Prototype ActivitySim handoff bundle was built from county screening outputs. This indicates scaffold availability only, not calibrated behavioral demand or client-ready forecasting.",
      outputDir: bundle.output_dir ?? null,
      manifestPath,
      landUseRows: bundle.land_use_rows ?? null,
      households: bundle.households ?? null,
      persons: bundle.persons ?? null,
      skimModeLabel: formatActivitySimSkimMode(bundle.skim_mode),
      errorMessage: null,
      errorKind: null,
    };
  }

  if (bundle.status === "failed") {
    return {
      statusLabel: "Bundle failed",
      tone: "warning",
      ready: false,
      claim: "ActivitySim handoff bundle generation failed. Behavioral runtime availability should not be assumed from this county run.",
      outputDir: bundle.output_dir ?? null,
      manifestPath,
      landUseRows: bundle.land_use_rows ?? null,
      households: bundle.households ?? null,
      persons: bundle.persons ?? null,
      skimModeLabel: formatActivitySimSkimMode(bundle.skim_mode),
      errorMessage: bundle.error?.message ?? null,
      errorKind: bundle.error?.kind ?? null,
    };
  }

  return {
    statusLabel: "Not built",
    tone: "neutral",
    ready: false,
    claim: "No ActivitySim handoff bundle was generated for this county run yet.",
    outputDir: bundle.output_dir ?? null,
    manifestPath,
    landUseRows: bundle.land_use_rows ?? null,
    households: bundle.households ?? null,
    persons: bundle.persons ?? null,
    skimModeLabel: formatActivitySimSkimMode(bundle.skim_mode),
    errorMessage: bundle.error?.message ?? null,
    errorKind: bundle.error?.kind ?? null,
  };
}

function getBehavioralClaim(summary: CountyOnrampBehavioralPrototypeSummary | null | undefined): string {
  if (!summary?.pipeline_status) {
    return "Behavioral prototype lane has not been recorded for this county run.";
  }
  if (summary.pipeline_status === "behavioral_runtime_succeeded") {
    return "Behavioral prototype runtime executed and downstream prototype artifacts were produced.";
  }
  if (summary.pipeline_status === "prototype_preflight_complete") {
    return "Behavioral prototype orchestration completed only to preflight depth; no real ActivitySim runtime success is claimed.";
  }
  if (summary.pipeline_status === "behavioral_runtime_failed") {
    return "Behavioral prototype attempted runtime execution and failed.";
  }
  if (summary.pipeline_status === "prototype_pipeline_failed") {
    return "Behavioral prototype lane failed before completing the planned flow.";
  }
  return "Behavioral prototype lane is still in progress.";
}

function getBehavioralEvidenceStatusLabel(summary: CountyOnrampBehavioralPrototypeSummary | null | undefined): string {
  if (!summary?.pipeline_status) {
    return "Not recorded";
  }
  if (summary.pipeline_status === "behavioral_runtime_succeeded") {
    return "Runtime succeeded";
  }
  if (summary.pipeline_status === "prototype_preflight_complete") {
    return "Preflight only";
  }
  if (summary.pipeline_status === "behavioral_runtime_failed") {
    return "Runtime failed";
  }
  if (summary.pipeline_status === "prototype_pipeline_failed") {
    return "Pipeline failed";
  }
  return "In progress";
}

function getBehavioralEvidenceSupportLabel(summary: CountyOnrampBehavioralPrototypeSummary | null | undefined): string {
  if (!summary?.pipeline_status) {
    return "No behavioral evidence packet posture available yet.";
  }
  if (summary.pipeline_status === "behavioral_runtime_succeeded") {
    return "Prototype behavioral artifacts are available for internal evidence review, but not for client-ready forecasting claims.";
  }
  if (summary.pipeline_status === "prototype_preflight_complete") {
    return "Evidence is limited to preflight-depth prototype artifacts only; comparison/validation claims remain blocked.";
  }
  if (summary.pipeline_status === "behavioral_runtime_failed") {
    return "Any behavioral artifacts should be treated as partial-output evidence only.";
  }
  if (summary.pipeline_status === "prototype_pipeline_failed") {
    return "Behavioral evidence support is blocked because the prototype chain did not complete.";
  }
  return "Behavioral evidence support is still being determined.";
}

function isBehavioralEvidencePacketReady(summary: CountyOnrampBehavioralPrototypeSummary | null | undefined): boolean {
  return Boolean(summary?.prototype_manifest_path || summary?.runtime_manifest_path || summary?.runtime_summary_path);
}

function isBehavioralComparisonReady(summary: CountyOnrampBehavioralPrototypeSummary | null | undefined): boolean {
  return summary?.pipeline_status === "behavioral_runtime_succeeded" && Boolean(summary?.kpi_summary_path);
}

function getBehavioralComparisonSupportLabel(summary: CountyOnrampBehavioralPrototypeSummary | null | undefined): string {
  if (!summary?.pipeline_status) {
    return "Comparison support is not available because no behavioral prototype record exists yet.";
  }
  if (summary.pipeline_status === "behavioral_runtime_succeeded" && summary.kpi_summary_path) {
    return "This run has enough behavioral artifact coverage for internal comparison against another comparison-ready run.";
  }
  if (summary.pipeline_status === "behavioral_runtime_failed") {
    return "Comparison is not supportable yet; failed runtime artifacts should be treated as partial-output evidence only.";
  }
  if (summary.pipeline_status === "prototype_preflight_complete") {
    return "Comparison is blocked because this run only reached preflight depth and does not have comparison-ready behavioral outputs.";
  }
  if (summary.pipeline_status === "prototype_pipeline_failed") {
    return "Comparison is blocked because the behavioral prototype pipeline did not complete.";
  }
  return "Comparison readiness is still being determined.";
}

export function buildCountyBehavioralPrototypeUiCard(
  manifest: CountyOnrampManifest | null | undefined
): CountyBehavioralPrototypeUiCard {
  const summary = manifest?.summary?.behavioral_prototype;
  return {
    pipelineStatus: summary?.pipeline_status ?? null,
    runtimeStatus: summary?.runtime_status ?? null,
    runtimeMode: summary?.runtime_mode ?? null,
    runtimePosture: summary?.runtime_posture ?? null,
    evidenceStatusLabel: getBehavioralEvidenceStatusLabel(summary),
    evidenceSupportLabel: getBehavioralEvidenceSupportLabel(summary),
    evidencePacketReady: isBehavioralEvidencePacketReady(summary),
    comparisonReady: isBehavioralComparisonReady(summary),
    evidencePacketPath: summary?.prototype_manifest_path ?? summary?.runtime_manifest_path ?? null,
    runtimeSummaryPath: summary?.runtime_summary_path ?? null,
    ingestionSummaryPath: summary?.ingestion_summary_path ?? null,
    comparisonSummaryPath: summary?.kpi_summary_path ?? null,
    comparisonPacketPath: summary?.kpi_packet_path ?? null,
    comparisonSupportLabel: getBehavioralComparisonSupportLabel(summary),
    claim: getBehavioralClaim(summary),
    caveats: summary?.caveats ?? [],
  };
}

function formatBehavioralRuntimeToken(value: string | null | undefined): string | null {
  if (!value) return null;

  const explicitLabels: Record<string, string> = {
    prototype_preflight_complete: "Prototype preflight complete",
    behavioral_runtime_succeeded: "Behavioral runtime succeeded",
    behavioral_runtime_failed: "Behavioral runtime failed",
    prototype_pipeline_failed: "Prototype pipeline failed",
    prototype_pipeline_running: "Prototype pipeline running",
    behavioral_runtime_blocked: "Behavioral runtime blocked",
    preflight_only: "Preflight only",
    containerized_activitysim: "Containerized ActivitySim",
  };

  return explicitLabels[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildCountyBehavioralRuntimeSummary(input: {
  pipelineStatus?: string | null;
  runtimeStatus?: string | null;
  runtimeMode?: string | null;
}): CountyBehavioralRuntimeSummary {
  return {
    pipelineLabel: formatBehavioralRuntimeToken(input.pipelineStatus),
    runtimeLabel: formatBehavioralRuntimeToken(input.runtimeStatus),
    modeLabel: formatBehavioralRuntimeToken(input.runtimeMode),
  };
}

const COUNTY_STAGE_SORT_RANK: Record<CountyRunStage, number> = {
  "bootstrap-incomplete": 0,
  "runtime-complete": 1,
  "validation-scaffolded": 2,
  "validated-screening": 3,
};

export function buildCountyRunSummaryCounts(items: CountyRunListItem[]): CountyRunSummaryCounts {
  return {
    totalRuns: items.length,
    needsAttention: filterCountyRunListItemsByQuickView(items, "needs-attention").length,
    scaffoldBacklog: filterCountyRunListItemsByQuickView(items, "scaffold-backlog").length,
    prototypeBlocked: filterCountyRunListItemsByQuickView(items, "prototype-blocked").length,
    evidenceReady: filterCountyRunListItemsByQuickView(items, "evidence-ready").length,
    comparisonReady: filterCountyRunListItemsByQuickView(items, "comparison-ready").length,
    validatedScreening: items.filter((item) => item.stage === "validated-screening").length,
  };
}

export function filterCountyRunListItemsByQuickView(
  items: CountyRunListItem[],
  quickView: CountyRunQuickView
): CountyRunListItem[] {
  if (quickView === "all") {
    return items;
  }

  return items.filter((item) => {
    if (quickView === "comparison-ready") {
      return Boolean(item.behavioralComparisonReady);
    }

    if (quickView === "evidence-ready") {
      return (
        Boolean(item.behavioralEvidenceReady) &&
        !Boolean(item.behavioralComparisonReady) &&
        (item.behavioralPipelineStatus === "behavioral_runtime_succeeded" ||
          item.behavioralRuntimeStatus === "behavioral_runtime_succeeded")
      );
    }

    if (quickView === "best-validated") {
      return item.stage === "validated-screening";
    }

    if (quickView === "scaffold-backlog") {
      return (
        (item.scaffoldStationCount ?? 0) > 0 &&
        (item.scaffoldReadyStationCount ?? 0) < (item.scaffoldStationCount ?? 0)
      );
    }

    if (quickView === "prototype-blocked") {
      return (
        item.behavioralRuntimeStatus === "behavioral_runtime_blocked" ||
        item.behavioralRuntimeStatus === "behavioral_runtime_failed" ||
        item.behavioralPipelineStatus === "prototype_pipeline_failed" ||
        item.behavioralPipelineStatus === "prototype_preflight_complete"
      );
    }

    if (quickView === "needs-attention") {
      const evidenceReady =
        Boolean(item.behavioralEvidenceReady) &&
        !Boolean(item.behavioralComparisonReady) &&
        (item.behavioralPipelineStatus === "behavioral_runtime_succeeded" ||
          item.behavioralRuntimeStatus === "behavioral_runtime_succeeded");

      if (item.behavioralComparisonReady || evidenceReady) {
        return false;
      }

      return (
        item.enqueueStatus === "failed" ||
        item.stage === "bootstrap-incomplete" ||
        item.stage === "validation-scaffolded" ||
        ((item.scaffoldStationCount ?? 0) > 0 &&
          (item.scaffoldReadyStationCount ?? 0) < (item.scaffoldStationCount ?? 0)) ||
        item.behavioralRuntimeStatus === "behavioral_runtime_blocked" ||
        item.behavioralRuntimeStatus === "behavioral_runtime_failed" ||
        item.behavioralPipelineStatus === "prototype_pipeline_failed" ||
        item.behavioralPipelineStatus === "prototype_preflight_complete" ||
        (item.runtimePresetLabel === "Containerized behavioral smoke runtime (prototype)" && !item.behavioralPipelineStatus)
      );
    }

    return true;
  });
}

function compareNullableNumberAsc(a: number | null | undefined, b: number | null | undefined): number {
  const leftMissing = a == null;
  const rightMissing = b == null;
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return a - b;
}

function compareUpdatedDesc(a: CountyRunListItem, b: CountyRunListItem): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function sortCountyRunListItems(items: CountyRunListItem[], sort: CountyRunSort): CountyRunListItem[] {
  const next = [...items];

  next.sort((a, b) => {
    if (sort === "stage-desc") {
      const stageDelta = COUNTY_STAGE_SORT_RANK[b.stage] - COUNTY_STAGE_SORT_RANK[a.stage];
      return stageDelta || compareUpdatedDesc(a, b);
    }

    if (sort === "final-gap-asc") {
      const gapDelta = compareNullableNumberAsc(a.finalGap, b.finalGap);
      return gapDelta || compareUpdatedDesc(a, b);
    }

    if (sort === "median-ape-asc") {
      const apeDelta = compareNullableNumberAsc(a.medianApe, b.medianApe);
      return apeDelta || compareUpdatedDesc(a, b);
    }

    return compareUpdatedDesc(a, b);
  });

  return next;
}

export function getCountyBehavioralReadinessBadge(input: {
  pipelineStatus?: string | null;
  evidenceReady?: boolean;
  comparisonReady?: boolean;
  evidenceStatusLabel?: string | null;
  comparisonStatusLabel?: string | null;
}): CountyBehavioralReadinessBadge | null {
  const evidence = input.evidenceStatusLabel?.trim() ?? "";
  const comparison = input.comparisonStatusLabel?.trim() ?? "";

  if (input.comparisonReady) {
    return { label: "Comparison-ready run", tone: "success" };
  }
  if (input.pipelineStatus === "behavioral_runtime_succeeded" && input.evidenceReady) {
    return { label: "Evidence-ready run", tone: "success" };
  }
  if (input.pipelineStatus === "prototype_preflight_complete") {
    return { label: "Preflight-only evidence", tone: "warning" };
  }
  if (input.pipelineStatus === "behavioral_runtime_failed") {
    return { label: "Partial behavioral evidence", tone: "warning" };
  }
  if (input.pipelineStatus === "prototype_pipeline_failed") {
    return { label: "Behavioral pipeline failed", tone: "warning" };
  }
  if (input.pipelineStatus === "prototype_pipeline_running") {
    return { label: "Behavioral pipeline running", tone: "info" };
  }
  if (evidence === "Behavioral lane requested") {
    return { label: "Behavioral lane requested", tone: "info" };
  }
  if (comparison.includes("Await recorded behavioral state")) {
    return { label: "Awaiting recorded state", tone: "warning" };
  }
  if (!evidence && !comparison) {
    return null;
  }

  return { label: "Behavioral status available", tone: "neutral" };
}
