import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { checkAiUsageRateLimit } from "@/lib/billing/ai-rate-limit";
import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";
import { MODERATION_MAX_ITEMS, moderateEngagementItems, type ModerationInputItem } from "@/lib/engagement/ai-moderation";

const paramsSchema = z.object({ campaignId: z.string().uuid() });
type RouteContext = { params: Promise<{ campaignId: string }> };

type ItemRow = {
  id: string;
  title: string | null;
  body: string;
  metadata_json: Record<string, unknown> | null;
};

/**
 * POST — run a Claude moderation ASSIST pass over a campaign's pending/flagged
 * comments and store an explainable per-item assessment in metadata_json.
 * ai_moderation. Auth: workspace member with `engagement.write`. AI-offline safe
 * (the lib returns a deterministic fallback, so this is 200 even with no key; the
 * `source` field says which ran). It NEVER changes an item's moderation status —
 * a human still decides.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.moderation_scan.post", request);

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
      audit.warn("engagement_moderation_rate_limited", { workspaceId, recentCount: rateLimit.count });
      return NextResponse.json(
        { error: "Too many AI requests in a short window. Please wait a moment and try again." },
        { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
      );
    }

    // The moderation queue: items still awaiting a human decision.
    const { data: itemRows, error: itemsError } = await supabase
      .from("engagement_items")
      .select("id, title, body, metadata_json")
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "flagged"])
      .order("created_at", { ascending: true })
      .limit(MODERATION_MAX_ITEMS);
    if (itemsError) {
      return NextResponse.json({ error: "Failed to load engagement items" }, { status: 500 });
    }

    const rows = (itemRows ?? []) as ItemRow[];
    const items: ModerationInputItem[] = rows.map((row) => ({ id: row.id, title: row.title, body: row.body }));
    const result = await moderateEngagementItems(items);

    // Persist the per-item assessment into metadata_json (merged, never
    // overwriting other keys). Does NOT change status — a human still decides.
    const assessmentAt = new Date().toISOString();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const writeErrors = await Promise.all(
      result.items.map(async (assessment) => {
        const row = byId.get(assessment.item_id);
        if (!row) return null;
        const metadata = {
          ...(row.metadata_json ?? {}),
          ai_moderation: {
            flags: assessment.flags,
            severity: assessment.severity,
            rationale: assessment.rationale,
            suggested_action: assessment.suggested_action,
            source: result.source,
            model: result.model,
            at: assessmentAt,
          },
        };
        const { error } = await supabase
          .from("engagement_items")
          .update({ metadata_json: metadata })
          .eq("id", assessment.item_id);
        return error ? assessment.item_id : null;
      })
    );
    const failed = writeErrors.filter(Boolean);
    if (failed.length > 0) {
      audit.warn("engagement_moderation_persist_partial", { campaignId, failedCount: failed.length });
    }

    if (result.source === "ai") {
      await recordUsageEventBestEffort(
        {
          workspaceId,
          eventKey: "engagement_moderation",
          bucketKey: "engagement_synthesis",
          sourceRoute: "/api/engagement/campaigns/[campaignId]/moderation-scan",
          metadata: { campaignId, model: result.model, itemCount: result.item_count },
        },
        audit
      );
    }

    return NextResponse.json({ moderation: result, scannedAt: assessmentAt });
  } catch (error) {
    audit.error("engagement_moderation_unhandled", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to run moderation scan" }, { status: 500 });
  }
}
