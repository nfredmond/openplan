import { createHash } from "node:crypto";
import {
  jsonValuesEqual,
  sortedCompactJson,
  type DemandAgreementCustody,
  type DemandAgreementVerification,
} from "@/lib/models/demand-agreement-artifact";
import {
  loadArtifactBytes as loadScopedArtifactBytes,
  resolveRunWorkDir as defaultResolveRunWorkDir,
  workerLocalRoot as defaultWorkerLocalRoot,
} from "@/lib/models/artifact-source";
import { DEMAND_MODEL_AGREEMENT_STAGE_NAME } from "@/lib/models/run-dispatch";
import {
  verifyDualDemandAgreementEvidence,
  type DualDemandAgreementVerificationState,
} from "@/lib/models/verified-dual-demand-agreement";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type QueryError = { message: string; code?: string | null } | null;
type QueryResult = { data: unknown; error: QueryError };
type QueryBuilder = PromiseLike<QueryResult> & {
  eq: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => PromiseLike<QueryResult>;
};
type SupabaseLike = {
  from: (table: string) => { select: (columns: string) => QueryBuilder };
};

export type RegisteredAgreementArtifactType =
  | "demand_model_agreement"
  | "demand_model_agreement_geojson";

export type RegisteredDualDemandAgreement = Extract<
  DualDemandAgreementVerificationState,
  { status: "verified" }
> & {
  bytes: Uint8Array;
  payload: unknown;
  verification: DemandAgreementVerification;
  artifactType: RegisteredAgreementArtifactType;
  fileUrl: string;
  stageId: string;
};

export type RegisteredDualDemandAgreementState =
  | Exclude<DualDemandAgreementVerificationState, { status: "verified" }>
  | RegisteredDualDemandAgreement;

export type RegisteredDualDemandAgreementScope = {
  modelRunId: string;
  artifactType: RegisteredAgreementArtifactType;
  expectedModelId?: string;
  expectedWorkspaceId?: string;
  expectedProjectId?: string;
};

export type RegisteredDualDemandAgreementDependencies = {
  loadArtifactBytes: typeof loadScopedArtifactBytes;
  workerLocalRoot: typeof defaultWorkerLocalRoot;
  resolveRunWorkDir: typeof defaultResolveRunWorkDir;
};

const DEFAULT_DEPENDENCIES: RegisteredDualDemandAgreementDependencies = {
  loadArtifactBytes: loadScopedArtifactBytes,
  workerLocalRoot: defaultWorkerLocalRoot,
  resolveRunWorkDir: defaultResolveRunWorkDir,
};

type ArtifactRow = {
  id: string;
  artifact_type: RegisteredAgreementArtifactType;
  file_url: string;
  content_hash: string;
  file_size_bytes: number;
  metadata_json: Record<string, unknown>;
  stage_id: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validArtifactRow(
  value: unknown,
  artifactType: RegisteredAgreementArtifactType,
): ArtifactRow | null {
  const row = record(value);
  const metadata = record(row?.metadata_json);
  if (
    !row ||
    !metadata ||
    typeof row.id !== "string" ||
    row.artifact_type !== artifactType ||
    typeof row.file_url !== "string" ||
    !row.file_url ||
    !sha256(row.content_hash) ||
    typeof row.file_size_bytes !== "number" ||
    !Number.isSafeInteger(row.file_size_bytes) ||
    row.file_size_bytes < 0 ||
    typeof row.stage_id !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    artifact_type: row.artifact_type as RegisteredAgreementArtifactType,
    file_url: row.file_url,
    content_hash: row.content_hash,
    file_size_bytes: row.file_size_bytes,
    metadata_json: metadata,
    stage_id: row.stage_id,
  };
}

function metadataVerification(
  metadata: Record<string, unknown>,
  artifactSha256: string,
): DemandAgreementVerification | null {
  if (
    metadata.kind !== "dual_demand_model_agreement" ||
    metadata.is_average !== false ||
    (metadata.upload_status !== "stored" && metadata.upload_status !== "local_fallback") ||
    !sha256(metadata.assignment_profile_digest) ||
    !sha256(metadata.network_settings_digest) ||
    !sha256(metadata.network_state_digest)
  ) {
    return null;
  }
  return {
    artifactSha256,
    assignmentProfileSha256: metadata.assignment_profile_digest,
    networkSettingsSha256: metadata.network_settings_digest,
    networkStateSha256: metadata.network_state_digest,
  };
}

function convergenceRecordMatches(
  value: unknown,
  finalGap: number | null,
  verification: DemandAgreementVerification,
  evidence: DemandAgreementCustody["evidence"],
): boolean {
  const convergence = record(value);
  if (!convergence) return false;
  const expectedKeys = [
    "final_gap",
    "iterations",
    "target_gap",
    "max_iterations",
    "algorithm",
    "converged",
    "assignment_profile",
    "assignment_profile_payload_json",
    "assignment_profile_digest",
  ].sort();
  const actualKeys = Object.keys(convergence).sort();
  const profile = evidence.assignmentProfile;
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    convergence.final_gap === finalGap &&
    (convergence.iterations === null ||
      (typeof convergence.iterations === "number" &&
        Number.isSafeInteger(convergence.iterations) &&
        convergence.iterations >= 0)) &&
    convergence.target_gap === profile.target_gap &&
    convergence.max_iterations === profile.max_iterations &&
    convergence.algorithm === profile.algorithm &&
    convergence.converged ===
      (finalGap !== null &&
        typeof profile.target_gap === "number" &&
        finalGap <= profile.target_gap) &&
    jsonValuesEqual(convergence.assignment_profile, evidence.assignmentProfile) &&
    convergence.assignment_profile_payload_json === evidence.assignmentProfilePayloadJson &&
    convergence.assignment_profile_digest === verification.assignmentProfileSha256
  );
}

