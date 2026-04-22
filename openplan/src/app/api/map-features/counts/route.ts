import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export type MapFeatureCounts = {
  projects: number | null;
  aerial: number | null;
  corridors: number | null;
  rtp: number | null;
};

const EMPTY_COUNTS: MapFeatureCounts = { projects: 0, aerial: 0, corridors: 0, rtp: 0 };

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

    const [projectsResult, aerialResult, corridorsResult, rtpResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .not("latitude", "is", null)
        .not("longitude", "is", null),
      supabase
        .from("aerial_missions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .not("aoi_geojson", "is", null),
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
    ]);

    const counts: MapFeatureCounts = {
      projects: projectsResult.error ? null : projectsResult.count ?? 0,
      aerial: aerialResult.error ? null : aerialResult.count ?? 0,
      corridors: corridorsResult.error ? null : corridorsResult.count ?? 0,
      rtp: rtpResult.error ? null : rtpResult.count ?? 0,
    };

    if (
      projectsResult.error ||
      aerialResult.error ||
      corridorsResult.error ||
      rtpResult.error
    ) {
      audit.warn("map_feature_counts_partial_failure", {
        workspaceId,
        projectsError: projectsResult.error?.message ?? null,
        aerialError: aerialResult.error?.message ?? null,
        corridorsError: corridorsResult.error?.message ?? null,
        rtpError: rtpResult.error?.message ?? null,
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
