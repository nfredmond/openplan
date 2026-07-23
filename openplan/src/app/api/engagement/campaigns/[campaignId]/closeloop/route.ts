import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { CLOSE_LOOP_ENTRY_COLUMNS, loadCloseLoopEntries } from "@/lib/engagement/close-loop";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

const CLOSE_LOOP_TEXT_MAX = 5000;

const createEntrySchema = z.object({
  themeTitle: z.string().trim().min(1).max(200),
  youSaid: z.string().trim().max(CLOSE_LOOP_TEXT_MAX).optional(),
  weDid: z.string().trim().max(CLOSE_LOOP_TEXT_MAX).optional(),
  categoryId: z.string().uuid().optional(),
  sourceItemIds: z.array(z.string().uuid()).max(300).optional(),
  aiAssisted: z.boolean().optional(),
  status: z.enum(["draft", "published"]).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

type RouteContext = { params: Promise<{ campaignId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.closeloop.list", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const entries = await loadCloseLoopEntries(supabase, access.campaign.id);
    return NextResponse.json({ entries });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while listing close-loop entries" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.closeloop.create", request);
  const startedAt = Date.now();
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createEntrySchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid close-loop entry payload", issues: parsed.error.issues }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    if (parsed.data.categoryId) {
      const categoryAccess = await validateCampaignCategoryAccess(supabase, access.campaign.id, parsed.data.categoryId);
      if (categoryAccess.error || !categoryAccess.category) {
        return NextResponse.json({ error: "Category does not belong to this campaign" }, { status: 400 });
      }
    }

    const { data: entry, error: insertError } = await supabase
      .from("engagement_closeloop_entries")
      .insert({
        campaign_id: access.campaign.id,
        category_id: parsed.data.categoryId ?? null,
        theme_title: parsed.data.themeTitle,
        you_said: parsed.data.youSaid?.trim() || "",
        we_did: parsed.data.weDid?.trim() || "",
        status: parsed.data.status ?? "draft",
        ai_assisted: parsed.data.aiAssisted ?? false,
        source_item_ids: parsed.data.sourceItemIds ?? [],
        sort_order: parsed.data.sortOrder ?? 0,
        created_by: user.id,
      })
      .select(CLOSE_LOOP_ENTRY_COLUMNS)
      .single();

    if (insertError || !entry) {
      audit.error("entry_insert_failed", { campaignId: access.campaign.id, message: insertError?.message ?? "unknown", code: insertError?.code ?? null });
      return NextResponse.json({ error: "Failed to create close-loop entry" }, { status: 500 });
    }

    audit.info("entry_created", { userId: user.id, campaignId: access.campaign.id, entryId: entry.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({ entryId: entry.id, entry }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while creating close-loop entry" }, { status: 500 });
  }
}
