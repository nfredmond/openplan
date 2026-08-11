import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { hashFlightPlanParams, type FlightPlanHashInput } from "@/lib/aerial/camera-registry";
import {
  buildDjiWpmlKmz,
  buildGenericKml,
  buildLitchiCsv,
  flightExportContentType,
  flightExportFilename,
  isFlightExportFormat,
  parseFlightPlanSnapshot,
} from "@/lib/aerial/flight-exports";

/**
 * GET ?format=wpml|litchi|kml — download the mission's SAVED flight plan as a
 * flyable/reviewable file. Three refusals are load-bearing:
 *
 *   1. No saved snapshot → 409 "Generate and save the flight plan first."
 *      Exports are built from what a planner generated, reviewed and saved —
 *      never regenerated server-side at download time.
 *   2. Stale snapshot (the saved parameters' fingerprint no longer matches
 *      the one the snapshot was generated under, including the mission AOI)
 *      → 409. A file a crew flies must be the plan somebody reviewed, not a
 *      grid computed from settings that have since changed.
 *   3. Unparseable snapshot → 409 naming why, instead of a best-effort file.
 *
 * Read-only members MAY export: downloading is a read. Membership is still
 * required — the mission row and membership check mirror the sibling aerial
 * routes.
 */

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

type RouteContext = { params: Promise<{ missionId: string }> };

/** PostgREST returns NUMERIC as a JSON string; the fingerprint needs numbers. */
function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type FlightPlanRow = {
  camera_key: string;
  target_gsd_cm_per_px: number | string | null;
  altitude_agl_m: number | string | null;
  front_overlap_pct: number | string;
  side_overlap_pct: number | string;
  speed_m_s: number | string | null;
  gimbal_pitch_deg: number | string | null;
  cross_grid: boolean;
  boundary_margin_m: number | string | null;
  corridor_width_m: number | string | null;
  generated_plan: unknown;
  generated_with: string | null;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-flight-plan.export", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const format = request.nextUrl.searchParams.get("format") ?? "";
    if (!isFlightExportFormat(format)) {
      return NextResponse.json(
        {
          error: `Unsupported export format "${format}". Choose wpml (DJI Pilot 2 .kmz), litchi (Litchi CSV), or kml (generic GIS).`,
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, title, aoi_geojson")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", {
        missionId: parsedParams.data.missionId,
        message: missionError.message,
      });
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
      audit.error("membership_check_failed", {
        workspaceId: mission.workspace_id,
        message: membershipError.message,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: plan, error: planError } = await supabase
      .from("aerial_flight_plans")
      .select(
        "camera_key, target_gsd_cm_per_px, altitude_agl_m, front_overlap_pct, side_overlap_pct, " +
          "speed_m_s, gimbal_pitch_deg, cross_grid, boundary_margin_m, corridor_width_m, " +
          "generated_plan, generated_with"
      )
      .eq("mission_id", mission.id)
      .maybeSingle();

    if (planError) {
      audit.error("aerial_flight_plan_load_failed", {
        missionId: mission.id,
        message: planError.message,
      });
      return NextResponse.json({ error: "Failed to load flight plan" }, { status: 500 });
    }

    const row = plan as FlightPlanRow | null;
    if (!row || row.generated_plan === null || row.generated_with === null) {
      return NextResponse.json(
        {
          error:
            "Generate and save the flight plan first. Exports are built from the saved, reviewed plan — there is nothing saved for this mission yet.",
        },
        { status: 409 }
      );
    }

    // Staleness: the snapshot must have been generated from the parameters
    // (and mission AOI) as they stand NOW, or the crew flies something nobody
    // reviewed in its current form.
    const hashInput: FlightPlanHashInput = {
      aoiGeojson: mission.aoi_geojson ?? null,
      cameraKey: row.camera_key,
      targetGsdCmPerPx: asNumber(row.target_gsd_cm_per_px),
      altitudeAglM: asNumber(row.altitude_agl_m),
      frontOverlapPct: asNumber(row.front_overlap_pct) ?? 0,
      sideOverlapPct: asNumber(row.side_overlap_pct) ?? 0,
      speedMS: asNumber(row.speed_m_s),
      gimbalPitchDeg: asNumber(row.gimbal_pitch_deg),
      crossGrid: row.cross_grid,
      boundaryMarginM: asNumber(row.boundary_margin_m),
      corridorWidthM: asNumber(row.corridor_width_m),
    };
    if (hashFlightPlanParams(hashInput) !== row.generated_with) {
      return NextResponse.json(
        {
          error:
            "The saved plan predates these settings — the flight-plan parameters (or the mission AOI) changed after the grid was generated. Regenerate and save the flight plan, then export.",
        },
        { status: 409 }
      );
    }

    const parsedSnapshot = parseFlightPlanSnapshot(row.generated_plan);
    if (!parsedSnapshot.ok) {
      audit.warn("aerial_flight_plan_snapshot_unusable", {
        missionId: mission.id,
        message: parsedSnapshot.message,
      });
      return NextResponse.json(
        { error: `The saved flight plan cannot be exported: ${parsedSnapshot.message}` },
        { status: 409 }
      );
    }

    const snapshot = parsedSnapshot.snapshot;
    const gimbalPitchDeg = asNumber(row.gimbal_pitch_deg);

    let body: Uint8Array | string;
    if (format === "wpml") {
      body = await buildDjiWpmlKmz({ missionTitle: mission.title, snapshot, gimbalPitchDeg });
    } else if (format === "litchi") {
      body = buildLitchiCsv({ snapshot, gimbalPitchDeg });
    } else {
      body = buildGenericKml({ missionTitle: mission.title, snapshot });
    }

    audit.info("aerial_flight_plan_exported", {
      missionId: mission.id,
      workspaceId: mission.workspace_id,
      userId: user.id,
      format,
      lineCount: snapshot.lineCount,
      photoCount: snapshot.photoCount,
      durationMs: Date.now() - startedAt,
    });

    const filename = flightExportFilename(mission.title, mission.id, format);
    return new NextResponse(typeof body === "string" ? body : Buffer.from(body), {
      status: 200,
      headers: {
        "Content-Type": flightExportContentType(format),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    audit.error("aerial_flight_plan_export_unhandled_error", {
      error,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Unexpected error while exporting flight plan" }, { status: 500 });
  }
}
