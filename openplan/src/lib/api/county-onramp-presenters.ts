import {
  countyOnrampManifestSchema,
  getCountyRunStageReasonLabel,
  type CountyOnrampManifest,
  type CountyRunStage,
} from "@/lib/models/county-onramp";
import {
  buildCountyOnrampWorkerPayloadFromStoredRequest,
  sanitizeCountyOnrampWorkerPayload,
  storedCountyOnrampRequestSchema,
} from "@/lib/api/county-onramp-worker";
import { getCountyRuntimePresetLabel } from "@/lib/models/county-runtime-presets";
import type {
  CountyRunArtifact,
  CountyRunDetailResponse,
  CountyRunListItem,
} from "@/lib/api/county-onramp";

export type CountyRunRowLike = {
  id: string;
  workspace_id: string;
  geography_type: string;
  geography_id: string;
  geography_label: string | null;
  run_name: string;
  stage: CountyRunStage;
  status_label: string | null;
  enqueue_status?: "not-enqueued" | "queued_stub" | "failed" | null;
  last_enqueued_at?: string | null;
  requested_runtime_json?: Record<string, unknown> | null;
  manifest_json?: Record<string, unknown> | null;
  validation_summary_json?: Record<string, unknown> | null;
  updated_at?: string | null;
};

export type CountyRunArtifactRowLike = {
  artifact_type: string;
  path: string;
};

