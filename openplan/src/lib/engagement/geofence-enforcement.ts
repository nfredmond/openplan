import { NextResponse } from "next/server";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { placeOfRecordFromProject, PROJECT_PLACE_SCOPE_COLUMNS } from "@/lib/projects/project-place";
import {
  OUTSIDE_CAMPAIGN_AREA_REASON,
  SUBMISSION_GEOFENCE_COLUMN,
  evaluateGeofenceForAll,
  geofenceRefusalMessage,
  type GeofenceCoordinate,
} from "@/lib/engagement/geofence";

/** The flag plus the place-of-record scope, in one projection. */
export const GEOFENCE_CAMPAIGN_COLUMNS = [SUBMISSION_GEOFENCE_COLUMN, PROJECT_PLACE_SCOPE_COLUMNS].join(", ");

/**
 * ENFORCING A CAMPAIGN'S CONSULTATION AREA, in ONE place, for EVERY way a
 * resident can put a location into the record.
 *
 * WHY THIS IS SHARED RATHER THAN LOCAL TO A ROUTE. There are two of those ways:
 * a pin or shape on the comment map (`/api/engage/[shareToken]/submit`), and a
 * `map_point` answer inside a survey (`/api/engage/[shareToken]/survey/submit`).
 * The check began life inside the first route, so the second accepted a marked
 * location anywhere on Earth while the operator console promised "Only accept
 * comments pinned inside <area>" and the survey map said so to the resident's
 * face. A rule enforced on one of two doors is not a rule; it is a claim.
 *
 * Two agents working the same feature could each see their own half and neither
 * could see the seam, which is exactly why the enforcement now lives where both
 * doors reach it instead of where the first one happened to be written.
 *
 * EVERY FAILURE MODE ACCEPTS THE SUBMISSION, and each is logged:
 *
 *   - the flag/area read fails -> we do not know whether a rule applies, and
 *     inventing one would refuse a member of the public on the strength of a
 *     broken query. Before 20260730000002 is applied it is also the ONLY
 *     possible outcome, which is what makes the deploy safe in either order;
 *   - the boundary read fails, or the boundary is a shape this code cannot
 *     read -> the bounding box already said inside, and the finer test is the
 *     one that failed. Accepting a pin inside the box and possibly outside the
 *     polygon is a small error; refusing someone because the agency's geometry
 *     would not parse is a large one.
 *
 * The one thing it will not do is fail silently: each path writes an audit line
 * naming which test could not be run.
 */
export type GeofenceAudit = {
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

export async function refuseSubmissionOutsideCampaignArea(
  supabase: ReturnType<typeof createServiceRoleClient>,
  audit: GeofenceAudit,
  campaignId: string,
  coordinates: GeofenceCoordinate[]
): Promise<NextResponse | null> {
  const { data: scopeRow, error: scopeError } = await supabase
    .from("engagement_campaigns")
    .select(GEOFENCE_CAMPAIGN_COLUMNS)
    .eq("id", campaignId)
    .maybeSingle();

  if (scopeError) {
    audit.error("engagement_geofence_scope_read_failed", {
      campaignId,
      message: scopeError.message,
      code: scopeError.code ?? null,
    });
    return null;
  }

  const scope = (scopeRow ?? {}) as Record<string, unknown>;
  if (scope[SUBMISSION_GEOFENCE_COLUMN] !== true) return null;

  const place = placeOfRecordFromProject(scope as never);
  let verdict = evaluateGeofenceForAll(place, coordinates);

  // The bounding box contains the boundary, so "outside the box" is already
  // final and the polygon — which can be megabytes for a county — is never
  // fetched for it. Only an inside-the-box pin is worth refining.
  if (verdict.state === "inside" && verdict.basis === "bbox" && !verdict.boundaryUnreadable) {
    const { data: boundaryRow, error: boundaryError } = await supabase
      .from("engagement_campaigns")
      .select("place_geometry_geojson")
      .eq("id", campaignId)
      .maybeSingle();

    if (boundaryError) {
      audit.error("engagement_geofence_boundary_read_failed", {
        campaignId,
        message: boundaryError.message,
        code: boundaryError.code ?? null,
      });
    } else {
      const boundary = (boundaryRow as { place_geometry_geojson?: unknown } | null)
        ?.place_geometry_geojson;
      if (boundary) {
        verdict = evaluateGeofenceForAll({ ...place, geometry: boundary }, coordinates);
      }
    }
  }

  if (verdict.state === "inside" && verdict.boundaryUnreadable) {
    audit.warn("engagement_geofence_boundary_unreadable", { campaignId });
  }

  if (verdict.state === "not_checked") {
    // The flag is on and there is nothing to test against. The
    // `engagement_campaigns_geofence_needs_area` CHECK (20260730000002) makes
    // this unstorable, so reaching it means the constraint is missing from this
    // deployment. Say so; do not refuse anyone over it.
    audit.warn("engagement_geofence_enabled_without_area", { campaignId, reason: verdict.reason });
    return null;
  }

  if (verdict.state !== "outside") return null;

  // No coordinate reaches the log. A refused pin is still a member of the
  // public's location, and the operator learns nothing from it that the basis
  // does not already tell them.
  audit.info("engagement_public_submission_outside_campaign_area", {
    campaignId,
    basis: verdict.basis,
    boundaryUnreadable: verdict.boundaryUnreadable,
  });

  return NextResponse.json(
    {
      // `error` is the field the public portal renders verbatim, so the sentence
      // a participant reads is this one — not a status code and not "invalid
      // coordinates", which would be false as well as useless.
      error: geofenceRefusalMessage(place.label),
      reason: OUTSIDE_CAMPAIGN_AREA_REASON,
    },
    { status: 422 }
  );
}
