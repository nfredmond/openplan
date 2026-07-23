import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { CLOSE_LOOP_ENTRY_COLUMNS } from "@/lib/engagement/close-loop";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ campaignId: z.string().uuid(), entryId: z.string().uuid() });

const CLOSE_LOOP_TEXT_MAX = 5000;

const updateEntrySchema = z
  .object({
    themeTitle: z.string().trim().min(1).max(200).optional(),
    youSaid: z.string().trim().max(CLOSE_LOOP_TEXT_MAX).optional(),
    weDid: z.string().trim().max(CLOSE_LOOP_TEXT_MAX).optional(),
    // null clears the theme tag.
    categoryId: z.string().uuid().nullable().optional(),
    status: z.enum(["draft", "published"]).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "No fields to update");

type RouteContext = { params: Promise<{ campaignId: string; entryId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.closeloop.update", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid identifiers" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = updateEntrySchema.safeParse(payloadBody.data);
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

    const updates: Record<string, unknown> = {};
    if (parsed.data.themeTitle !== undefined) updates.theme_title = parsed.data.themeTitle;
    if (parsed.data.youSaid !== undefined) updates.you_said = parsed.data.youSaid;
    if (parsed.data.weDid !== undefined) updates.we_did = parsed.data.weDid;
    if (parsed.data.categoryId !== undefined) updates.category_id = parsed.data.categoryId; // may be null
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;

    // Double-scope the write: the row id AND its campaign_id must match, so a
    // member of one workspace can never patch another campaign's entry by id.
    const { data: entry, error: updateError } = await supabase
      .from("engagement_closeloop_entries")
      .update(updates)
      .eq("id", routeParams.data.entryId)
      .eq("campaign_id", access.campaign.id)
      .select(CLOSE_LOOP_ENTRY_COLUMNS)
      .maybeSingle();

    if (updateError) {
      audit.error("entry_update_failed", { campaignId: access.campaign.id, entryId: routeParams.data.entryId, message: updateError.message });
      return NextResponse.json({ error: "Failed to update close-loop entry" }, { status: 500 });
    }
    if (!entry) return NextResponse.json({ error: "Close-loop entry not found" }, { status: 404 });

    audit.info("entry_updated", { userId: user.id, campaignId: access.campaign.id, entryId: entry.id });
    return NextResponse.json({ entry });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while updating close-loop entry" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.closeloop.delete", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid identifiers" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const { error: deleteError } = await supabase
      .from("engagement_closeloop_entries")
      .delete()
      .eq("id", routeParams.data.entryId)
      .eq("campaign_id", access.campaign.id);

    if (deleteError) {
      audit.error("entry_delete_failed", { campaignId: access.campaign.id, entryId: routeParams.data.entryId, message: deleteError.message });
      return NextResponse.json({ error: "Failed to delete close-loop entry" }, { status: 500 });
    }

    audit.info("entry_deleted", { userId: user.id, campaignId: access.campaign.id, entryId: routeParams.data.entryId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while deleting close-loop entry" }, { status: 500 });
  }
}
