import { createServiceRoleClient, type createClient } from "@/lib/supabase/server";
import { WORKSPACE_GIS_BBOX_DRAW_LIMIT } from "@/lib/workspace-gis/coverage";

type Bbox = [number, number, number, number];
type FrozenDesignation = {
  id?: string;
  layer_version_id?: string;
  designation_set_label?: string;
  public_field_keys?: unknown;
  legend_field?: string | null;
  layer_version_evidence?: { feature_hash?: string; bbox?: unknown } | null;
};

type BboxRow = {
  id: string | null;
  feature_index: number | null;
  geometry_geojson: unknown;
  properties: unknown;
  matched_count: number | string | null;
};

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

export function pickPublicAttributes(source: Record<string, unknown>, publicFields: readonly string[]) {
  return Object.fromEntries(publicFields.filter((field) => field in source).map((field) => [field, source[field]]));
}

export function publicMapIsTooDense(matchedCount: number, drawLimit = WORKSPACE_GIS_BBOX_DRAW_LIMIT) {
  return matchedCount > drawLimit;
}

export async function loadPublicDesignationMap(
  frozenSnapshot: Record<string, unknown>,
  designationId: string,
  bbox: Bbox,
  scope?: { client: Awaited<ReturnType<typeof createClient>>; workspaceId: string },
) {
  const designation = (records(frozenSnapshot.designations) as FrozenDesignation[])
    .find((candidate) => candidate.id === designationId);
  const versionId = designation?.layer_version_id;
  const expectedFeatureHash = designation?.layer_version_evidence?.feature_hash;
  if (!designation) return { ok: false as const, reason: "not_found" as const };
  if (!versionId || !expectedFeatureHash) return { ok: false as const, reason: "incomplete" as const };
  const publicFields = Array.isArray(designation.public_field_keys)
    ? designation.public_field_keys.filter((field): field is string => typeof field === "string")
    : [];

  const service = scope?.client ?? createServiceRoleClient();
  let query = service.from("workspace_gis_layer_versions")
    .select("id, workspace_id, feature_hash, ingest_status").eq("id", versionId).eq("ingest_status", "ready");
  if (scope) query = query.eq("workspace_id", scope.workspaceId);
  const versionResult = await query.maybeSingle();
  if (versionResult.error) return { ok: false as const, reason: "read_failure" as const };
  if (!versionResult.data || versionResult.data.id !== versionId || versionResult.data.ingest_status !== "ready"
    || versionResult.data.feature_hash !== expectedFeatureHash || (scope && versionResult.data.workspace_id !== scope.workspaceId)) {
    return { ok: false as const, reason: "incomplete" as const };
  }
  const { data, error } = await service.rpc("workspace_gis_features_in_bbox", {
    p_version_id: versionId,
    p_west: bbox[0], p_south: bbox[1], p_east: bbox[2], p_north: bbox[3],
    p_limit: WORKSPACE_GIS_BBOX_DRAW_LIMIT,
  });
  if (error) return { ok: false as const, reason: "read_failure" as const };
  const rows = (data ?? []) as BboxRow[];
  // The RPC returns a count row even for an empty view. Missing or inconsistent
  // counts cannot establish that no features intersect the requested geography.
  const rawCount = rows[0]?.matched_count;
  const matchedCount = typeof rawCount === "number" ? rawCount
    : typeof rawCount === "string" && /^\d+$/.test(rawCount) ? Number(rawCount) : Number.NaN;
  if (!Number.isSafeInteger(matchedCount) || matchedCount < 0
    || rows.some(row => String(row.matched_count) !== String(rawCount))) {
    return { ok: false as const, reason: "incomplete" as const };
  }
  const tooDenseToDraw = publicMapIsTooDense(matchedCount);
  const features = tooDenseToDraw ? [] : rows.flatMap((row) => {
    if (!row.id || !row.geometry_geojson || typeof row.geometry_geojson !== "object") return [];
    const source = row.properties && typeof row.properties === "object" ? row.properties as Record<string, unknown> : {};
    const attributes = pickPublicAttributes(source, publicFields);
    return [{ type: "Feature" as const, id: row.id, geometry: row.geometry_geojson, properties: { featureIndex: row.feature_index ?? 0, attributes } }];
  });
  if (!tooDenseToDraw && features.length !== matchedCount) return { ok: false as const, reason: "incomplete" as const };
  return {
    ok: true as const,
    payload: {
      type: "FeatureCollection" as const,
      features,
      matchedCount,
      returnedCount: features.length,
      tooDenseToDraw,
      limit: WORKSPACE_GIS_BBOX_DRAW_LIMIT,
      designationLabel: designation.designation_set_label ?? "Mapped designations",
      legendField: designation.legend_field ?? null,
      coverageNotes: tooDenseToDraw
        ? [`${matchedCount.toLocaleString("en-US")} features intersect this view. Nothing is drawn until you zoom in; OpenPlan never shows a misleading subset.`]
        : [],
    },
  };
}
