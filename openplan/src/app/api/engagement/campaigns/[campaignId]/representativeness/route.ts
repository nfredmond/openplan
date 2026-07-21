import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { fetchCensusForCorridor } from "@/lib/data-sources/census";
import { fetchTractOverlayFeatures, type CensusTractOverlayMetrics } from "@/lib/data-sources/census-geometry";
import {
  assignRespondentsToTracts,
  bboxOfCorridorLines,
  bboxOfPoints,
  bboxToPolygon,
  bufferBbox,
  buildRepresentativeness,
  type CampaignRepresentativeness,
  type StudyAreaSource,
  type TractFeature,
} from "@/lib/engagement/representativeness";
import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

type RouteContext = { params: Promise<{ campaignId: string }> };

type ItemRow = { id: string; latitude: number | null; longitude: number | null };

const MAX_RESPONDENTS = 2000;

/**
 * POST — (re)compute the spatial/ecological representativeness screening for a
 * campaign and cache it. On-demand (not a page-render dependency) because it hits
 * the external ACS + TIGERweb APIs. Auth: workspace member with `engagement.write`.
 * Typed non-500 errors for the "can't compute yet" cases so the UI can explain.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.representativeness.post", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign route params" }, { status: 400 });
    }
    const { campaignId } = parsedParams.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadCampaignAccess(supabase, campaignId, user.id, "engagement.write");
    if (access.error) {
      return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
    }
    if (!access.campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Respondents = the campaign's approved, geolocated comments.
    const { data: itemRows, error: itemsError } = await supabase
      .from("engagement_items")
      .select("id, latitude, longitude")
      .eq("campaign_id", campaignId)
      .eq("status", "approved")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(MAX_RESPONDENTS);
    if (itemsError) {
      return NextResponse.json({ error: "Failed to load engagement items" }, { status: 500 });
    }

    const respondentPoints = ((itemRows ?? []) as ItemRow[])
      .filter((row) => typeof row.latitude === "number" && typeof row.longitude === "number")
      .map((row) => ({ lng: row.longitude as number, lat: row.latitude as number }));

    if (respondentPoints.length === 0) {
      return NextResponse.json(
        { error: "no_located_respondents", message: "Representativeness needs approved, geolocated comments." },
        { status: 422 }
      );
    }

    // Study area: prefer the corridor(s) linked to the campaign's project —
    // that baselines against who the project affects, not just where comments
    // clustered. Fall back to the respondent footprint when no project or no
    // valid corridor geometry exists (and on a corridor query error: a worse
    // study area beats a 500 for an on-demand screening).
    const campaignRow = access.campaign as { workspace_id: string; project_id?: string | null };
    let studyAreaSource: StudyAreaSource = "respondent_extent";
    let studyAreaBbox = bboxOfPoints(respondentPoints)!;

    if (campaignRow.project_id) {
      const { data: corridorRows, error: corridorError } = await supabase
        .from("project_corridors")
        .select("geometry_geojson")
        .eq("workspace_id", campaignRow.workspace_id)
        .eq("project_id", campaignRow.project_id)
        .limit(50);
      if (corridorError) {
        audit.warn("engagement_representativeness_corridor_load_failed", {
          campaignId,
          message: corridorError.message,
        });
      } else {
        const corridorBbox = bboxOfCorridorLines(
          ((corridorRows ?? []) as Array<{ geometry_geojson: unknown }>)
            .map((row) => row.geometry_geojson)
            .filter(isCorridorLineGeoJson)
            .map((geometry) => geometry.coordinates)
        );
        if (corridorBbox) {
          studyAreaSource = "project_corridor";
          studyAreaBbox = corridorBbox;
        }
      }
    }

    const bbox = bufferBbox(studyAreaBbox);
    const corridorPolygon = bboxToPolygon(bbox);

    // External: ACS metrics for the study-area tracts, then TIGERweb polygons.
    const census = await fetchCensusForCorridor(corridorPolygon);
    if (census.tracts.length === 0) {
      return NextResponse.json(
        { error: "census_unavailable", message: "No ACS tract data was available for this area." },
        { status: 502 }
      );
    }

    const overlayMetrics: CensusTractOverlayMetrics[] = census.tracts.map((tract) => ({
      geoid: tract.geoid,
      population: tract.population,
      medianIncome: tract.medianIncome,
      pctMinority: tract.pctMinority,
      pctBelowPoverty: tract.pctBelowPoverty,
      zeroVehicleHouseholds: tract.zeroVehicleHouseholds,
      totalHouseholds: tract.totalHouseholds,
      transitCommuters: tract.transitCommuters,
      totalCommuters: tract.totalCommuters,
    }));

    const features = await fetchTractOverlayFeatures(bbox, overlayMetrics);
    if (features.length === 0) {
      return NextResponse.json(
        { error: "tract_geometry_unavailable", message: "No tract geometry was available for this area." },
        { status: 502 }
      );
    }

    const geoidsInArea = new Set(
      features.map((feature) => String((feature.properties as { geoid?: string } | null)?.geoid ?? "")).filter(Boolean)
    );
    const studyTracts = census.tracts.filter((tract) => geoidsInArea.has(tract.geoid));
    const tractFeatures: TractFeature[] = features.map((feature) => ({
      geoid: String((feature.properties as { geoid?: string } | null)?.geoid ?? ""),
      geometry: (feature.geometry as TractFeature["geometry"]) ?? null,
    }));

    const respondentCountByGeoid = assignRespondentsToTracts(respondentPoints, tractFeatures);
    const result = buildRepresentativeness(studyTracts, respondentCountByGeoid);

    const cached: CampaignRepresentativeness = {
      ...result,
      computedAt: new Date().toISOString(),
      locatedRespondentCount: respondentPoints.length,
      studyAreaSource,
    };

    const { error: updateError } = await supabase
      .from("engagement_campaigns")
      .update({ representativeness_json: cached, representativeness_computed_at: cached.computedAt })
      .eq("id", campaignId);
    if (updateError) {
      audit.warn("engagement_representativeness_persist_failed", { campaignId, message: updateError.message });
    }

    return NextResponse.json({ representativeness: cached });
  } catch (error) {
    audit.error("engagement_representativeness_unhandled", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to compute representativeness" }, { status: 500 });
  }
}