function artifactCustodyMatches(
  metadata: Record<string, unknown>,
  fileUrl: string,
  verification: DemandAgreementVerification,
  custody: DemandAgreementCustody,
): boolean {
  const evidence = custody.evidence;
  if (
    (fileUrl.startsWith("storage://") && metadata.upload_status !== "stored") ||
    (fileUrl.startsWith("local://") && metadata.upload_status !== "local_fallback") ||
    typeof metadata.assignment_profile_payload_json !== "string" ||
    typeof metadata.network_settings_payload_json !== "string"
  ) {
    return false;
  }

  let statePayload: string;
  try {
    statePayload = sortedCompactJson(metadata.network_state_record);
  } catch {
    return false;
  }

  for (const [candidate, finalGap] of [
    [metadata.first_assignment_convergence, evidence.convergenceGaps.first],
    [metadata.second_assignment_convergence, evidence.convergenceGaps.second],
  ] as const) {
    if (!convergenceRecordMatches(candidate, finalGap, verification, evidence)) return false;
  }

  const roadwayLinkIdsPayload = JSON.stringify(
    [...evidence.roadwayLinkIds].sort((first, second) => first - second),
  );
  return (
    metadata.assignment_profile_payload_json === evidence.assignmentProfilePayloadJson &&
    jsonValuesEqual(metadata.assignment_profile, evidence.assignmentProfile) &&
    sha256Text(metadata.assignment_profile_payload_json) === verification.assignmentProfileSha256 &&
    metadata.network_settings_payload_json === evidence.networkSettingsPayloadJson &&
    jsonValuesEqual(metadata.network_settings, evidence.networkSettings) &&
    sha256Text(metadata.network_settings_payload_json) === verification.networkSettingsSha256 &&
    jsonValuesEqual(metadata.network_state_record, evidence.networkStateRecord) &&
    sha256Text(statePayload) === verification.networkStateSha256 &&
    sha256Text(evidence.assignmentProfilePayloadJson) === verification.assignmentProfileSha256 &&
    sha256Text(evidence.networkSettingsPayloadJson) === verification.networkSettingsSha256 &&
    sha256Text(sortedCompactJson(evidence.networkStateRecord)) === verification.networkStateSha256 &&
    sha256Text(roadwayLinkIdsPayload) ===
      evidence.retainedNetworkManifest.roadway_link_ids_digest
  );
}

/**
 * Load and verify one registered artifact. Absence, unreadability, invalidity,
 * and verified evidence stay separate all the way to the caller.
 */
