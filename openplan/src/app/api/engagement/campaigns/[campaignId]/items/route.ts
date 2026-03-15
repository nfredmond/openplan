import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_ITEM_SOURCE_TYPES, ENGAGEMENT_ITEM_STATUSES } from "@/lib/engagement/catalog";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
});

const createItemSchema = z.object({
  categoryId: z.string().uuid().optional(),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(8000),
  submittedBy: z.string().trim().max(200).optional(),
  status: z.enum(ENGAGEMENT_ITEM_STATUSES).optional(),
  sourceType: z.enum(ENGAGEMENT_ITEM_SOURCE_TYPES).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  moderationNotes: z.string().trim().max(2000).optional(),
});

type RouteContext = {
  params: Promise<{ campaignId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.items.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = createItemSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid engagement item payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadCampaignAccess(supabase, parsedParams.data.campaignId, user.id, "engagement.write");

    if (access.error) {
      audit.error("campaign_access_failed", {
        campaignId: parsedParams.data.campaignId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    }

    if (!access.campaign) {
      return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { category, error: categoryError } = await validateCampaignCategoryAccess(
      supabase,
      access.campaign.id,
      parsed.data.categoryId
    );

    if (categoryError) {
      audit.error("item_category_lookup_failed", {
        campaignId: access.campaign.id,
        categoryId: parsed.data.categoryId ?? null,
        message: categoryError.message,
        code: categoryError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify engagement category" }, { status: 500 });
    }

    if (parsed.data.categoryId && !category) {
      return NextResponse.json({ error: "Engagement category not found for this campaign" }, { status: 400 });
    }

    const { data: item, error: insertError } = await supabase
      .from("engagement_items")
      .insert({
        campaign_id: access.campaign.id,
        category_id: parsed.data.categoryId ?? null,
        title: parsed.data.title?.trim() || null,
        body: parsed.data.body.trim(),
        submitted_by: parsed.data.submittedBy?.trim() || null,
        status: parsed.data.status ?? "pending",
        source_type: parsed.data.sourceType ?? "internal",
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
        metadata_json: parsed.data.metadata ?? {},
        moderation_notes: parsed.data.moderationNotes?.trim() || null,
        created_by: user.id,
      })
      .select(
        "id, campaign_id, category_id, title, body, submitted_by, status, source_type, latitude, longitude, metadata_json, moderation_notes, created_at, updated_at"
      )
      .single();

    if (insertError || !item) {
      audit.error("item_insert_failed", {
        campaignId: access.campaign.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create engagement item" }, { status: 500 });
    }

    audit.info("item_created", {
      userId: user.id,
      campaignId: access.campaign.id,
      itemId: item.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ itemId: item.id, item }, { status: 201 });
  } catch (error) {
    audit.error("item_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating engagement item" }, { status: 500 });
  }
}
