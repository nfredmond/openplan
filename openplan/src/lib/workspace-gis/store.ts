/**
 * Reading the workspace-GIS tables, and turning their rows into the contract in
 * `types.ts`.
 *
 * WHY THE PROJECTIONS ARE CONSTANTS. Supabase clients in this repository are
 * intentionally untyped, so a `.select()` string is not checked by anything at
 * build time — a column typo surfaces at runtime as a missing field, and a
 * missing field in THIS lane means a caveat that silently stops rendering.
 * Naming each projection once, here, is what lets a test assert the string
 * itself (`public-engagement-page.test.tsx` precedent: a mocked Supabase client
 * cannot catch a missing projection, so the projection is what you assert).
 *
 * PURE MAPPERS, I/O AT THE EDGES. `mapVersionRow`/`mapLayerRow` take a plain
 * object and are exercised directly by tests; the query helpers below are thin
 * enough to read at a glance.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  WorkspaceGisAttributeField,
  WorkspaceGisBbox,
  WorkspaceGisIngestFailureReason,
  WorkspaceGisIngestStatus,
  WorkspaceGisLayer,
  WorkspaceGisLayerReference,
  WorkspaceGisReferenceKind,
  WorkspaceGisReprojectionEngine,
  WorkspaceGisSourceFormat,
  WorkspaceGisSrsBasis,
  WorkspaceGisVersion,
} from "./types";

export const WORKSPACE_GIS_LAYERS_TABLE = "workspace_gis_layers";
export const WORKSPACE_GIS_VERSIONS_TABLE = "workspace_gis_layer_versions";
export const WORKSPACE_GIS_FEATURES_TABLE = "workspace_gis_features";
export const WORKSPACE_GIS_REFERENCES_TABLE = "workspace_gis_layer_references";

/**
 * Every column a VERSION contributes to the contract.
 *
 * `storage_path` is deliberately absent: nothing outside the download route
 * needs it, and a path that never enters a response cannot be echoed into one.
 * `storage_bucket` is selected only to answer "are the original bytes held?"
 * — the value itself goes nowhere.
 */
export const WORKSPACE_GIS_VERSION_COLUMNS = [
  "id",
  "layer_id",
  "version_number",
  "source_format",
  "source_filename",
  "source_byte_size",
  "storage_bucket",
  "srs_authority",
  "srs_code",
  "srs_name",
  "srs_basis",
  "srs_asserted_by",
  "srs_asserted_at",
  "reprojection_engine",
  "datum_shift_note",
  "datum_acknowledged_by",
  "geometry_kinds",
  "attribute_fields",
  "attribute_encoding",
  "attribute_encoding_is_fallback",
  "declared_feature_count",
  "feature_count",
  "source_feature_count",
  "dropped_feature_count",
  "truncated",
  "bbox",
  "ingest_status",
  "ingest_failure_reason",
  "created_at",
  "finalized_at",
].join(", ");

export const WORKSPACE_GIS_LAYER_COLUMNS = [
  "id",
  "workspace_id",
  "project_id",
  "name",
  "description",
  "display_color",
  "display_opacity",
  "display_line_width",
  "label_field",
  "default_visible",
  "sort_order",
  "current_version_id",
  "archived_at",
  "created_at",
].join(", ");

/**
 * A layer WITH the version it draws, in one round trip.
 *
 * The embed is on the FK `current_version_id`, not on the child collection, so
 * a layer whose ingest never finished comes back with a null version rather
 * than with its unfinished upload attached — which is exactly what a map should
 * draw for it: nothing.
 */
export const WORKSPACE_GIS_LAYER_WITH_VERSION_COLUMNS =
  `${WORKSPACE_GIS_LAYER_COLUMNS}, current_version:${WORKSPACE_GIS_VERSIONS_TABLE}!workspace_gis_layers_current_version_fk(${WORKSPACE_GIS_VERSION_COLUMNS})`;

type Row = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * The attribute schema, defensively.
 *
 * It is JSONB written by an earlier upload, so a row from a previous build can
 * hold a shape this build does not expect. Anything unrecognised is DROPPED
 * rather than coerced: a field list with a garbage entry in it would offer a
 * planner a label field that does not exist.
 */
export function parseAttributeFields(value: unknown): WorkspaceGisAttributeField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Row;
    const name = asString(record.name);
    if (!name) return [];
    return [{ name, type: asString(record.type) ?? "unknown" }];
  });
}

/** [w, s, e, n], or null when the stored value is not a usable bbox. */
export function parseBbox(value: unknown): WorkspaceGisBbox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map((entry) => (typeof entry === "number" ? entry : Number.NaN));
  if (!numbers.every((entry) => Number.isFinite(entry))) return null;
  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

