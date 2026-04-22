import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  delivery_phase: string;
  plan_type: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

// Lat/lng are stored as NUMERIC in Postgres (see migration
// 20260421000065_projects_location.sql), which surfaces through PostgREST as
// either `number` or `string` depending on driver plumbing. Normalize to a
// finite number and drop rows that are missing / out of range — the row-
// level check constraints reject out-of-range writes, but defense in depth.
function coerceLat(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < -90 || n > 90) return null;
  return n;
}

function coerceLng(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < -180 || n > 180) return null;
  return n;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.projects", request);
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
    // unpaginated fetch. Revisit when workspaces routinely hold >500 projects.
    const { data, error } = await supabase
      .from("projects")
      .select("id, workspace_id, name, status, delivery_phase, plan_type, latitude, longitude")
      .eq("workspace_id", membership.workspace_id)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(500);

    if (error) {
      audit.error("project_markers_query_failed", {
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load project markers" }, { status: 500 });
    }

    const rows = (data ?? []) as ProjectRow[];

    const features = rows.flatMap((row) => {
      const lat = coerceLat(row.latitude);
      const lng = coerceLng(row.longitude);
      if (lat === null || lng === null) return [];
      return [
        {
          type: "Feature" as const,
          id: row.id,
          geometry: {
            type: "Point" as const,
            coordinates: [lng, lat],
          },
          properties: {
            kind: "project",
            projectId: row.id,
            name: row.name,
            status: row.status,
            deliveryPhase: row.delivery_phase,
            planType: row.plan_type,
          },
        },
      ];
    });

    audit.info("project_markers_loaded", {
      workspaceId: membership.workspace_id,
      count: features.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { type: "FeatureCollection" as const, features },
      { status: 200 }
    );
  } catch (error) {
    audit.error("project_markers_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading project markers" },
      { status: 500 }
    );
  }
}
