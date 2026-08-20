import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { loadModelAccess } from "@/lib/models/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { DEMAND_MODEL_AGREEMENT_STAGE_NAME } from "@/lib/models/run-dispatch";
import {
  AGREEMENT_VERIFICATION_HEADERS,
  jsonValuesEqual,
  parseDemandAgreementArtifact,
  sortedCompactJson,
  type DemandAgreementVerification,
} from "@/lib/models/demand-agreement-artifact";
import {
  loadArtifactBytes,
  resolveRunWorkDir,
  workerLocalRoot,
} from "../volumes/artifact-source";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const artifactRowSchema = z.object({
  artifact_type: z.literal("demand_model_agreement_geojson"),
  file_url: z.string().min(1),
  content_hash: sha256Schema,
  file_size_bytes: z.number().int().nonnegative().safe(),
  metadata_json: z.record(z.string(), z.unknown()),
  stage_id: z.string().uuid(),
});

type RouteContext = { params: Promise<{ modelId: string; modelRunId: string }> };

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function convergenceRecordMatches(
  value: unknown,
  finalGap: number | null,
  verification: DemandAgreementVerification,
  evidence: Extract<
    ReturnType<typeof parseDemandAgreementArtifact>,
    { status: "render_links" }
  >["evidence"],
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
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
  const actualKeys = Object.keys(record).sort();
  const profile = evidence.assignmentProfile;
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    record.final_gap === finalGap &&
    (record.iterations === null ||
      (typeof record.iterations === "number" &&
        Number.isSafeInteger(record.iterations) &&
        record.iterations >= 0)) &&
    record.target_gap === profile.target_gap &&
    record.max_iterations === profile.max_iterations &&
    record.algorithm === profile.algorithm &&
    record.converged ===
      (finalGap !== null &&
        typeof profile.target_gap === "number" &&
        finalGap <= profile.target_gap) &&
    jsonValuesEqual(record.assignment_profile, evidence.assignmentProfile) &&
    record.assignment_profile_payload_json === evidence.assignmentProfilePayloadJson &&
    record.assignment_profile_digest === verification.assignmentProfileSha256
  );
}

function metadataVerification(
  metadata: Record<string, unknown>,
  artifactSha256: string,
): DemandAgreementVerification | null {
  if (
    metadata.kind !== "dual_demand_model_agreement" ||
    metadata.is_average !== false ||
    (metadata.upload_status !== "stored" && metadata.upload_status !== "local_fallback") ||
    !sha256Schema.safeParse(metadata.assignment_profile_digest).success ||
    !sha256Schema.safeParse(metadata.network_settings_digest).success ||
    !sha256Schema.safeParse(metadata.network_state_digest).success
  ) {
    return null;
  }
  return {
    artifactSha256,
    assignmentProfileSha256: metadata.assignment_profile_digest as string,
    networkSettingsSha256: metadata.network_settings_digest as string,
    networkStateSha256: metadata.network_state_digest as string,
  };
}

function artifactCustodyMatches(
  metadata: Record<string, unknown>,
  fileUrl: string,
  verification: DemandAgreementVerification,
  evidence: Extract<
    ReturnType<typeof parseDemandAgreementArtifact>,
    { status: "render_links" }
  >["evidence"],
): boolean {
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

  const convergenceRecords = [
    [metadata.first_assignment_convergence, evidence.convergenceGaps.first],
    [metadata.second_assignment_convergence, evidence.convergenceGaps.second],
  ] as const;
  for (const [candidate, finalGap] of convergenceRecords) {
    if (!convergenceRecordMatches(candidate, finalGap, verification, evidence)) {
      return false;
    }
  }

  return (
    metadata.assignment_profile_payload_json === evidence.assignmentProfilePayloadJson &&
    jsonValuesEqual(metadata.assignment_profile, evidence.assignmentProfile) &&
    sha256Text(metadata.assignment_profile_payload_json) ===
      verification.assignmentProfileSha256 &&
    metadata.network_settings_payload_json === evidence.networkSettingsPayloadJson &&
    jsonValuesEqual(metadata.network_settings, evidence.networkSettings) &&
    sha256Text(metadata.network_settings_payload_json) === verification.networkSettingsSha256 &&
    jsonValuesEqual(metadata.network_state_record, evidence.networkStateRecord) &&
    sha256Text(statePayload) === verification.networkStateSha256
  );
}

function embeddedDigestsMatch(
  verification: DemandAgreementVerification,
  evidence: Extract<
    ReturnType<typeof parseDemandAgreementArtifact>,
    { status: "render_links" }
  >["evidence"],
): boolean {
  let statePayload: string;
  try {
    statePayload = sortedCompactJson(evidence.networkStateRecord);
  } catch {
    return false;
  }
  const roadwayLinkIdsPayload = JSON.stringify(
    [...evidence.roadwayLinkIds].sort((first, second) => first - second),
  );
  return (
    sha256Text(evidence.assignmentProfilePayloadJson) ===
      verification.assignmentProfileSha256 &&
    sha256Text(evidence.networkSettingsPayloadJson) === verification.networkSettingsSha256 &&
    sha256Text(statePayload) === verification.networkStateSha256 &&
    sha256Text(roadwayLinkIdsPayload) === evidence.retainedNetworkManifest.roadway_link_ids_digest
  );
}

