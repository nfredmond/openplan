import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { CORRIDOR_COLUMNS, type ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";
import { buildEvidenceDescriptor } from "@/lib/evidence/evidence-descriptor";
import {
  buildProjectGeoPackage,
  type ProjectGeoPackageCrash,
  type ProjectGeoPackageEngagementGeometry,
  type ProjectGeoPackageProject,
} from "@/lib/projects/project-geopackage";
import { ProjectEvidenceBundleError, type GeneratedProjectEvidenceFile } from "./archive";
import {
  isPublicProjectEngagementCampaign,
  isPublishableProjectEngagementGeometry,
} from "./engagement-export-privacy";

type ProjectScope = { id: string; workspace_id: string; updated_at?: string | null };

type DynamicReadResult = { data: unknown; error: { message?: string | null } | null };
type DynamicQuery = PromiseLike<DynamicReadResult> & {
  eq(column: string, value: string): DynamicQuery;
  in(column: string, values: string[]): DynamicQuery;
  order(column: string, options: { ascending: boolean }): DynamicQuery;
};

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalizeActionPayload(value)}\n`, "utf8");
}

function sourceRevision(value: unknown): string {
  return createHash("sha256").update(canonicalizeActionPayload(value)).digest("hex");
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function ids(items: Record<string, unknown>[]): string[] {
  return items.flatMap((item) => (typeof item.id === "string" ? [item.id] : []));
}

const PERSONAL_IDENTIFIER_KEYS = new Set([
  "created_by", "createdBy", "updated_by", "updatedBy", "requested_by", "requestedBy",
  "linked_by", "linkedBy", "generated_by", "generatedBy", "submitted_by", "submittedBy",
  "decided_by", "decidedBy", "frozen_by", "frozenBy", "approved_by", "approvedBy",
  "assigned_approver_id", "assignedApproverId", "assignee_user_id", "assigneeUserId",
  "user_id", "userId",
]);

/** External handoffs retain record custody without exporting internal user identifiers. */
function withoutPersonalIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPersonalIdentifiers);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PERSONAL_IDENTIFIER_KEYS.has(key))
      .map(([key, item]) => [key, withoutPersonalIdentifiers(item)]),
  );
}

async function evidenceRows(
  client: SupabaseClient,
  workspaceId: string,
  modelRunIds: string[],
  countyRunIds: string[]
): Promise<{
  sources: Record<string, unknown>[];
  validation: Record<string, unknown>[];
  claims: Record<string, unknown>[];
  assessments: Record<string, unknown>[];
  diagnoses: Record<string, unknown>[];
}> {
  if (modelRunIds.length === 0 && countyRunIds.length === 0) {
    return { sources: [], validation: [], claims: [], assessments: [], diagnoses: [] };
  }

  const tableReads = [
    {
      table: "modeling_source_manifests",
      select:
        "id, workspace_id, model_run_id, county_run_id, source_key, source_kind, source_label, source_url, source_vintage, geography_id, geography_label, checksum_sha256, license_note, citation_text, metadata_json, ingested_at, created_at, updated_at",
    },
    {
      table: "modeling_validation_results",
      select:
        "id, workspace_id, model_run_id, county_run_id, source_manifest_id, track, metric_key, metric_label, observed_value, threshold_value, threshold_max_value, threshold_comparator, status, blocks_claim_grade, detail, metadata_json, evaluated_at, created_at",
    },
    {
      table: "modeling_claim_decisions",
      select:
        "id, workspace_id, model_run_id, county_run_id, track, claim_status, status_reason, reasons_json, validation_summary_json, decided_at, created_at, updated_at",
    },
  ] as const;

  const collected: Record<string, unknown>[][] = [];
  const dynamicFrom = client.from.bind(client) as unknown as (
    table: string
  ) => { select(columns: string): DynamicQuery };
  for (const descriptor of tableReads) {
    const parts: Record<string, unknown>[] = [];
    if (modelRunIds.length > 0) {
      const read = await dynamicFrom(descriptor.table)
        .select(descriptor.select)
        .eq("workspace_id", workspaceId)
        .in("model_run_id", modelRunIds)
        .order("created_at", { ascending: true });
      if (read.error) {
        throw new ProjectEvidenceBundleError(
          "missing_evidence",
          `Project-linked modeling evidence could not be read from ${descriptor.table}.`
        );
      }
      parts.push(...rows(read.data));
    }
    if (countyRunIds.length > 0) {
      const read = await dynamicFrom(descriptor.table)
        .select(descriptor.select)
        .eq("workspace_id", workspaceId)
        .in("county_run_id", countyRunIds)
        .order("created_at", { ascending: true });
      if (read.error) {
        throw new ProjectEvidenceBundleError(
          "missing_evidence",
          `Project-linked modeling evidence could not be read from ${descriptor.table}.`
        );
      }
      parts.push(...rows(read.data));
    }
    const unique = new Map(parts.map((item) => [String(item.id), item]));
    collected.push([...unique.values()].sort((left, right) => String(left.id).localeCompare(String(right.id))));
  }

  let assessments: Record<string, unknown>[] = [];
  let diagnoses: Record<string, unknown>[] = [];
  if (modelRunIds.length > 0) {
    const read = await dynamicFrom("modeling_validation_assessments")
      .select(
        "id, workspace_id, model_run_id, track, model_output_artifact_id, validation_input_bundle_artifact_id, comparison_basis_artifact_id, model_validation_assessment_artifact_id, comparison_basis_sha256, validation_rules_version, partition_json, planning_use, scientific_outcome, reasons_json, created_at"
      )
      .eq("workspace_id", workspaceId)
      .in("model_run_id", modelRunIds)
      .order("created_at", { ascending: true });
    if (read.error) {
      throw new ProjectEvidenceBundleError(
        "missing_evidence",
        "Project-linked scientific validation assessments could not be read."
      );
    }
    assessments = rows(read.data);

    const diagnosisRead = await dynamicFrom("modeling_validation_structural_diagnoses")
      .select(
        "id, workspace_id, model_run_id, modeling_validation_assessment_id, diagnosis_artifact_id, assessment_sha256, diagnosis_sha256, scientific_outcome, created_at"
      )
      .eq("workspace_id", workspaceId)
      .in("model_run_id", modelRunIds)
      .order("created_at", { ascending: true });
    if (diagnosisRead.error) {
      throw new ProjectEvidenceBundleError(
        "missing_evidence",
        "Project-linked structural diagnoses could not be read."
      );
    }
    diagnoses = rows(diagnosisRead.data);
  }

  return { sources: collected[0], validation: collected[1], claims: collected[2], assessments, diagnoses };
}

/**
 * Freeze the project record, current GeoPackage, linked dataset provenance,
 * and all model/county-run evidence attached to this project. Any read failure
 * aborts the bundle. An empty successful read remains an explicit empty array.
 */
export async function loadProjectEvidenceGeneratedFiles(
  supabaseValue: unknown,
  project: ProjectScope,
  generatedAt: Date,
  selectedPlan?: Record<string, unknown> | null,
): Promise<{ files: GeneratedProjectEvidenceFile[]; projectRecord: Record<string, unknown> }> {
  const client = supabaseValue as SupabaseClient;
  const [projectRead, corridorRead, datasetRead, modelRead, countyRunRead, crashIngestRead, campaignRead] = await Promise.all([
    client
      .from("projects")
      .select("*")
      .eq("id", project.id)
      .eq("workspace_id", project.workspace_id)
      .maybeSingle(),
    client
      .from("project_corridors")
      .select(CORRIDOR_COLUMNS)
      .eq("project_id", project.id)
      .eq("workspace_id", project.workspace_id)
      .order("created_at", { ascending: true }),
    client
      .from("data_dataset_project_links")
      .select(
        "dataset_id, project_id, relationship_type, linked_by, linked_at, data_datasets!inner(id, workspace_id, connector_id, name, status, geography_scope, coverage_summary, vintage_label, source_url, license_label, citation_text, schema_version, checksum, row_count, refresh_cadence, last_refreshed_at, notes, created_at, updated_at)"
      )
      .eq("project_id", project.id)
      .eq("data_datasets.workspace_id", project.workspace_id)
      .order("linked_at", { ascending: true }),
    client
      .from("models")
      .select(
        "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at, created_at, updated_at"
      )
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .order("created_at", { ascending: true }),
    client
      .from("county_runs")
      .select(
        "id, workspace_id, project_id, geography_type, geography_id, geography_label, run_name, stage, status_label, mode, requested_runtime_json, manifest_json, run_summary_json, validation_summary_json, created_at, updated_at, worker_started_at, worker_completed_at"
      )
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .order("created_at", { ascending: true }),
    client.from("safety_crash_ingests")
      .select("id")
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .eq("status", "ready")
      .order("created_at", { ascending: true }),
    client.from("engagement_campaigns")
      .select("id, status, share_token, allow_public_submissions, submissions_closed_at, updated_at")
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .order("created_at", { ascending: true }),
  ]);

  if (projectRead.error || !projectRead.data) {
    throw new ProjectEvidenceBundleError("stale_review", "The project changed or disappeared after review.");
  }
  if (projectRead.data.updated_at !== project.updated_at) {
    throw new ProjectEvidenceBundleError("stale_review", "The project changed after the evidence review opened.");
  }
  const requiredReads = [
    ["project corridors", corridorRead.error],
    ["linked dataset provenance", datasetRead.error],
    ["project models", modelRead.error],
    ["project county runs", countyRunRead.error],
    ["project crash acquisitions", crashIngestRead.error],
    ["project engagement campaigns", campaignRead.error],
  ] as const;
  const failed = requiredReads.find(([, error]) => error);
  if (failed) {
    throw new ProjectEvidenceBundleError("missing_evidence", `${failed[0]} could not be read.`);
  }

  const models = rows(modelRead.data);
  const modelIds = ids(models);
  let modelRuns: Record<string, unknown>[] = [];
  let modelArtifacts: Record<string, unknown>[] = [];
  if (modelIds.length > 0) {
    const modelRunsRead = await client
      .from("model_runs")
      .select(
        "id, workspace_id, model_id, project_id, scenario_set_id, scenario_entry_id, source_analysis_run_id, engine_key, launch_source, run_title, query_text, status, input_snapshot_json, assumption_snapshot_json, result_summary_json, error_message, started_at, completed_at, created_at, updated_at"
      )
      .eq("workspace_id", project.workspace_id)
      .in("model_id", modelIds)
      .order("created_at", { ascending: true });
    if (modelRunsRead.error) {
      throw new ProjectEvidenceBundleError("missing_evidence", "Project-linked model runs could not be read.");
    }
    modelRuns = rows(modelRunsRead.data);
    const runIds = ids(modelRuns);
    if (runIds.length > 0) {
      const artifactsRead = await client.from("model_run_artifacts")
        .select("id, run_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json, created_at")
        .in("run_id", runIds)
        .in("artifact_type", [
          "link_volumes",
          "activitysim_link_volumes",
          "validation_input_bundle",
          "comparison_basis",
          "model_validation_assessment",
          "model_validation_structural_diagnosis",
        ])
        .order("created_at", { ascending: true });
      if (artifactsRead.error) {
        throw new ProjectEvidenceBundleError("missing_evidence", "Project model link artifacts could not be read.");
      }
      modelArtifacts = rows(artifactsRead.data);
    }
  }
  const countyRuns = rows(countyRunRead.data);
  const modelingEvidence = await evidenceRows(client, project.workspace_id, ids(modelRuns), ids(countyRuns));
  const crashIngestIds = ids(rows(crashIngestRead.data));
  let crashes: ProjectGeoPackageCrash[] = [];
  if (crashIngestIds.length > 0) {
    const crashRead = await client.from("safety_crashes")
      .select("id, longitude, latitude, severity, source_id, collision_date")
      .eq("workspace_id", project.workspace_id)
      .in("ingest_id", crashIngestIds)
      .in("severity", ["fatal", "severe_injury"])
      .order("collision_date", { ascending: true });
    if (crashRead.error) throw new ProjectEvidenceBundleError("missing_evidence", "Project crash/KSI geometry could not be read.");
    crashes = rows(crashRead.data).flatMap((row) =>
      typeof row.longitude === "number" && typeof row.latitude === "number"
        ? [{
            id: String(row.id),
            longitude: row.longitude,
            latitude: row.latitude,
            severity: String(row.severity),
            sourceId: String(row.source_id),
            collisionDate: typeof row.collision_date === "string" ? row.collision_date : null,
          }]
        : [],
    );
  }
  const campaignIds = ids(rows(campaignRead.data).filter(isPublicProjectEngagementCampaign));
  let engagementGeometries: ProjectGeoPackageEngagementGeometry[] = [];
  if (campaignIds.length > 0) {
    const engagementRead = await client.from("engagement_items")
      .select("id, campaign_id, category_id, title, body, submitted_by, status, source_type, metadata_json, moderation_notes, geometry, longitude, latitude, created_at, updated_at")
      .in("campaign_id", campaignIds)
      .eq("status", "approved")
      .order("created_at", { ascending: true });
    if (engagementRead.error) throw new ProjectEvidenceBundleError("missing_evidence", "Publishable engagement geometry could not be read.");
    engagementGeometries = rows(engagementRead.data)
      .filter(isPublishableProjectEngagementGeometry)
      .map((row) => ({
        id: String(row.id),
        geometry: row.geometry,
        longitude: typeof row.longitude === "number" ? row.longitude : null,
        latitude: typeof row.latitude === "number" ? row.latitude : null,
        sourceType: typeof row.source_type === "string" ? row.source_type : "unknown",
        createdAt: typeof row.created_at === "string" ? row.created_at : generatedAt.toISOString(),
      }));
  }

  const projectRecord = withoutPersonalIdentifiers(projectRead.data) as Record<string, unknown>;
  const gpkg = buildProjectGeoPackage({
    project: projectRecord as unknown as ProjectGeoPackageProject,
    corridors: (corridorRead.data ?? []) as ProjectCorridorRow[],
    generatedAt,
    crashes,
    engagementGeometries,
  });
  const linkedData = {
    schemaVersion: "project_linked_data_provenance.v1",
    projectId: project.id,
    generatedAt: generatedAt.toISOString(),
    links: withoutPersonalIdentifiers(rows(datasetRead.data)),
  };
  const claimsByTarget = new Map(
    modelingEvidence.claims.map((claim) => [
      `${String(claim.model_run_id ?? "")}:${String(claim.county_run_id ?? "")}:${String(claim.track ?? "")}`,
      claim,
    ]),
  );
  const claimDecisions = modelingEvidence.claims.map((claim) => ({
    ...withoutPersonalIdentifiers(claim) as Record<string, unknown>,
    evidenceDescriptor: buildEvidenceDescriptor({
      identity: { table: "modeling_claim_decisions", id: claim.id },
      source: {
        kind: "modeling_claim_decision",
        label: `Modeling claim decision: ${String(claim.track ?? "unknown track")}`,
        citation: typeof claim.status_reason === "string" ? claim.status_reason : null,
      },
      asOfDate: typeof claim.decided_at === "string" ? claim.decided_at : null,
      retrievedAt: generatedAt.toISOString(),
      evidenceStatus: "modeled",
      claimTier: typeof claim.claim_status === "string" ? claim.claim_status : null,
      uncertainty: Array.isArray(claim.reasons_json) ? claim.reasons_json.map(String) : [],
      limits: ["The recorded tier applies only to this exact run and track."],
      revisionToken: typeof claim.updated_at === "string" ? claim.updated_at : typeof claim.decided_at === "string" ? claim.decided_at : null,
      checksumSha256: null,
      numericClaim: true,
    }),
  }));
  const validationResults = modelingEvidence.validation.map((validation) => {
    const claim = claimsByTarget.get(
      `${String(validation.model_run_id ?? "")}:${String(validation.county_run_id ?? "")}:${String(validation.track ?? "")}`,
    );
    return {
      ...withoutPersonalIdentifiers(validation) as Record<string, unknown>,
      evidenceDescriptor: buildEvidenceDescriptor({
        identity: { table: "modeling_validation_results", id: validation.id },
        source: {
          kind: "modeling_validation_result",
          label: typeof validation.metric_label === "string" ? validation.metric_label : "Modeling validation result",
          citation: typeof validation.source_manifest_id === "string" ? validation.source_manifest_id : null,
        },
        asOfDate: typeof validation.evaluated_at === "string" ? validation.evaluated_at : null,
        retrievedAt: generatedAt.toISOString(),
        evidenceStatus: "modeled",
        claimTier: typeof claim?.claim_status === "string" ? claim.claim_status : null,
        uncertainty: [],
        limits: typeof validation.detail === "string" ? [validation.detail] : [],
        revisionToken: typeof validation.created_at === "string" ? validation.created_at : null,
        checksumSha256: null,
        numericClaim: true,
      }),
    };
  });
  const validationAssessments = modelingEvidence.assessments.map((assessment) => ({
    ...withoutPersonalIdentifiers(assessment) as Record<string, unknown>,
    evidenceDescriptor: buildEvidenceDescriptor({
      identity: { table: "modeling_validation_assessments", id: assessment.id },
      source: {
        kind: "model_validation_assessment",
        label: `Scientific model validation: ${String(assessment.scientific_outcome ?? "inconclusive")}`,
        citation: typeof assessment.comparison_basis_sha256 === "string"
          ? assessment.comparison_basis_sha256
          : null,
      },
      asOfDate: typeof assessment.created_at === "string" ? assessment.created_at : null,
      retrievedAt: generatedAt.toISOString(),
      evidenceStatus: "modeled",
      claimTier: null,
      uncertainty: Array.isArray(assessment.reasons_json) ? assessment.reasons_json.map(String) : [],
      limits: ["The outcome applies only to the exact bound run, artifacts, planning use, and partition."],
      revisionToken: typeof assessment.created_at === "string" ? assessment.created_at : null,
      checksumSha256: typeof assessment.comparison_basis_sha256 === "string"
        ? assessment.comparison_basis_sha256
        : null,
      numericClaim: true,
    }),
  }));
  const structuralDiagnoses = modelingEvidence.diagnoses.map((diagnosis) => ({
    ...withoutPersonalIdentifiers(diagnosis) as Record<string, unknown>,
    evidenceDescriptor: buildEvidenceDescriptor({
      identity: { table: "modeling_validation_structural_diagnoses", id: diagnosis.id },
      source: {
        kind: "model_validation_structural_diagnosis",
        label: "Why the scientific model validation is inconclusive",
        citation: typeof diagnosis.diagnosis_sha256 === "string" ? diagnosis.diagnosis_sha256 : null,
      },
      asOfDate: typeof diagnosis.created_at === "string" ? diagnosis.created_at : null,
      retrievedAt: generatedAt.toISOString(),
      evidenceStatus: "modeled",
      claimTier: null,
      uncertainty: [],
      limits: [
        "The diagnosis explains the bound inconclusive assessment; it does not repair matches, calibrate a model, select a method, or change the outcome.",
      ],
      revisionToken: typeof diagnosis.created_at === "string" ? diagnosis.created_at : null,
      checksumSha256: typeof diagnosis.diagnosis_sha256 === "string" ? diagnosis.diagnosis_sha256 : null,
      numericClaim: true,
    }),
  }));
  const modeling = {
    schemaVersion: "project_modeling_evidence.v3",
    projectId: project.id,
    generatedAt: generatedAt.toISOString(),
    models: withoutPersonalIdentifiers(models),
    modelRuns: withoutPersonalIdentifiers(modelRuns),
    modelArtifacts: withoutPersonalIdentifiers(modelArtifacts),
    countyRuns: withoutPersonalIdentifiers(countyRuns),
    sourceManifests: withoutPersonalIdentifiers(modelingEvidence.sources),
    validationResults,
    validationAssessments,
    structuralDiagnoses,
    claimDecisions,
  };
  const modelingRevisionToken = sourceRevision({
    models: withoutPersonalIdentifiers(models),
    modelRuns: withoutPersonalIdentifiers(modelRuns),
    modelArtifacts: withoutPersonalIdentifiers(modelArtifacts),
    countyRuns: withoutPersonalIdentifiers(countyRuns),
    sourceManifests: withoutPersonalIdentifiers(modelingEvidence.sources),
    validationResults: withoutPersonalIdentifiers(modelingEvidence.validation),
    validationAssessments: withoutPersonalIdentifiers(modelingEvidence.assessments),
    structuralDiagnoses: withoutPersonalIdentifiers(modelingEvidence.diagnoses),
    claimDecisions: withoutPersonalIdentifiers(modelingEvidence.claims),
  });
  const hasUnsupportedModelingClaim = [...claimDecisions, ...validationResults]
    .some((record) => record.evidenceDescriptor.support.status === "unsupported");
  const hasNumericModelingClaim = claimDecisions.length > 0 || validationResults.length > 0;
  const projectRevisionToken = sourceRevision(projectRecord);
  const geoPackageRevisionToken = sourceRevision({
    project: projectRecord,
    corridors: corridorRead.data ?? [],
    crashes,
    engagementGeometries,
  });
  const linkedDataRevisionToken = sourceRevision(linkedData.links);
  const linkedPlanRevisionToken = selectedPlan
    ? sourceRevision(withoutPersonalIdentifiers(selectedPlan))
    : null;

  return {
    projectRecord,
    files: [
      {
        path: "project/project.json",
        recordId: project.id,
        title: "Project record",
        sourceId: "project_record",
        owningModule: "projects",
        bytes: jsonBytes(projectRecord),
        contentType: "application/json",
        retrievalState: "available",
        custodyState: "openplan_stored",
        knownLimits: [],
        revisionToken: projectRevisionToken,
      },
      {
        path: "project/project.gpkg",
        recordId: project.id,
        title: "Project GeoPackage",
        sourceId: "project_geopackage",
        owningModule: "projects",
        bytes: gpkg.bytes,
        contentType: "application/geopackage+sqlite3",
        retrievalState: "rendered_on_freeze",
        custodyState: "rendered_on_freeze",
        knownLimits: gpkg.summary.coverageLimits,
        revisionToken: geoPackageRevisionToken,
      },
      ...(selectedPlan ? [{
        path: "project/linked-plan.json",
        recordId: String(selectedPlan.id),
        title: "Selected linked plan record",
        sourceId: "linked_data" as const,
        owningModule: "plans",
        bytes: jsonBytes(withoutPersonalIdentifiers(selectedPlan)),
        contentType: "application/json",
        retrievalState: "available" as const,
        custodyState: "openplan_stored" as const,
        knownLimits: ["This is the selected OpenPlan plan record, not an adopted-plan PDF."],
        revisionToken: linkedPlanRevisionToken as string,
      }] : []),
      {
        path: "linked-data/provenance.json",
        recordId: project.id,
        title: "Linked data provenance",
        sourceId: "linked_data",
        owningModule: "data_hub",
        bytes: jsonBytes(linkedData),
        contentType: "application/json",
        retrievalState: "available",
        custodyState: "openplan_stored",
        knownLimits: [],
        revisionToken: linkedDataRevisionToken,
      },
      {
        path: "modeling/evidence.json",
        recordId: project.id,
        title: "Project-linked modeling evidence",
        sourceId: "modeling_evidence",
        owningModule: "travel_modeling",
        bytes: jsonBytes(modeling),
        contentType: "application/json",
        retrievalState: "available",
        custodyState: "openplan_stored",
        revisionToken: modelingRevisionToken,
        knownLimits: [
          "Claim tiers remain attached to their original decisions. This bundle does not promote or reconcile them.",
          "AequilibraE and ActivitySim evidence remains separate and is never averaged.",
        ],
        evidenceDescriptor: buildEvidenceDescriptor({
          identity: { projectId: project.id, recordId: project.id, revisionToken: modelingRevisionToken },
          source: { kind: "project_modeling_evidence", label: "Project-linked modeling evidence", citation: null },
          asOfDate: generatedAt.toISOString(),
          retrievedAt: generatedAt.toISOString(),
          evidenceStatus: "modeled",
          claimTier: !hasNumericModelingClaim || hasUnsupportedModelingClaim ? null : "per_claim_in_payload",
          uncertainty: [],
          limits: [
            "Each validation result and claim decision carries its own descriptor and exact run/track scope.",
            "AequilibraE and ActivitySim evidence remains separate and is never averaged.",
          ],
          revisionToken: modelingRevisionToken,
          checksumSha256: null,
          numericClaim: hasNumericModelingClaim,
        }),
      },
    ],
  };
}
