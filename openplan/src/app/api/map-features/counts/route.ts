import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { aerialMissionsWithAoiCountQuery } from "@/lib/aerial/queries";
import {
  HOME_GEOGRAPHY_SCOPE_COLUMNS,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import { resolveCensusTractScope } from "@/lib/geographies/census-tract-scope";

export type MapFeatureCounts = {
  projects: number | null;
  aerial: number | null;
  corridors: number | null;
  rtp: number | null;
  equity: number | null;
  engagement: number | null;
};

const EMPTY_COUNTS: MapFeatureCounts = {
  projects: 0,
  aerial: 0,
  corridors: 0,
  rtp: 0,
  // NOT 0. With no membership there is no geography to scope tracts to, so
  // nothing was counted — and census tracts are public data, so "no workspace"
  // is not evidence that zero tracts exist. `null` is this route's existing
  // "we don't know" signal, and the chip disappears rather than asserting a
  // measurement that was never taken.
  equity: null,
  engagement: 0,
};

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.counts", request);
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
      return NextResponse.json(EMPTY_COUNTS, { status: 200 });
    }

    const workspaceId = membership.workspace_id;

    // The equity chip must count the SAME tracts the choropleth can draw. It
    // previously counted `census_tracts_map` with no filter at all — a national
    // total presented beside this workspace's map.
    const { data: workspaceRow } = await supabase
      .from("workspaces")
      .select(HOME_GEOGRAPHY_SCOPE_COLUMNS)
      .eq("id", workspaceId)
      .maybeSingle();
    const tractScope = resolveCensusTractScope(parseWorkspaceHomeGeography(workspaceRow), {
      hasWorkspace: true,
    });

    const [
      projectsResult,
      aerialResult,
      corridorsResult,
      rtpResult,
      equityResult,
      engagementResult,
    ] =
      await Promise.all([
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .not("latitude", "is", null)
          .not("longitude", "is", null),
        aerialMissionsWithAoiCountQuery(supabase, workspaceId),
        supabase
          .from("project_corridors")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
        supabase
          .from("rtp_cycles")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .not("anchor_latitude", "is", null)
          .not("anchor_longitude", "is", null),
        // Scoped identically to /api/map-features/census-tracts. An unscoped
        // workspace counts NOTHING rather than counting the nation: a chip
        // reading "0" would assert a measurement, and one reading the national
        // total would assert somebody else's.
        tractScope.scopeState === "home_geography"
          ? supabase
              .from("census_tracts_map")
              .select("geoid", { count: "exact", head: true })
              .eq("state_fips", tractScope.stateFips)
              .eq("county_fips", tractScope.countyFips)
          : Promise.resolve({ count: null, error: null } as { count: number | null; error: null }),
        supabase
          .from("engagement_items")
          .select("id, engagement_campaigns!inner(id)", { count: "exact", head: true })
          .eq("engagement_campaigns.workspace_id", workspaceId)
          .eq("status", "approved")
          .not("latitude", "is", null)
          .not("longitude", "is", null),
      ]);

    const counts: MapFeatureCounts = {
      projects: projectsResult.error ? null : projectsResult.count ?? 0,
      aerial: aerialResult.error ? null : aerialResult.count ?? 0,
      corridors: corridorsResult.error ? null : corridorsResult.count ?? 0,
      rtp: rtpResult.error ? null : rtpResult.count ?? 0,
      // `?? null`, not `?? 0`: the unscoped branch resolves a null count on
      // purpose, and coercing it to 0 would put the fabricated zero back.
      equity: equityResult.error ? null : equityResult.count ?? null,
      engagement: engagementResult.error ? null : engagementResult.count ?? 0,
    };

    if (
      projectsResult.error ||
      aerialResult.error ||
      corridorsResult.error ||
      rtpResult.error ||
      equityResult.error ||
      engagementResult.error
    ) {
      audit.warn("map_feature_counts_partial_failure", {
        workspaceId,
        projectsError: projectsResult.error?.message ?? null,
        aerialError: aerialResult.error?.message ?? null,
        corridorsError: corridorsResult.error?.message ?? null,
        rtpError: rtpResult.error?.message ?? null,
        equityError: equityResult.error?.message ?? null,
        engagementError: engagementResult.error?.message ?? null,
      });
    }

    audit.info("map_feature_counts_loaded", {
      workspaceId,
      counts,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(counts, { status: 200 });
  } catch (error) {
    audit.error("map_feature_counts_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading map feature counts" },
      { status: 500 }
    );
  }
}
