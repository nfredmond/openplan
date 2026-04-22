import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type RtpCycleRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  anchor_latitude: number | string | null;
  anchor_longitude: number | string | null;
};

// Anchor lat/lng are stored as NUMERIC in Postgres (see migration
// 20260422000067_rtp_cycles_anchor.sql), which surfaces through PostgREST as
// either `number` or `string` depending on driver plumbing. Normalize and
// drop rows out of range — the row-level check constraints reject bad
// writes, but defense in depth.
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
  const audit = createApiAuditLogger("map-features.rtp-cycles", request);
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

    // TODO(pagination): hard cap the result set while the backdrop is a
    // single unpaginated fetch. Revisit when workspaces routinely hold >500
    // RTP cycles (unlikely — planning cycles are counted in single digits per
    // workspace).
    const { data, error } = await supabase
      .from("rtp_cycles")
      .select(
        "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, anchor_latitude, anchor_longitude"
      )
      .eq("workspace_id", membership.workspace_id)
      .not("anchor_latitude", "is", null)
      .not("anchor_longitude", "is", null)
      .limit(500);

    if (error) {
      audit.error("rtp_cycle_pins_query_failed", {
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load RTP cycle pins" }, { status: 500 });
    }

    const rows = (data ?? []) as RtpCycleRow[];

    const features = rows.flatMap((row) => {
      const lat = coerceLat(row.anchor_latitude);
      const lng = coerceLng(row.anchor_longitude);
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
            kind: "rtp_cycle",
            rtpCycleId: row.id,
            title: row.title,
            status: row.status,
            geographyLabel: row.geography_label,
            horizonStartYear: row.horizon_start_year,
            horizonEndYear: row.horizon_end_year,
          },
        },
      ];
    });

    audit.info("rtp_cycle_pins_loaded", {
      workspaceId: membership.workspace_id,
      count: features.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { type: "FeatureCollection" as const, features },
      { status: 200 }
    );
  } catch (error) {
    audit.error("rtp_cycle_pins_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading RTP cycle pins" },
      { status: 500 }
    );
  }
}
