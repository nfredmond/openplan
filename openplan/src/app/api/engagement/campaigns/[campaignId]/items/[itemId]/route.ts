import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_ITEM_SOURCE_TYPES, ENGAGEMENT_ITEM_STATUSES } from "@/lib/engagement/catalog";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const patchItemSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    removePhoto: z.boolean().optional(),
    removeGeometry: z.boolean().optional(),
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

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
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
      .select("id, campaign_id, category_id, updated_at, status, source_type, title, body, submitted_by, photo_path, geometry, latitude, longitude")
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

    if (existingItem.updated_at !== parsed.data.expectedUpdatedAt) {
      return NextResponse.json({ error: "This contribution changed since you opened it. Refresh and review the current version." }, { status: 409 });
    }
    const changesPublicCopy = (parsed.data.categoryId !== undefined && parsed.data.categoryId !== existingItem.category_id)
      || (parsed.data.sourceType !== undefined && parsed.data.sourceType !== existingItem.source_type)
      || (parsed.data.body !== undefined && parsed.data.body !== existingItem.body)
      || (parsed.data.title !== undefined && parsed.data.title !== existingItem.title)
      || (parsed.data.submittedBy !== undefined && parsed.data.submittedBy !== existingItem.submitted_by)
      || parsed.data.removePhoto || parsed.data.removeGeometry
      || (parsed.data.latitude !== undefined && parsed.data.latitude !== existingItem.latitude)
      || (parsed.data.longitude !== undefined && parsed.data.longitude !== existingItem.longitude);
    if ((changesPublicCopy || (parsed.data.status !== undefined && parsed.data.status !== existingItem.status)) && !parsed.data.moderationNotes?.trim()) {
      return NextResponse.json({ error: "Record a review reason before changing the public copy or moderation state." }, { status: 400 });
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

    const updates: Record<string, unknown> = { review_expected_updated_at: parsed.data.expectedUpdatedAt, review_reason: parsed.data.moderationNotes ?? null };
    if (parsed.data.removePhoto) updates.photo_path = null;
    if (parsed.data.categoryId !== undefined) updates.category_id = parsed.data.categoryId;
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.body !== undefined) updates.body = parsed.data.body;
    if (parsed.data.submittedBy !== undefined) updates.submitted_by = parsed.data.submittedBy;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.sourceType !== undefined) updates.source_type = parsed.data.sourceType;
    if (parsed.data.latitude !== undefined) updates.latitude = parsed.data.latitude;
    if (parsed.data.longitude !== undefined) updates.longitude = parsed.data.longitude;
    if (parsed.data.removeGeometry) { updates.geometry = null; updates.latitude = null; updates.longitude = null; }
    else if (updates.latitude !== undefined || updates.longitude !== undefined) {
      const lat = parsed.data.latitude === undefined ? existingItem.latitude : parsed.data.latitude;
      const lon = parsed.data.longitude === undefined ? existingItem.longitude : parsed.data.longitude;
      const moved = lat !== existingItem.latitude || lon !== existingItem.longitude;
      if (moved && existingItem.geometry && existingItem.geometry.type !== "Point") return NextResponse.json({ error: "A route or area cannot be moved by changing its representative point. Withhold its drawing if the location should be removed." }, { status: 400 });
      if (moved) {
        if ((lat === null) !== (lon === null)) return NextResponse.json({ error: "Provide both coordinates or withhold the drawing." }, { status: 400 });
        updates.geometry = lat !== null && lon !== null ? { type: "Point", coordinates: [lon, lat] } : null;
      }
    }
    if (parsed.data.metadata !== undefined) updates.metadata_json = parsed.data.metadata ?? {};
    if (parsed.data.moderationNotes !== undefined) updates.moderation_notes = parsed.data.moderationNotes;

    const { data: changed, error: updateError } = await supabase.from("engagement_items").update(updates)
      .eq("id", existingItem.id).eq("campaign_id", access.campaign.id)
      .eq("updated_at", parsed.data.expectedUpdatedAt).select("id, updated_at").maybeSingle();

    if (updateError?.code === "40001") return NextResponse.json({ error: "Another reviewer changed this contribution. Refresh before reviewing again." }, { status: 409 });

    if (isWriteFailure(updateError)) {
      audit.error("item_update_failed", {
        campaignId: access.campaign.id,
        itemId: existingItem.id,
        message: updateError?.message,
        code: updateError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update engagement item" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data: changed, error: updateError })) return NextResponse.json({ error: "Another reviewer changed this contribution. Refresh before reviewing again." }, { status: 409 });

    audit.info("item_updated", {
      userId: user.id,
      campaignId: access.campaign.id,
      itemId: existingItem.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, itemId: existingItem.id, updatedAt: changed!.updated_at }, { status: 200 });
  } catch (error) {
    audit.error("item_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating engagement item" }, { status: 500 });
  }
}
