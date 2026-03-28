import type {
  CountyOnrampBehavioralPrototypeSummary,
  CountyOnrampManifest,
  CountyRunStage,
} from "@/lib/models/county-onramp";
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

export type CountyBehavioralPrototypeUiCard = {
  pipelineStatus: string | null;
  runtimeStatus: string | null;
  runtimeMode: string | null;
  claim: string;
  caveats: string[];
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

export function buildCountyBehavioralPrototypeUiCard(
  manifest: CountyOnrampManifest | null | undefined
): CountyBehavioralPrototypeUiCard {
  const summary = manifest?.summary?.behavioral_prototype;
  return {
    pipelineStatus: summary?.pipeline_status ?? null,
    runtimeStatus: summary?.runtime_status ?? null,
    runtimeMode: summary?.runtime_mode ?? null,
    claim: getBehavioralClaim(summary),
    caveats: summary?.caveats ?? [],
  };
}
