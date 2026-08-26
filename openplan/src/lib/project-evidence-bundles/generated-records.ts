import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { CORRIDOR_COLUMNS, type ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";
import {
  buildProjectGeoPackage,
  type ProjectGeoPackageProject,
} from "@/lib/projects/project-geopackage";
import { ProjectEvidenceBundleError, type GeneratedProjectEvidenceFile } from "./archive";

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

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function ids(items: Record<string, unknown>[]): string[] {
  return items.flatMap((item) => (typeof item.id === "string" ? [item.id] : []));
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
}> {
  if (modelRunIds.length === 0 && countyRunIds.length === 0) {
    return { sources: [], validation: [], claims: [] };
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

  return { sources: collected[0], validation: collected[1], claims: collected[2] };
}

/**
 * Freeze the project record, current GeoPackage, linked dataset provenance,
 * and all model/county-run evidence attached to this project. Any read failure
 * aborts the bundle. An empty successful read remains an explicit empty array.
 */
export async function loadProjectEvidenceGeneratedFiles(
  supabaseValue: unknown,
  project: ProjectScope,
  generatedAt: Date
): Promise<{ files: GeneratedProjectEvidenceFile[]; projectRecord: Record<string, unknown> }> {
  const client = supabaseValue as SupabaseClient;
  const [projectRead, corridorRead, datasetRead, modelRead, countyRunRead] = await Promise.all([
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
  ] as const;
  const failed = requiredReads.find(([, error]) => error);
  if (failed) {
    throw new ProjectEvidenceBundleError("missing_evidence", `${failed[0]} could not be read.`);
  }

  const models = rows(modelRead.data);
  const modelIds = ids(models);
  let modelRuns: Record<string, unknown>[] = [];
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
  }
  const countyRuns = rows(countyRunRead.data);
  const modelingEvidence = await evidenceRows(client, project.workspace_id, ids(modelRuns), ids(countyRuns));

  const projectRecord = projectRead.data as Record<string, unknown>;
  const gpkg = buildProjectGeoPackage({
    project: projectRecord as unknown as ProjectGeoPackageProject,
    corridors: (corridorRead.data ?? []) as ProjectCorridorRow[],
    generatedAt,
  });
  const linkedData = {
    schemaVersion: "project_linked_data_provenance.v1",
    projectId: project.id,
    generatedAt: generatedAt.toISOString(),
    links: rows(datasetRead.data),
  };
  const modeling = {
    schemaVersion: "project_modeling_evidence.v1",
    projectId: project.id,
    generatedAt: generatedAt.toISOString(),
    models,
    modelRuns,
    countyRuns,
    sourceManifests: modelingEvidence.sources,
    validationResults: modelingEvidence.validation,
    claimDecisions: modelingEvidence.claims,
  };

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
      },
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
        knownLimits: [
          "Claim tiers remain attached to their original decisions. This bundle does not promote or reconcile them.",
          "AequilibraE and ActivitySim evidence remains separate and is never averaged.",
        ],
      },
    ],
  };
}
