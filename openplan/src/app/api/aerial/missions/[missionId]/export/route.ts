import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { buildDjiMissionExport, isAoiPolygonGeoJson } from "@/lib/aerial/dji-export";

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

type RouteContext = { params: Promise<{ missionId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-missions.export-dji", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const format = request.nextUrl.searchParams.get("format") ?? "dji-json";
    if (format !== "dji-json") {
      return NextResponse.json(
        { error: `Unsupported export format: ${format}. Only "dji-json" is supported today.` },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, title, aoi_geojson")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", { missionId: parsedParams.data.missionId, message: missionError.message });
      return NextResponse.json({ error: "Failed to load mission" }, { status: 500 });
    }
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", mission.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_check_failed", { workspaceId: mission.workspace_id, message: membershipError.message });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!isAoiPolygonGeoJson(mission.aoi_geojson)) {
      return NextResponse.json(
        {
          error: "Mission has no AOI polygon yet. Draw an AOI on the mission edit page before exporting.",
        },
        { status: 409 }
      );
    }

    const exportPayload = buildDjiMissionExport({
      missionId: mission.id,
      missionTitle: mission.title,
      aoiGeojson: mission.aoi_geojson,
    });

    audit.info("aerial_mission_exported_dji", {
      missionId: mission.id,
      userId: user.id,
      waypointCount: exportPayload.waypointCount,
      durationMs: Date.now() - startedAt,
    });

    const body = JSON.stringify(exportPayload, null, 2);
    const safeTitle = mission.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const filename = `dji-mission-${safeTitle || mission.id}.json`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    audit.error("aerial_mission_export_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while exporting mission" }, { status: 500 });
  }
}
