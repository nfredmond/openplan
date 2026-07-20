import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import {
  HOTSPOT_DEFAULT_EPS_METERS,
  HOTSPOT_DEFAULT_MIN_POINTS,
  loadSentimentHotspots,
  negativeItemIdsFromSyntheses,
} from "@/lib/engagement/hotspots";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

type RouteContext = { params: Promise<{ campaignId: string }> };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * GET — screening-grade spatial hotspots for a campaign's approved, geolocated
 * comments. Read-only, no AI call (the sentiment it uses was already computed by
 * the E1 synthesis), so there is no rate limiter. Auth: workspace member with
 * `engagement.read`. Powers the participation dashboard, reports, and the copilot.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.hotspots.get", request);

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

    const access = await loadCampaignAccess(supabase, campaignId, user.id, "engagement.read");
    if (access.error) {
      return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
    }
    if (!access.campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const epsParam = Number(url.searchParams.get("eps"));
    const minPointsParam = Number(url.searchParams.get("minPoints"));
    const epsMeters = Number.isFinite(epsParam) && epsParam > 0 ? clamp(epsParam, 25, 2000) : HOTSPOT_DEFAULT_EPS_METERS;
    const minPoints =
      Number.isFinite(minPointsParam) && minPointsParam > 0
        ? Math.round(clamp(minPointsParam, 2, 50))
        : HOTSPOT_DEFAULT_MIN_POINTS;

    // Sentiment is AI-derived (E1) — read it off the campaign; absent → no
    // significance testing, only the spatial clusters.
    const { data: synthRow } = await supabase
      .from("engagement_campaigns")
      .select("ai_synthesis_json")
      .eq("id", campaignId)
      .maybeSingle();
    const synthesis = (synthRow?.ai_synthesis_json ?? null) as EngagementSynthesis | null;
    const negativeItemIds = negativeItemIdsFromSyntheses([synthesis]);

    const { analysis, error } = await loadSentimentHotspots(supabase, {
      workspaceId: access.campaign.workspace_id,
      campaignId,
      negativeItemIds,
      epsMeters,
      minPoints,
    });
    if (error) {
      audit.warn("engagement_hotspots_rpc_failed", { campaignId, message: error });
      return NextResponse.json({ error: "Failed to compute hotspots" }, { status: 500 });
    }

    return NextResponse.json({ hotspots: analysis });
  } catch (error) {
    audit.error("engagement_hotspots_unhandled", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to compute hotspots" }, { status: 500 });
  }
}