export async function loadRegisteredDualDemandAgreement(
  supabase: unknown,
  scope: RegisteredDualDemandAgreementScope,
  dependencies: RegisteredDualDemandAgreementDependencies = DEFAULT_DEPENDENCIES,
): Promise<RegisteredDualDemandAgreementState> {
  const client = supabase as SupabaseLike;
  let runQuery = client
    .from("model_runs")
    .select("id, status, workspace_id, project_id, model_id")
    .eq("id", scope.modelRunId);
  if (scope.expectedModelId) runQuery = runQuery.eq("model_id", scope.expectedModelId);
  if (scope.expectedWorkspaceId) runQuery = runQuery.eq("workspace_id", scope.expectedWorkspaceId);
  if (scope.expectedProjectId) runQuery = runQuery.eq("project_id", scope.expectedProjectId);
  const runResult = await runQuery.maybeSingle();
  if (runResult.error) {
    return { status: "unreadable", reason: `The model run could not be read: ${runResult.error.message}` };
  }
  const run = record(runResult.data);
  if (!run) return { status: "absent", reason: "The model run is not available." };
  if (run.status !== "succeeded") {
    return { status: "invalid", reason: "The model run did not succeed." };
  }

  const artifactResult = await client
    .from("model_run_artifacts")
    .select("id, artifact_type, file_url, content_hash, file_size_bytes, metadata_json, stage_id")
    .eq("run_id", scope.modelRunId)
    .eq("artifact_type", scope.artifactType)
    .order("created_at", { ascending: false })
    .limit(1);
  if (artifactResult.error) {
    return {
      status: "unreadable",
      reason: `The agreement artifact registry could not be read: ${artifactResult.error.message}`,
    };
  }
  const artifactRows = Array.isArray(artifactResult.data) ? artifactResult.data : [];
  if (artifactRows.length === 0) {
    return { status: "absent", reason: "This run has no registered dual-model agreement artifact." };
  }
  const artifact = validArtifactRow(artifactRows[0], scope.artifactType);
  if (!artifact) {
    return { status: "invalid", reason: "The agreement artifact registration is invalid." };
  }

  const stageResult = await client
    .from("model_run_stages")
    .select("id, run_id, stage_name, status")
    .eq("id", artifact.stage_id)
    .eq("run_id", scope.modelRunId)
    .maybeSingle();
  if (stageResult.error) {
    return { status: "unreadable", reason: `The agreement stage could not be read: ${stageResult.error.message}` };
  }
  const stage = record(stageResult.data);
  if (
    !stage ||
    stage.id !== artifact.stage_id ||
    stage.run_id !== scope.modelRunId ||
    stage.stage_name !== DEMAND_MODEL_AGREEMENT_STAGE_NAME ||
    stage.status !== "succeeded"
  ) {
    return { status: "invalid", reason: "The agreement artifact is not attached to a succeeded agreement stage." };
  }

  let bytes: Uint8Array;
  try {
    const localRoot = dependencies.workerLocalRoot();
    bytes = await dependencies.loadArtifactBytes(artifact.file_url, {
      bucket: "run-artifacts",
      objectPathPrefix: `model-runs/${scope.modelRunId}/`,
      localRoot: localRoot
        ? dependencies.resolveRunWorkDir(localRoot, scope.modelRunId)
        : undefined,
    });
  } catch (error) {
    return {
      status: "unreadable",
      reason: `The agreement artifact bytes could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const artifactSha256 = sha256Bytes(bytes);
  if (bytes.byteLength !== artifact.file_size_bytes || artifactSha256 !== artifact.content_hash) {
    return { status: "invalid", reason: "The agreement artifact bytes do not match the registered size and hash." };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { status: "invalid", reason: "The agreement artifact is not valid UTF-8 JSON." };
  }
  const verification = metadataVerification(artifact.metadata_json, artifactSha256);
  if (!verification) {
    return { status: "invalid", reason: "The agreement artifact registration does not carry valid custody digests." };
  }
  const verified = verifyDualDemandAgreementEvidence({
    source: "registered_artifact",
    payload,
    verification,
    modelRunId: scope.modelRunId,
    artifactId: artifact.id,
    isAverage: artifact.metadata_json.is_average,
    artifactType: scope.artifactType,
  });
  if (verified.status !== "verified") return verified;
  if (!verified.custody) {
    return { status: "invalid", reason: "The agreement artifact does not carry assignment and network custody." };
  }
  if (!artifactCustodyMatches(artifact.metadata_json, artifact.file_url, verification, verified.custody)) {
    return { status: "invalid", reason: "The artifact bytes and registered assignment or network custody disagree." };
  }

  return {
    ...verified,
    bytes,
    payload,
    verification,
    artifactType: scope.artifactType,
    fileUrl: artifact.file_url,
    stageId: artifact.stage_id,
  };
}
