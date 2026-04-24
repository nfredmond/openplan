import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type EngagementCampaignRef = {
  id: string;
  workspace_id: string;
};

type EngagementCategoryRef = {
  label: string | null;
};

type EngagementItemRow = {
  id: string;
  title: string | null;
  body: string | null;
  status: string;
  source_type: string;
  latitude: number | string | null;
  longitude: number | string | null;
  engagement_campaigns: EngagementCampaignRef | null;
  engagement_categories: EngagementCategoryRef | null;
};

type SupabaseEmbed<T> = T | T[] | null;

type RawEngagementItemRow = Omit<
  EngagementItemRow,
  "engagement_campaigns" | "engagement_categories"
> & {
  engagement_campaigns: SupabaseEmbed<EngagementCampaignRef>;
  engagement_categories: SupabaseEmbed<EngagementCategoryRef>;
};

function firstEmbed<T>(value: SupabaseEmbed<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// engagement_items.latitude/longitude are DOUBLE PRECISION (migration
// 20260314000020_engagement_module.sql), so PostgREST almost always returns
// number. Coerce defensively anyway — the cost is two Number.parseFloat
// calls per row, the benefit is that a future schema change to NUMERIC
// (for higher precision on point locations) won't break the route.
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

const EXCERPT_CHAR_LIMIT = 140;

function buildExcerpt(body: string | null): string {
  if (!body) return "";
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= EXCERPT_CHAR_LIMIT) return collapsed;
  return `${collapsed.slice(0, EXCERPT_CHAR_LIMIT - 1).trimEnd()}…`;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.engagement", request);
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

    // engagement_items has no workspace_id column — the moderation model
    // owns campaigns (workspace-scoped), and items are children of a
    // campaign. Scope reads through the campaign with an inner join.
    //
    // `.eq("engagement_campaigns.workspace_id", ...)` applies the filter to
    // the embedded resource; combined with `!inner` we get a true SQL JOIN
    // rather than a left join with null workspace rows.
    //
    // Only `status = "approved"` items surface on the public backdrop.
    // Pending/rejected/flagged items stay hidden to preserve the moderator
    // review posture that engagement_items was designed around.
    //
    // TODO(pagination): hard cap at 500 while the backdrop is a single
    // unpaginated fetch. Revisit when a demo-scale workspace routinely
    // exceeds that (unlikely until public comment surfaces are live).
    const { data: rawRows, error } = await supabase
      .from("engagement_items")
      .select(
        "id, title, body, status, source_type, latitude, longitude, engagement_campaigns!inner(id, workspace_id), engagement_categories(label)"
      )
      .eq("engagement_campaigns.workspace_id", membership.workspace_id)
      .eq("status", "approved")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(500);

    if (error) {
      audit.error("engagement_items_query_failed", {
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement items" }, { status: 500 });
    }

    const rows = (rawRows ?? []).map((row: RawEngagementItemRow): EngagementItemRow => ({
      ...row,
      engagement_campaigns: firstEmbed(row.engagement_campaigns),
      engagement_categories: firstEmbed(row.engagement_categories),
    }));

    const features = rows.flatMap((row) => {
      const lat = coerceLat(row.latitude);
      const lng = coerceLng(row.longitude);
      if (lat === null || lng === null) return [];
      const campaign = row.engagement_campaigns;
      if (!campaign) return [];
      return [
        {
          type: "Feature" as const,
          id: row.id,
          geometry: {
            type: "Point" as const,
            coordinates: [lng, lat],
          },
          properties: {
            kind: "engagement_item",
            itemId: row.id,
            campaignId: campaign.id,
            title: row.title,
            excerpt: buildExcerpt(row.body),
            status: row.status,
            sourceType: row.source_type,
            categoryLabel: row.engagement_categories?.label ?? null,
          },
        },
      ];
    });

    audit.info("engagement_items_loaded", {
      workspaceId: membership.workspace_id,
      count: features.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { type: "FeatureCollection" as const, features },
      { status: 200 }
    );
  } catch (error) {
    audit.error("engagement_items_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading engagement items" },
      { status: 500 }
    );
  }
}
