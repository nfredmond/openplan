import {
  countyOnrampManifestSchema,
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

  return {
    id: row.id,
    geographyLabel: row.geography_label ?? row.geography_id,
    runName: row.run_name,
    stage: row.stage,
    statusLabel: row.status_label,
    enqueueStatus: row.enqueue_status ?? "not-enqueued",
    lastEnqueuedAt: row.last_enqueued_at ?? null,
    runtimePresetLabel: storedRequest.success ? getCountyRuntimePresetLabel(storedRequest.data.runtimeOptions) : null,
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

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    geographyType: row.geography_type,
    geographyId: row.geography_id,
    geographyLabel: row.geography_label ?? row.geography_id,
    runName: row.run_name,
    stage: row.stage,
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
