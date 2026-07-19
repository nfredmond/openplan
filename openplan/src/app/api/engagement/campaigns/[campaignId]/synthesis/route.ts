import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import {
  generateEngagementSynthesis,
  SYNTHESIS_MAX_ITEMS,
  type SynthesisItem,
} from "@/lib/engagement/ai-synthesis";
import { checkAiUsageRateLimit } from "@/lib/billing/ai-rate-limit";
import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

type RouteContext = { params: Promise<{ campaignId: string }> };

type ItemRow = {
  id: string;
  body: string | null;
  title: string | null;
  category_id: string | null;
  latitude: number | null;
  longitude: number | null;
};

type CategoryRow = { id: string; label: string | null };

/**
 * POST — (re)generate the AI synthesis for a campaign's APPROVED items and
 * persist it on the campaign. Auth: workspace member with `engagement.write`
 * (generating incurs AI cost). AI-offline safe: the synthesis library returns a
 * deterministic, grounded fallback rather than throwing, so this route succeeds
 * (200) even with no API key — the response `source` tells the client which ran.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.synthesis.post", request);

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

    const workspaceId = access.campaign.workspace_id;
    const rateLimit = await checkAiUsageRateLimit(workspaceId);
    if (!rateLimit.allowed) {
      audit.warn("engagement_synthesis_rate_limited", { workspaceId, recentCount: rateLimit.count });
      return NextResponse.json(
        { error: "Too many AI requests in a short window. Please wait a moment and try again." },
        { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
      );
    }

    // Approved items only (the public-facing corpus), bounded. RLS scopes to the
    // member's workspace; the campaign filter narrows to this campaign.
    const { data: itemRows, error: itemsError } = await supabase
      .from("engagement_items")
      .select("id, body, title, category_id, latitude, longitude")
      .eq("campaign_id", campaignId)
      .eq("status", "approved")
      .order("created_at", { ascending: true })
      .limit(SYNTHESIS_MAX_ITEMS);
    if (itemsError) {
      return NextResponse.json({ error: "Failed to load engagement items" }, { status: 500 });
    }

    const { data: categoryRows, error: categoriesError } = await supabase
      .from("engagement_categories")
      .select("id, label")
      .eq("campaign_id", campaignId);
    if (categoriesError) {
      return NextResponse.json({ error: "Failed to load categories" }, { status: 500 });
    }

    const labelById = new Map<string, string | null>(
      (categoryRows ?? []).map((c: CategoryRow) => [c.id, c.label])
    );
    const items: SynthesisItem[] = (itemRows ?? []).map((row: ItemRow) => ({
      id: row.id,
      body: row.body,
      title: row.title,
      category_label: row.category_id ? labelById.get(row.category_id) ?? null : null,
      latitude: row.latitude,
      longitude: row.longitude,
    }));

    const synthesis = await generateEngagementSynthesis(items);

    if (synthesis.source === "ai") {
      await recordUsageEventBestEffort(
        {
          workspaceId,
          eventKey: "engagement_synthesis",
          bucketKey: "engagement_synthesis",
          sourceRoute: "/api/engagement/campaigns/[campaignId]/synthesis",
          metadata: { campaignId, model: synthesis.model, itemCount: synthesis.item_count },
        },
        audit
      );
    }

    const synthesizedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("engagement_campaigns")
      .update({ ai_synthesis_json: synthesis, ai_synthesized_at: synthesizedAt })
      .eq("id", campaignId);
    if (updateError) {
      // Persist failure shouldn't lose the computed synthesis — return it anyway.
      audit.warn("engagement_synthesis_persist_failed", { campaignId, message: updateError.message });
    }

    return NextResponse.json({ synthesis, synthesizedAt });
  } catch (error) {
    audit.error("engagement_synthesis_unhandled", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to synthesize engagement" }, { status: 500 });
  }
}