function verificationFailure() {
  return NextResponse.json(
    { error: "Agreement GeoJSON failed its registered evidence checks" },
    { status: 422 },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.agreement", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const { modelId, modelRunId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await loadModelAccess(supabase, modelId, user.id, "models.read");
  if (access.error) return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  if (!access.model) return NextResponse.json({ error: "Model not found" }, { status: 404 });
  if (!access.membership || !access.allowed) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const runResult = await supabase
    .from("model_runs")
    .select("id, status")
    .eq("id", modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();
  const runFailure = classifyRouteReadFailure("model run", runResult);
  if (runFailure) {
    audit.error("model_run_lookup_failed", { modelRunId, message: runFailure.message });
    return NextResponse.json(runFailure.body, { status: runFailure.status });
  }
  const run = runResult.data;
  if (!run) return NextResponse.json({ error: "Model run not found" }, { status: 404 });
  if (run.status !== "succeeded") {
    return NextResponse.json(
      { error: "Run has not completed yet", status: run.status },
      { status: 400 },
    );
  }

  const artifactResult = await supabase
    .from("model_run_artifacts")
    .select(
      "artifact_type, file_url, content_hash, file_size_bytes, metadata_json, stage_id",
    )
    .eq("run_id", modelRunId)
    .eq("artifact_type", "demand_model_agreement_geojson")
    .order("created_at", { ascending: false })
    .limit(1);
  const artifactFailure = classifyRouteReadFailure("agreement artifact", artifactResult);
  if (artifactFailure) {
    audit.error("agreement_artifact_lookup_failed", {
      modelRunId,
      message: artifactFailure.message,
    });
    return NextResponse.json(artifactFailure.body, { status: artifactFailure.status });
  }
  const rawRow = artifactResult.data?.[0];
  if (!rawRow) {
    return NextResponse.json(
      { error: "Agreement GeoJSON is not available for this run" },
      { status: 404 },
    );
  }
  const rowResult = artifactRowSchema.safeParse(rawRow);
  if (!rowResult.success) {
    audit.error("agreement_artifact_registration_invalid", { modelRunId });
    return verificationFailure();
  }
  const row = rowResult.data;

  const stageResult = await supabase
    .from("model_run_stages")
    .select("id, run_id, stage_name, status")
    .eq("id", row.stage_id)
    .eq("run_id", modelRunId)
    .maybeSingle();
  const stageFailure = classifyRouteReadFailure("agreement stage", stageResult);
  if (stageFailure) {
    audit.error("agreement_stage_lookup_failed", {
      modelRunId,
      stageId: row.stage_id,
      message: stageFailure.message,
    });
    return NextResponse.json(stageFailure.body, { status: stageFailure.status });
  }
  if (
    !stageResult.data ||
    stageResult.data.id !== row.stage_id ||
    stageResult.data.run_id !== modelRunId ||
    stageResult.data.stage_name !== DEMAND_MODEL_AGREEMENT_STAGE_NAME ||
    stageResult.data.status !== "succeeded"
  ) {
    audit.error("agreement_stage_custody_invalid", { modelRunId, stageId: row.stage_id });
    return verificationFailure();
  }

  let bytes: Uint8Array;
  try {
    const localRoot = workerLocalRoot();
    bytes = await loadArtifactBytes(row.file_url, {
      bucket: "run-artifacts",
      objectPathPrefix: `model-runs/${modelRunId}/`,
      localRoot: localRoot ? resolveRunWorkDir(localRoot, modelRunId) : undefined,
    });
  } catch (error) {
    audit.error("agreement_artifact_read_failed", { modelRunId, error });
    return NextResponse.json({ error: "Agreement GeoJSON could not be read" }, { status: 404 });
  }

  const artifactSha256 = sha256Bytes(bytes);
  if (bytes.byteLength !== row.file_size_bytes || artifactSha256 !== row.content_hash) {
    audit.error("agreement_artifact_bytes_unverified", {
      modelRunId,
      actualSize: bytes.byteLength,
      registeredSize: row.file_size_bytes,
      actualHash: artifactSha256,
      registeredHash: row.content_hash,
    });
    return verificationFailure();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    audit.error("agreement_artifact_json_invalid", { modelRunId, error });
    return verificationFailure();
  }

  const verification = metadataVerification(row.metadata_json, artifactSha256);
  if (!verification) {
    audit.error("agreement_artifact_custody_missing", { modelRunId });
    return verificationFailure();
  }
  const decision = parseDemandAgreementArtifact(payload, verification);
  const custody = decision.status === "render_links" ? decision : decision.custody;
  if (
    !custody ||
    !embeddedDigestsMatch(verification, custody.evidence) ||
    !artifactCustodyMatches(
      row.metadata_json,
      row.file_url,
      verification,
      custody.evidence,
    )
  ) {
    audit.error("agreement_artifact_evidence_unverified", {
      modelRunId,
      reason: decision.status === "withhold_links" ? decision.reason : "custody_mismatch",
    });
    return verificationFailure();
  }

  audit.info("agreement_artifact_read", {
    modelRunId,
    stageId: row.stage_id,
    artifactSha256,
  });
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      [AGREEMENT_VERIFICATION_HEADERS.artifact]: verification.artifactSha256,
      [AGREEMENT_VERIFICATION_HEADERS.assignmentProfile]:
        verification.assignmentProfileSha256,
      [AGREEMENT_VERIFICATION_HEADERS.networkSettings]: verification.networkSettingsSha256,
      [AGREEMENT_VERIFICATION_HEADERS.networkState]: verification.networkStateSha256,
    },
  });
}