export function mapVersionRow(row: Row): WorkspaceGisVersion {
  return {
    id: String(row.id),
    layerId: String(row.layer_id),
    versionNumber: asNumber(row.version_number),
    sourceFormat: (asString(row.source_format) ?? "geojson") as WorkspaceGisSourceFormat,
    sourceFilename: asString(row.source_filename) ?? "(unnamed file)",
    sourceByteSize: asNumber(row.source_byte_size),
    // The path is never selected; the bucket answers "are the bytes held?".
    hasStoredSource: asString(row.storage_bucket) !== null,
    srs: {
      authority: asString(row.srs_authority),
      code: asString(row.srs_code),
      name: asString(row.srs_name) ?? "(unrecorded)",
      basis: (asString(row.srs_basis) ?? "prj_file") as WorkspaceGisSrsBasis,
      assertedBy: asString(row.srs_asserted_by),
      assertedAt: asString(row.srs_asserted_at),
    },
    reprojectionEngine: (asString(row.reprojection_engine) ??
      "none") as WorkspaceGisReprojectionEngine,
    datumShiftNote: asString(row.datum_shift_note),
    datumAcknowledgedBy: asString(row.datum_acknowledged_by),
    geometryKinds: asStringArray(row.geometry_kinds),
    attributeFields: parseAttributeFields(row.attribute_fields),
    attributeEncoding: asString(row.attribute_encoding),
    attributeEncodingIsFallback: asBoolean(row.attribute_encoding_is_fallback),
    declaredFeatureCount: asNumber(row.declared_feature_count),
    featureCount: asNumber(row.feature_count),
    sourceFeatureCount: asNumber(row.source_feature_count),
    droppedFeatureCount: asNumber(row.dropped_feature_count),
    truncated: asBoolean(row.truncated),
    bbox: parseBbox(row.bbox),
    ingestStatus: (asString(row.ingest_status) ?? "receiving") as WorkspaceGisIngestStatus,
    ingestFailureReason: asString(
      row.ingest_failure_reason
    ) as WorkspaceGisIngestFailureReason | null,
    createdAt: asString(row.created_at) ?? "",
    finalizedAt: asString(row.finalized_at),
  };
}

/**
 * A to-one PostgREST embed arrives as an object, but supabase-js types it
 * loosely and an ambiguous relationship can yield an array. Same normalization
 * as the Document Library's, for the same reason.
 */
function embedded(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  if (value && typeof value === "object") return value as Row;
  return null;
}

export function mapLayerRow(row: Row): WorkspaceGisLayer {
  const versionRow = embedded(row.current_version);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: asString(row.project_id),
    name: asString(row.name) ?? "(unnamed layer)",
    description: asString(row.description),
    style: {
      color: asString(row.display_color) ?? "#94a3b8",
      opacity: asNumber(row.display_opacity),
      lineWidth: asNumber(row.display_line_width),
      labelField: asString(row.label_field),
    },
    defaultVisible: asBoolean(row.default_visible),
    sortOrder: asNumber(row.sort_order),
    archivedAt: asString(row.archived_at),
    createdAt: asString(row.created_at) ?? "",
    currentVersion: versionRow ? mapVersionRow(versionRow) : null,
  };
}

export function mapReferenceRow(row: Row): WorkspaceGisLayerReference {
  const kind = (asString(row.reference_kind) ?? "project") as WorkspaceGisReferenceKind;
  const referenceId = String(row.reference_id);
  return {
    id: String(row.id),
    kind,
    referenceId,
    label: asString(row.reference_label) ?? "(unnamed)",
    href: referenceHref(kind, referenceId),
    createdAt: asString(row.created_at) ?? "",
  };
}

/**
 * Where a reference points in the product, so the delete dialog is actionable
 * rather than merely discouraging. A kind with no route yields null and the
 * dialog names it without a link.
 */
export function referenceHref(kind: WorkspaceGisReferenceKind, id: string): string | null {
  switch (kind) {
    case "engagement_campaign":
      return `/engagement/${id}`;
    case "report":
      return `/reports/${id}`;
    case "project":
      return `/projects/${id}`;
    default:
      return null;
  }
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** Live layers of a workspace with the version each one draws, in panel order. */
export async function listWorkspaceGisLayers(
  supabase: SupabaseClient,
  params: { workspaceId: string; includeArchived?: boolean }
): Promise<{ layers: WorkspaceGisLayer[]; error: string | null }> {
  let query = supabase
    .from("workspace_gis_layers")
    .select(WORKSPACE_GIS_LAYER_WITH_VERSION_COLUMNS)
    .eq("workspace_id", params.workspaceId);

  if (!params.includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return { layers: [], error: error.message };
  return { layers: (data ?? []).map((row) => mapLayerRow(row as unknown as Row)), error: null };
}

/** One layer with its drawn version, scoped by the caller's RLS. */
export async function loadWorkspaceGisLayer(
  supabase: SupabaseClient,
  layerId: string
): Promise<{ layer: WorkspaceGisLayer | null; error: string | null }> {
  const { data, error } = await supabase
    .from("workspace_gis_layers")
    .select(WORKSPACE_GIS_LAYER_WITH_VERSION_COLUMNS)
    .eq("id", layerId)
    .maybeSingle();

  if (error) return { layer: null, error: error.message };
  if (!data) return { layer: null, error: null };
  return { layer: mapLayerRow(data as unknown as Row), error: null };
}

/** Every upload of one layer, newest first. */
export async function listWorkspaceGisVersions(
  supabase: SupabaseClient,
  layerId: string
): Promise<{ versions: WorkspaceGisVersion[]; error: string | null }> {
  const { data, error } = await supabase
    .from("workspace_gis_layer_versions")
    .select(WORKSPACE_GIS_VERSION_COLUMNS)
    .eq("layer_id", layerId)
    .order("version_number", { ascending: false });

  if (error) return { versions: [], error: error.message };
  return { versions: (data ?? []).map((row) => mapVersionRow(row as unknown as Row)), error: null };
}

/** What has adopted this layer. Empty means deleting it breaks nothing. */
export async function listWorkspaceGisLayerReferences(
  supabase: SupabaseClient,
  layerId: string
): Promise<{ references: WorkspaceGisLayerReference[]; error: string | null }> {
  const { data, error } = await supabase
    .from("workspace_gis_layer_references")
    .select("id, reference_kind, reference_id, reference_label, created_at")
    .eq("layer_id", layerId)
    .order("created_at", { ascending: true });

  if (error) return { references: [], error: error.message };
  return { references: (data ?? []).map((row) => mapReferenceRow(row as Row)), error: null };
}
