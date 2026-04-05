import type { CountyOnrampManifest, CountyRunStage } from "@/lib/models/county-onramp";
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
