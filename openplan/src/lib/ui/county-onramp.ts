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

export type CountyBehavioralReadinessBadge = {
  label: string;
  tone: "neutral" | "info" | "warning" | "success";
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
  comparisonSupportLabel: string;
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
    comparisonSupportLabel: getBehavioralComparisonSupportLabel(summary),
    claim: getBehavioralClaim(summary),
    caveats: summary?.caveats ?? [],
  };
}

export function getCountyBehavioralReadinessBadge(input: {
  evidenceStatusLabel?: string | null;
  comparisonStatusLabel?: string | null;
}): CountyBehavioralReadinessBadge | null {
  const evidence = input.evidenceStatusLabel?.trim() ?? "";
  const comparison = input.comparisonStatusLabel?.trim() ?? "";

  if (!evidence && !comparison) {
    return null;
  }

  if (evidence === "Validation-ready county state") {
    return { label: "Behavioral review ready", tone: "success" };
  }
  if (evidence === "Behavioral evidence lane requested") {
    return { label: "Behavioral lane requested", tone: "info" };
  }
  if (comparison.includes("Await detail-level runtime evidence")) {
    return { label: "Awaiting runtime evidence", tone: "warning" };
  }
  if (comparison.includes("Open detail")) {
    return { label: "Open detail for readiness", tone: "info" };
  }

  return { label: "Behavioral status available", tone: "neutral" };
}
