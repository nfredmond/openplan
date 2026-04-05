import type { CountyOnrampManifest } from "@/lib/models/county-onramp";
import type { StoredCountyOnrampRequest } from "@/lib/api/county-onramp-worker";

export type CountyRunRecordInput = {
  workspace_id: string;
  geography_type: "county_fips";
  geography_id: string;
  geography_label: string | null;
  run_name: string;
  stage: CountyOnrampManifest["stage"];
  status_label: string | null;
  mode: CountyOnrampManifest["mode"];
  requested_runtime_json?: StoredCountyOnrampRequest | Record<string, unknown>;
  manifest_json: CountyOnrampManifest;
  run_summary_json: Record<string, unknown>;
  validation_summary_json: Record<string, unknown>;
};

export type CountyRunArtifactRecordInput = {
  county_run_id?: string;
  workspace_id: string;
  artifact_type: string;
  path: string;
  mime_type: string | null;
  size_bytes: number | null;
};

export function deriveCountyRunStatusLabel(manifest: CountyOnrampManifest): string | null {
  return manifest.summary.validation?.screening_gate?.status_label ?? null;
}

export function deriveCountyBundleValidationSummary(
  validationSummary: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!validationSummary || typeof validationSummary !== "object") {
    return null;
  }

  const nextSummary: Record<string, unknown> = {};

  for (const key of ["counts_csv", "stations_total", "stations_matched", "stations_unmatched"]) {
    const value = validationSummary[key];
    if (value !== undefined) {
      nextSummary[key] = value;
    }
  }

  const screeningGate = validationSummary.screening_gate;
  if (screeningGate && typeof screeningGate === "object") {
    const statusLabel = (screeningGate as Record<string, unknown>).status_label;
    const reasons = (screeningGate as Record<string, unknown>).reasons;
    if (typeof statusLabel === "string" && statusLabel.length > 0) {
      nextSummary.status_label = statusLabel;
    }
    if (Array.isArray(reasons)) {
      nextSummary.reasons = reasons;
    }
  }

  return Object.keys(nextSummary).length > 0 ? nextSummary : null;
}

export function deriveCountyRunStageFromValidation(params: {
  runSummary: Record<string, unknown> | null | undefined;
  validationSummary: Record<string, unknown> | null | undefined;
}): CountyOnrampManifest["stage"] {
  const screeningGate = params.validationSummary?.screening_gate;
  const statusLabel =
    screeningGate && typeof screeningGate === "object"
      ? (screeningGate as Record<string, unknown>).status_label
      : null;

  if (typeof statusLabel === "string") {
    const normalized = statusLabel.toLowerCase();
    if (normalized.includes("bounded screening-ready") || normalized.includes("validated")) {
      return "validated-screening";
    }
  }

  if (params.validationSummary && Object.keys(params.validationSummary).length > 0) {
    return "validation-scaffolded";
  }

  if (params.runSummary && Object.keys(params.runSummary).length > 0) {
    return "runtime-complete";
  }

  return "bootstrap-incomplete";
}

export function buildCountyRunRecord(params: {
  workspaceId: string;
  geographyId: string;
  geographyLabel: string | null;
  manifest: CountyOnrampManifest;
}): CountyRunRecordInput {
  const { workspaceId, geographyId, geographyLabel, manifest } = params;
  return {
    workspace_id: workspaceId,
    geography_type: "county_fips",
    geography_id: geographyId,
    geography_label: geographyLabel,
    run_name: manifest.name,
    stage: manifest.stage,
    status_label: deriveCountyRunStatusLabel(manifest),
    mode: manifest.mode,
    manifest_json: manifest,
    run_summary_json: manifest.summary.run as Record<string, unknown>,
    validation_summary_json: (manifest.summary.validation ?? {}) as Record<string, unknown>,
  };
}

export function buildCountyRunArtifacts(params: {
  workspaceId: string;
  manifest: CountyOnrampManifest;
}): CountyRunArtifactRecordInput[] {
  const { workspaceId, manifest } = params;
  const artifacts: CountyRunArtifactRecordInput[] = [];
  const pushArtifact = (artifactType: string, path: string | null | undefined, mimeType: string | null = null) => {
    if (!path) return;
    artifacts.push({
      workspace_id: workspaceId,
      artifact_type: artifactType,
      path,
      mime_type: mimeType,
      size_bytes: null,
    });
  };

  pushArtifact("validation_scaffold_csv", manifest.artifacts.scaffold_csv, "text/csv");
  pushArtifact("validation_review_packet_md", manifest.artifacts.review_packet_md, "text/markdown");
  pushArtifact("run_summary_json", manifest.artifacts.run_summary_json, "application/json");
  pushArtifact("bundle_manifest_json", manifest.artifacts.bundle_manifest_json, "application/json");
  pushArtifact("validation_summary_json", manifest.artifacts.validation_summary_json, "application/json");

  return artifacts;
}
