import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_ITEM_SOURCE_TYPES, ENGAGEMENT_ITEM_STATUSES } from "@/lib/engagement/catalog";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const patchItemSchema = z
  .object({
    categoryId: z.union([z.string().uuid(), z.null()]).optional(),
    title: z.union([z.string().trim().max(160), z.null()]).optional(),
    body: z.string().trim().min(1).max(8000).optional(),
    submittedBy: z.union([z.string().trim().max(200), z.null()]).optional(),
    status: z.enum(ENGAGEMENT_ITEM_STATUSES).optional(),
    sourceType: z.enum(ENGAGEMENT_ITEM_SOURCE_TYPES).optional(),
    latitude: z.union([z.number().min(-90).max(90), z.null()]).optional(),
    longitude: z.union([z.number().min(-180).max(180), z.null()]).optional(),
    metadata: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
    moderationNotes: z.union([z.string().trim().max(2000), z.null()]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ campaignId: string; itemId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.items.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign item route params" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchItemSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid engagement item update payload" }, { status: 400 });
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

    const { data: existingItem, error: itemLookupError } = await supabase
      .from("engagement_items")
      .select("id, campaign_id, category_id")
      .eq("id", parsedParams.data.itemId)
      .eq("campaign_id", access.campaign.id)
      .maybeSingle();

    if (itemLookupError) {
      audit.error("item_lookup_failed", {
        campaignId: access.campaign.id,
        itemId: parsedParams.data.itemId,
        message: itemLookupError.message,
        code: itemLookupError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement item" }, { status: 500 });
    }

    if (!existingItem) {
      return NextResponse.json({ error: "Engagement item not found" }, { status: 404 });
    }

    const nextCategoryId = parsed.data.categoryId === undefined ? existingItem.category_id : parsed.data.categoryId;
    const { category, error: categoryError } = await validateCampaignCategoryAccess(
      supabase,
      access.campaign.id,
      nextCategoryId
    );

    if (categoryError) {
      audit.error("item_category_lookup_failed", {
        campaignId: access.campaign.id,
        itemId: existingItem.id,
        categoryId: nextCategoryId,
        message: categoryError.message,
        code: categoryError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify engagement category" }, { status: 500 });
    }

    if (nextCategoryId && !category) {
      return NextResponse.json({ error: "Engagement category not found for this campaign" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.categoryId !== undefined) updates.category_id = parsed.data.categoryId;
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.body !== undefined) updates.body = parsed.data.body;
    if (parsed.data.submittedBy !== undefined) updates.submitted_by = parsed.data.submittedBy;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.sourceType !== undefined) updates.source_type = parsed.data.sourceType;
    if (parsed.data.latitude !== undefined) updates.latitude = parsed.data.latitude;
    if (parsed.data.longitude !== undefined) updates.longitude = parsed.data.longitude;
    if (parsed.data.metadata !== undefined) updates.metadata_json = parsed.data.metadata ?? {};
    if (parsed.data.moderationNotes !== undefined) updates.moderation_notes = parsed.data.moderationNotes;

    const { error: updateError } = await supabase.from("engagement_items").update(updates).eq("id", existingItem.id);

    if (updateError) {
      audit.error("item_update_failed", {
        campaignId: access.campaign.id,
        itemId: existingItem.id,
        message: updateError.message,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update engagement item" }, { status: 500 });
    }

    audit.info("item_updated", {
      userId: user.id,
      campaignId: access.campaign.id,
      itemId: existingItem.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, itemId: existingItem.id }, { status: 200 });
  } catch (error) {
    audit.error("item_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating engagement item" }, { status: 500 });
  }
}
