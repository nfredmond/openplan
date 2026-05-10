import type { CountyRunArtifact } from "@/lib/api/county-onramp";
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

export type CountyRunManifestProofRow = {
  label: string;
  value: string;
};

export type CountyRunManifestProofSummary = {
  proofStatusLabel: string;
  proofStatusTone: "neutral" | "info" | "warning" | "success";
  inputRows: CountyRunManifestProofRow[];
  artifactRows: CountyRunManifestProofRow[];
  validationRows: CountyRunManifestProofRow[];
  operatorNextAction: string;
  caveatRows: string[];
};

function formatKnownNumber(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function compactValues(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join("; ");
}

function presentArtifactLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/Json\b/g, "JSON")
    .replace(/Csv\b/g, "CSV");
}

function buildManifestArtifactRows(manifest: CountyOnrampManifest | null | undefined): CountyRunManifestProofRow[] {
  if (!manifest) return [];

  return Object.entries(manifest.artifacts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([key, value]) => ({
      label: presentArtifactLabel(key),
      value,
    }));
}

function buildRegisteredArtifactRows(artifacts: CountyRunArtifact[]): CountyRunManifestProofRow[] {
  return artifacts.map((artifact) => ({
    label: `Registered ${presentArtifactLabel(artifact.artifactType)}`,
    value: artifact.path,
  }));
}

function appendUniqueRows(rows: CountyRunManifestProofRow[]): CountyRunManifestProofRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}:${row.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

export function buildCountyRunManifestProofSummary(input: {
  manifest: CountyOnrampManifest | null | undefined;
  artifacts: CountyRunArtifact[];
  stage: CountyRunStage;
  statusLabel?: string | null;
}): CountyRunManifestProofSummary {
  const { manifest, artifacts, stage, statusLabel } = input;
  const stageLabel = getCountyRunStageLabel(stage);
  const manifestStatusLabel = getCountyRunStatusLabel(manifest);
  const validationStatusLabel = manifestStatusLabel ?? statusLabel ?? null;
  const metrics = getCountyRunMetricHighlights(manifest);
  const scaffold = manifest?.summary?.scaffold;
  const runtime = manifest?.runtime;

  const artifactRows = appendUniqueRows([
    ...buildManifestArtifactRows(manifest),
    ...buildRegisteredArtifactRows(artifacts),
  ]);

  const inputRows: CountyRunManifestProofRow[] = manifest
    ? [
        { label: "County FIPS", value: manifest.county_fips ?? "Not recorded" },
        { label: "County prefix", value: manifest.county_prefix },
        { label: "Run mode", value: manifest.mode },
        { label: "Run directory", value: manifest.run_dir },
        {
          label: "Runtime options",
          value: compactValues([
            runtime ? `keepProject ${String(runtime.keep_project)}` : null,
            runtime ? `force ${String(runtime.force)}` : null,
            runtime?.overall_demand_scalar != null ? `overall scalar ${runtime.overall_demand_scalar}` : null,
            runtime?.external_demand_scalar != null ? `external scalar ${runtime.external_demand_scalar}` : null,
            runtime?.hbw_scalar != null ? `HBW ${runtime.hbw_scalar}` : null,
            runtime?.hbo_scalar != null ? `HBO ${runtime.hbo_scalar}` : null,
            runtime?.nhb_scalar != null ? `NHB ${runtime.nhb_scalar}` : null,
          ]) || "Runtime options recorded with default scalars.",
        },
      ]
    : [{ label: "Manifest", value: "No manifest has been ingested for this county run yet." }];

  const validationRows: CountyRunManifestProofRow[] = [
    { label: "Recorded stage", value: stageLabel },
    { label: "Screening gate", value: validationStatusLabel ?? "No screening-gate status recorded yet." },
    ...(formatKnownNumber(metrics.medianApe)
      ? [{ label: "Median APE", value: `${formatKnownNumber(metrics.medianApe)}%` }]
      : []),
    ...(formatKnownNumber(metrics.maxApe)
      ? [{ label: "Max APE", value: `${formatKnownNumber(metrics.maxApe)}%` }]
      : []),
    ...(scaffold
      ? [
          {
            label: "Observed-count readiness",
            value: `${scaffold.ready_station_count} of ${scaffold.station_count} stations ready; ${scaffold.observed_volume_missing_count} missing observed volumes.`,
          },
        ]
      : []),
  ];

  const manifestHasValidationArtifact = Boolean(manifest?.artifacts.validation_summary_json);
  const proofStatusLabel = !manifest
    ? "Manifest missing"
    : stage === "validated-screening" && manifestHasValidationArtifact && validationStatusLabel
      ? "Manifest and validation proof present"
      : manifestHasValidationArtifact || validationStatusLabel
        ? "Manifest present; validation needs review"
        : "Manifest present; validation pending";
  const proofStatusTone = !manifest
    ? "warning"
    : stage === "validated-screening" && manifestHasValidationArtifact && validationStatusLabel
      ? "success"
      : manifestHasValidationArtifact || validationStatusLabel
        ? "info"
        : "warning";

  return {
    proofStatusLabel,
    proofStatusTone,
    inputRows,
    artifactRows: artifactRows.length
      ? artifactRows
      : [{ label: "Generated artifacts", value: "No generated artifact paths are recorded yet." }],
    validationRows,
    operatorNextAction: manifest ? getCountyRunNextAction(stage) : "Prepare the run handoff or ingest a manifest before using this county run as evidence.",
    caveatRows: appendUniqueRows([
      ...getCountyRunCaveats(stage).map((caveat) => ({ label: caveat, value: caveat })),
      {
        label: "Manifest boundary",
        value: "A recorded manifest proves file inventory and validation posture only; it is not a validated behavioral forecast or autonomous planning recommendation.",
      },
      {
        label: "Operator boundary",
        value: "Use this run inside supervised planning review and preserve source, validation, and caveat context in downstream reports.",
      },
    ]).map((row) => row.value),
  };
}
