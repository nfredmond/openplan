import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  buildMapLayerDisclosure,
  PROJECT_AREA_LAYER_LIMIT,
} from "@/lib/cartographic/layer-disclosure";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

/**
 * The AREA each project studies, as a map layer.
 *
 * Deliberately a separate layer from `/api/map-features/projects`, which draws
 * the project's SITE marker. The schema keeps those apart on purpose
 * (20260728000009: "a marker is a SITE — the intersection being rebuilt — while
 * this is the AREA the work studies"), and a planner asking "where are we
 * working?" wants the boundary, not the pin. Merging them would force one of the
 * two facts to be inferred from the other.
 *
 * PAYLOAD. `place_geometry_geojson` is the one heavy column on `projects`;
 * `PROJECT_PLACE_SCOPE_COLUMNS` exists precisely so list and rollup queries can
 * avoid it. This route is the exception that needs it — a bbox rectangle drawn
 * where a county's real outline belongs would state a boundary the workspace
 * never chose — so it pays for the polygon and caps the row count an order of
 * magnitude lower than the shared map-feature limit, disclosing the cap through
 * the same contract every other layer uses.
 */

type ProjectAreaRow = {
  id: string;
  name: string | null;
  status: string | null;
  place_source: string | null;
  place_kind: string | null;
  place_label: string | null;
  place_geometry_geojson: unknown;
};

/**
 * Accept only the two polygon shapes a stored area can legitimately be.
 *
 * The column is JSONB with no shape constraint, so a malformed or non-areal
 * value is possible in principle. Such a row is COUNTED as dropped rather than
 * silently skipped: an area that exists in the record but cannot be drawn is a
 * different fact from a project that never stated one.
 */
function isAreaGeometry(value: unknown): value is {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown[];
} {
  if (!value || typeof value !== "object") return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return false;
  if (!Array.isArray(g.coordinates)) return false;
  return g.coordinates.length > 0;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.project-areas", request);
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

    if (!membership) {
      return NextResponse.json(
        {
          type: "FeatureCollection" as const,
          features: [],
          ...buildMapLayerDisclosure({
            returnedCount: 0,
            droppedCount: 0,
            matchedCount: 0,
            limit: PROJECT_AREA_LAYER_LIMIT,
          }),
        },
        { status: 200 }
      );
    }

    // `count: "exact"` rides the same round trip, so the disclosure and the drawn
    // features can never come from differently-filtered queries. Ordering by when
    // the area was stated makes a truncated payload "the most recently set
    // areas" — a subset a planner can reason about — rather than an arbitrary
    // slice that reshuffles between loads.
    const { data, error, count } = await supabase
      .from("projects")
      .select("id, name, status, place_source, place_kind, place_label, place_geometry_geojson", {
        count: "exact",
      })
      .eq("workspace_id", membership.workspace_id)
      .not("place_geometry_geojson", "is", null)
      .order("place_set_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(PROJECT_AREA_LAYER_LIMIT);

    if (error) {
      audit.error("project_area_query_failed", {
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load project areas" }, { status: 500 });
    }

    const rows = (data ?? []) as ProjectAreaRow[];

    const features = rows.flatMap((row) => {
      if (!isAreaGeometry(row.place_geometry_geojson)) return [];
      return [
        {
          type: "Feature" as const,
          id: row.id,
          geometry: row.place_geometry_geojson,
          properties: {
            kind: "project_area",
            projectId: row.id,
            projectName: row.name ?? "",
            status: row.status ?? "",
            placeSource: row.place_source,
            placeKind: row.place_kind,
            placeLabel: row.place_label,
          },
        },
      ];
    });

    const droppedCount = rows.length - features.length;

    audit.info("project_areas_loaded", {
      workspaceId: membership.workspace_id,
      count: features.length,
      droppedCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        type: "FeatureCollection" as const,
        features,
        ...buildMapLayerDisclosure({
          returnedCount: features.length,
          droppedCount,
          matchedCount: count,
          limit: PROJECT_AREA_LAYER_LIMIT,
        }),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("project_areas_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading project areas" },
      { status: 500 }
    );
  }
}