export function parseCountyOnrampManifest(value: unknown): CountyOnrampManifest | null {
  const parsed = countyOnrampManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function presentCountyRunListItem(row: CountyRunRowLike): CountyRunListItem {
  const storedRequest = storedCountyOnrampRequestSchema.safeParse(row.requested_runtime_json);
  const runtimePresetLabel = storedRequest.success ? getCountyRuntimePresetLabel(storedRequest.data.runtimeOptions) : null;
  const manifest = parseCountyOnrampManifest(row.manifest_json);
  const behavioral = manifest?.summary?.behavioral_prototype;

  const behavioralEvidenceReady = Boolean(
    behavioral?.prototype_manifest_path || behavioral?.runtime_manifest_path || behavioral?.runtime_summary_path
  );
  const behavioralComparisonReady =
    behavioral?.pipeline_status === "behavioral_runtime_succeeded" && Boolean(behavioral?.kpi_summary_path);
  const artifactAvailabilityLabels = [
    manifest?.artifacts?.scaffold_csv ? "Scaffold CSV" : null,
    manifest?.artifacts?.review_packet_md ? "Review packet" : null,
    manifest?.artifacts?.validation_summary_json ? "Validation summary" : null,
    manifest?.artifacts?.activitysim_bundle_manifest_json ? "ActivitySim bundle" : null,
    manifest?.artifacts?.behavioral_prototype_manifest_json ? "Behavioral prototype" : null,
    manifest?.artifacts?.behavioral_kpi_summary_json ? "Behavioral KPI Summary" : null,
    manifest?.artifacts?.behavioral_kpi_packet_md ? "Behavioral KPI Packet" : null,
  ].filter((value): value is string => Boolean(value));
  const metricAvailabilityLabels = [
    manifest?.summary?.run?.zone_count != null ? `Zones ${manifest.summary.run.zone_count}` : null,
    manifest?.summary?.run?.loaded_links != null ? `Links ${manifest.summary.run.loaded_links}` : null,
    manifest?.summary?.run?.final_gap != null ? `Gap ${manifest.summary.run.final_gap.toFixed(4)}` : null,
    manifest?.summary?.validation?.metrics?.median_absolute_percent_error != null
      ? `Median APE ${manifest.summary.validation.metrics.median_absolute_percent_error.toFixed(2)}%`
      : null,
    manifest?.summary?.scaffold?.station_count != null
      ? `Scaffold ready ${manifest.summary.scaffold.ready_station_count}/${manifest.summary.scaffold.station_count}`
      : null,
  ].filter((value): value is string => Boolean(value));

  let behavioralEvidenceStatusLabel: string | null = null;
  let behavioralComparisonStatusLabel: string | null = null;

  if (behavioral?.pipeline_status === "behavioral_runtime_succeeded") {
    behavioralEvidenceStatusLabel = behavioralEvidenceReady
      ? "Recorded behavioral evidence available"
      : "Behavioral runtime succeeded";
    behavioralComparisonStatusLabel = behavioralComparisonReady
      ? "Comparison-ready run"
      : "Runtime succeeded; KPI comparison pending";
  } else if (behavioral?.pipeline_status === "prototype_preflight_complete") {
    behavioralEvidenceStatusLabel = behavioralEvidenceReady
      ? "Preflight-only behavioral evidence"
      : "Behavioral preflight recorded";
    behavioralComparisonStatusLabel = "Comparison blocked: preflight only";
  } else if (behavioral?.pipeline_status === "behavioral_runtime_failed") {
    behavioralEvidenceStatusLabel = behavioralEvidenceReady
      ? "Partial behavioral evidence only"
      : "Behavioral runtime failed";
    behavioralComparisonStatusLabel = "Comparison blocked: partial outputs only";
  } else if (behavioral?.pipeline_status === "prototype_pipeline_failed") {
    behavioralEvidenceStatusLabel = "Behavioral evidence blocked";
    behavioralComparisonStatusLabel = "Comparison blocked: pipeline failed";
  } else if (behavioral?.pipeline_status === "prototype_pipeline_running") {
    behavioralEvidenceStatusLabel = "Behavioral pipeline running";
    behavioralComparisonStatusLabel = "Comparison pending";
  } else if (runtimePresetLabel === "Containerized behavioral smoke runtime (prototype)") {
    behavioralEvidenceStatusLabel = "Behavioral lane requested";
    behavioralComparisonStatusLabel = "Await recorded behavioral state";
  }

  const stageReasonLabel = getCountyRunStageReasonLabel({
    stage: row.stage,
    enqueueStatus: row.enqueue_status ?? "not-enqueued",
    statusLabel: row.status_label,
    behavioralPipelineStatus: behavioral?.pipeline_status ?? null,
    behavioralRuntimeStatus: behavioral?.runtime_status ?? null,
    behavioralComparisonReady,
    behavioralEvidenceReady,
    scaffoldSummary: manifest?.summary?.scaffold ?? null,
  });

  return {
    id: row.id,
    geographyLabel: row.geography_label ?? row.geography_id,
    runName: row.run_name,
    stage: row.stage,
    stageReasonLabel,
    statusLabel: row.status_label,
    enqueueStatus: row.enqueue_status ?? "not-enqueued",
    lastEnqueuedAt: row.last_enqueued_at ?? null,
    runtimePresetLabel,
    behavioralPipelineStatus: behavioral?.pipeline_status ?? null,
    behavioralRuntimeStatus: behavioral?.runtime_status ?? null,
    behavioralRuntimeMode: behavioral?.runtime_mode ?? null,
    behavioralEvidenceReady,
    behavioralComparisonReady,
    behavioralEvidenceStatusLabel,
    behavioralComparisonStatusLabel,
    scaffoldStationCount: manifest?.summary?.scaffold?.station_count ?? null,
    scaffoldReadyStationCount: manifest?.summary?.scaffold?.ready_station_count ?? null,
    artifactAvailabilityLabels,
    metricAvailabilityLabels,
    zoneCount: manifest?.summary?.run?.zone_count ?? null,
    loadedLinks: manifest?.summary?.run?.loaded_links ?? null,
    finalGap: manifest?.summary?.run?.final_gap ?? null,
    medianApe: manifest?.summary?.validation?.metrics?.median_absolute_percent_error ?? null,
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
  };
}

export function presentCountyRunArtifact(row: CountyRunArtifactRowLike): CountyRunArtifact {
  return {
    artifactType: row.artifact_type,
    path: row.path,
  };
}

export function presentCountyRunDetail(params: {
  row: CountyRunRowLike;
  artifacts: CountyRunArtifactRowLike[];
  origin?: string;
}): CountyRunDetailResponse {
  const { row, artifacts, origin } = params;
  const manifest = parseCountyOnrampManifest(row.manifest_json);
  const storedRequest = storedCountyOnrampRequestSchema.safeParse(row.requested_runtime_json);
  const workerPayload =
    origin && storedRequest.success
      ? sanitizeCountyOnrampWorkerPayload(
          buildCountyOnrampWorkerPayloadFromStoredRequest({
            origin,
            jobId: crypto.randomUUID(),
            countyRunId: row.id,
            input: storedRequest.data,
          })
        )
      : null;

  const behavioral = manifest?.summary?.behavioral_prototype;
  const behavioralEvidenceReady = Boolean(
    behavioral?.prototype_manifest_path || behavioral?.runtime_manifest_path || behavioral?.runtime_summary_path
  );
  const behavioralComparisonReady =
    behavioral?.pipeline_status === "behavioral_runtime_succeeded" && Boolean(behavioral?.kpi_summary_path);
  const stageReasonLabel = getCountyRunStageReasonLabel({
    stage: row.stage,
    enqueueStatus: row.enqueue_status ?? "not-enqueued",
    statusLabel: row.status_label,
    behavioralPipelineStatus: behavioral?.pipeline_status ?? null,
    behavioralRuntimeStatus: behavioral?.runtime_status ?? null,
    behavioralComparisonReady,
    behavioralEvidenceReady,
    scaffoldSummary: manifest?.summary?.scaffold ?? null,
  });

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    geographyType: row.geography_type,
    geographyId: row.geography_id,
    geographyLabel: row.geography_label ?? row.geography_id,
    runName: row.run_name,
    stage: row.stage,
    stageReasonLabel,
    statusLabel: row.status_label,
    enqueueStatus: row.enqueue_status ?? "not-enqueued",
    lastEnqueuedAt: row.last_enqueued_at ?? null,
    runtimePresetLabel: storedRequest.success ? getCountyRuntimePresetLabel(storedRequest.data.runtimeOptions) : null,
    workerPayload,
    manifest,
    artifacts: artifacts.map(presentCountyRunArtifact),
    validationSummary: row.validation_summary_json ?? null,
  };
}
