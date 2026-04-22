import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";

type CorridorRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  corridor_type: string;
  los_grade: string | null;
  geometry_geojson: unknown;
};

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.corridors", request);
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
        { type: "FeatureCollection" as const, features: [] },
        { status: 200 }
      );
    }

    // TODO(pagination): hard cap the result set while the backdrop is a single
    // unpaginated fetch. Revisit when workspaces routinely hold >500 corridors.
    const { data, error } = await supabase
      .from("project_corridors")
      .select("id, workspace_id, project_id, name, corridor_type, los_grade, geometry_geojson")
      .eq("workspace_id", membership.workspace_id)
      .limit(500);

    if (error) {
      audit.error("project_corridors_query_failed", {
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load project corridors" }, { status: 500 });
    }

    const rows = (data ?? []) as CorridorRow[];

    const features = rows.flatMap((row) => {
      if (!isCorridorLineGeoJson(row.geometry_geojson)) return [];
      return [
        {
          type: "Feature" as const,
          id: row.id,
          geometry: row.geometry_geojson,
          properties: {
            kind: "corridor",
            corridorId: row.id,
            projectId: row.project_id,
            name: row.name,
            corridorType: row.corridor_type,
            losGrade: row.los_grade,
          },
        },
      ];
    });

    audit.info("project_corridors_loaded", {
      workspaceId: membership.workspace_id,
      count: features.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { type: "FeatureCollection" as const, features },
      { status: 200 }
    );
  } catch (error) {
    audit.error("project_corridors_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading project corridors" },
      { status: 500 }
    );
  }
}
