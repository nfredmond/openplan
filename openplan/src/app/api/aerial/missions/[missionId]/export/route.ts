import { NextRequest, NextResponse } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

/**
 * SUPERSEDED — 410 Gone.
 *
 * This endpoint exported the mission AOI's PERIMETER as waypoints in a
 * private JSON shape ("natford-dji-1") that no DJI app could import, with
 * defaults (90 m, 5 m/s) nobody had authored. It is replaced by the
 * flight-plan exports, which serve the planner-authored, generated-and-saved
 * survey grid in formats a crew can actually fly:
 *
 *   GET /api/aerial/missions/[missionId]/flight-plan/export?format=wpml|litchi|kml
 *
 * The route stays as a tombstone rather than vanishing into a 404 so an old
 * bookmark or script is TOLD where the capability went instead of concluding
 * the mission is gone. No auth is required to learn that an endpoint no
 * longer exists — the answer carries no mission data.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("aerial-missions.export-dji", request);
  audit.info("aerial_mission_export_superseded", { path: request.nextUrl.pathname });
  return NextResponse.json(
    {
      error:
        "This export no longer exists. It produced a perimeter waypoint file in a format no flight app could load. " +
        "Use the mission page's flight plan instead: plan and save the survey grid, then export it as a DJI Pilot 2 " +
        ".kmz (WPML), a Litchi CSV, or a generic KML from /api/aerial/missions/[missionId]/flight-plan/export.",
    },
    { status: 410 }
  );
}
