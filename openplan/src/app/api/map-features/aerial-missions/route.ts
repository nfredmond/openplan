import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { isAoiPolygonGeoJson } from "@/lib/aerial/dji-export";

type AerialMissionRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  status: string;
  mission_type: string;
  aoi_geojson: unknown;
};

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.aerial-missions", request);
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
    // unpaginated fetch. Revisit when workspaces routinely hold >500 missions.
    const { data, error } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, project_id, title, status, mission_type, aoi_geojson")
      .eq("workspace_id", membership.workspace_id)
      .not("aoi_geojson", "is", null)
      .limit(500);

    if (error) {
      audit.error("aerial_mission_aoi_query_failed", {
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load mission AOIs" }, { status: 500 });
    }

    const rows = (data ?? []) as AerialMissionRow[];

    const features = rows
      .filter((row) => isAoiPolygonGeoJson(row.aoi_geojson))
      .map((row) => ({
        type: "Feature" as const,
        id: row.id,
        geometry: row.aoi_geojson,
        properties: {
          kind: "aerial_mission",
          missionId: row.id,
          projectId: row.project_id,
          title: row.title,
          status: row.status,
          missionType: row.mission_type,
        },
      }));

    audit.info("aerial_mission_aois_loaded", {
      workspaceId: membership.workspace_id,
      count: features.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { type: "FeatureCollection" as const, features },
      { status: 200 }
    );
  } catch (error) {
    audit.error("aerial_mission_aoi_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading mission AOIs" },
      { status: 500 }
    );
  }
}
