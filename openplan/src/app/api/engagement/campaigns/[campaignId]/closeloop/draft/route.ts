import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { generateEngagementSynthesis, SYNTHESIS_MAX_ITEMS, type SynthesisItem } from "@/lib/engagement/ai-synthesis";
import { buildCloseLoopDraftsFromSynthesis } from "@/lib/engagement/close-loop";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

type RouteContext = { params: Promise<{ campaignId: string }> };

type ApprovedItemRow = {
  id: string;
  body: string | null;
  title: string | null;
  category_id: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Generate DRAFT "you said" close-loop entries from approved engagement items,
 * reusing the engagement synthesis engine. Does NOT persist anything — the
 * operator reviews, edits, adds the "we did" side, and explicitly creates/publishes.
 * Runs at $0: with no ANTHROPIC_API_KEY the synthesis engine returns an honest
 * deterministic-fallback (source is surfaced so the UI can label it).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.closeloop.draft", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const [{ data: itemsData }, { data: categoriesData }] = await Promise.all([
      supabase
        .from("engagement_items")
        .select("id, body, title, category_id, latitude, longitude")
        .eq("campaign_id", access.campaign.id)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(SYNTHESIS_MAX_ITEMS),
      supabase.from("engagement_categories").select("id, label").eq("campaign_id", access.campaign.id),
    ]);

    const categoryLabelById = new Map<string, string>();
    for (const category of (categoriesData ?? []) as { id: string; label: string }[]) {
      categoryLabelById.set(category.id, category.label);
    }

    const items: SynthesisItem[] = ((itemsData ?? []) as ApprovedItemRow[]).map((item) => ({
      id: item.id,
      body: item.body,
      title: item.title,
      category_label: item.category_id ? categoryLabelById.get(item.category_id) ?? null : null,
      latitude: item.latitude,
      longitude: item.longitude,
    }));

    const synthesis = await generateEngagementSynthesis(items);
    const drafts = buildCloseLoopDraftsFromSynthesis(synthesis);

    return NextResponse.json({
      drafts,
      source: synthesis.source, // "ai" | "deterministic-fallback"
      model: synthesis.model,
      fallbackReason: synthesis.fallback_reason,
      itemCount: synthesis.item_count,
      analyzedItemCount: synthesis.analyzed_item_count,
      caveat: synthesis.caveat,
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while drafting close-loop entries" }, { status: 500 });
  }
}
