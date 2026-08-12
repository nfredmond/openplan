/**
 * The viewport read for one workspace GIS layer.
 *
 * THE FIRST MAP-FEATURES ROUTE THAT TAKES A BBOX, and deliberately so. The nine
 * older layers are workspace-scale records — projects, corridors, RTP cycles —
 * where five hundred is a real cap and a whole-workspace fetch is the right
 * shape. A parcel fabric is not that. Asking for "everything" here is asking
 * for a quarter of a million polygons, so this layer asks for what is on
 * screen.
 *
 * AND IT IS THE FIRST THAT REFUSES TO DRAW. Above the per-request cap it
 * returns NO features and the true count, and the panel says how many are there
 * and to zoom in. Drawing an arbitrary thousand of 214,391 parcels shows holes
 * in a fabric that has none, and a planner looking at their own parcel layer
 * will believe the holes. `tooDenseToDraw` is that state, and it is the one
 * member of this payload no other map layer has.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import {
  WORKSPACE_GIS_BBOX_DRAW_LIMIT,
  describeWorkspaceLayerCoverage,
  describeWorkspaceLayerVersion,
} from "@/lib/workspace-gis/coverage";
import { loadWorkspaceGisLayer } from "@/lib/workspace-gis/store";
import type {
  WorkspaceGisFeatureCollection,
  WorkspaceGisMapFeature,
} from "@/lib/workspace-gis/types";

type RouteContext = { params: Promise<{ layerId: string }> };

const paramsSchema = z.object({ layerId: z.string().uuid() });

type BboxRow = {
  id: string | null;
  feature_index: number | null;
  geometry_geojson: unknown;
  properties: unknown;
  matched_count: number | string | null;
};

/** "w,s,e,n" — refused rather than defaulted: a wrong window is a wrong map. */
function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4 || !parts.every((value) => Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  return [west, south, east, north];
}

function emptyCollection(
  limit: number,
  coverageNotes: string[] = []
): WorkspaceGisFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [],
    returnedCount: 0,
    matchedCount: 0,
    droppedCount: 0,
    truncated: false,
    limit,
    tooDenseToDraw: false,
    coverageNotes,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("map-features.workspace-gis", request);
  const startedAt = Date.now();
  const limit = WORKSPACE_GIS_BBOX_DRAW_LIMIT;

  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid layer id" }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const bbox = parseBbox(request.nextUrl.searchParams.get("bbox"));
    if (!bbox) {
      return NextResponse.json(
        {
          error:
            "This layer is read one map view at a time. Pass bbox=west,south,east,north in longitude/latitude — " +
            "there is no whole-layer fetch, because a parcel layer is larger than any one response.",
        },
        { status: 400 }
      );
    }

    const { layer, error: layerError } = await loadWorkspaceGisLayer(supabase, params.data.layerId);
    if (layerError) {
      audit.error("workspace_gis_layer_read_failed", { message: layerError });
      return NextResponse.json({ error: "Failed to load the map layer" }, { status: 500 });
    }
    if (!layer) return NextResponse.json({ error: "Map layer not found" }, { status: 404 });

    const version = layer.currentVersion;
    if (!version) {
      // A layer whose upload never finished draws nothing, and says why rather
      // than presenting as an empty layer.
      return NextResponse.json(
        emptyCollection(limit, [
          `${layer.name}: no finished upload, so nothing is drawn. That is not a finding that the area is empty.`,
        ]),
        { status: 200 }
      );
    }

    const { data, error } = await supabase.rpc("workspace_gis_features_in_bbox", {
      p_version_id: version.id,
      p_west: bbox[0],
      p_south: bbox[1],
      p_east: bbox[2],
      p_north: bbox[3],
      p_limit: limit,
    });

    if (error) {
      audit.error("workspace_gis_features_query_failed", {
        layerId: layer.id,
        versionId: version.id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load the map layer" }, { status: 500 });
    }

    const rows = (data ?? []) as BboxRow[];

    // The function always answers at least one row, and it carries the true
    // matched count even when it carries no geometry. An empty array here means
    // the function itself returned nothing, which is zero matches.
    const rawMatched = rows[0]?.matched_count ?? 0;
    const matchedCount =
      typeof rawMatched === "number" ? rawMatched : Number.parseInt(String(rawMatched), 10) || 0;

    const features: WorkspaceGisMapFeature[] = [];
    let droppedCount = 0;
    for (const row of rows) {
      if (!row.id) continue; // the count-only row
      if (!row.geometry_geojson || typeof row.geometry_geojson !== "object") {
        droppedCount += 1;
        continue;
      }
      features.push({
        type: "Feature",
        id: row.id,
        geometry: row.geometry_geojson,
        properties: {
          kind: "workspace_gis_feature",
          layerId: layer.id,
          versionId: version.id,
          featureIndex: row.feature_index ?? 0,
          attributes:
            row.properties && typeof row.properties === "object"
              ? (row.properties as Record<string, unknown>)
              : {},
        },
      });
    }

    const tooDenseToDraw = matchedCount > limit;

    const payload: WorkspaceGisFeatureCollection = {
      type: "FeatureCollection",
      features,
      returnedCount: features.length,
      matchedCount,
      droppedCount,
      truncated: features.length + droppedCount < matchedCount,
      limit,
      tooDenseToDraw,
      coverageNotes: [
        ...describeWorkspaceLayerCoverage({
          layerName: layer.name,
          returnedCount: features.length,
          matchedCount,
          droppedCount,
          limit,
          tooDenseToDraw,
        }),
        // The version's own caveats — the asserted coordinate system, the datum
        // note — ride with every viewport read, not only with the layer list. A
        // caveat a planner sees once at upload has stopped existing by the time
        // somebody else opens the map.
        ...describeWorkspaceLayerVersion(version),
      ],
    };

    audit.info("workspace_gis_features_loaded", {
      layerId: layer.id,
      versionId: version.id,
      returnedCount: features.length,
      matchedCount,
      tooDenseToDraw,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    audit.error("workspace_gis_features_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading the map layer" },
      { status: 500 }
    );
  }
}
