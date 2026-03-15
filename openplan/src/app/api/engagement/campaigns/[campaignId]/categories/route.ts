import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { makeEngagementCategorySlug } from "@/lib/engagement/catalog";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
});

const createCategorySchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const DUPLICATE_KEY_CODE = "23505";

type RouteContext = {
  params: Promise<{ campaignId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.categories.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = createCategorySchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid category payload" }, { status: 400 });
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

    const { data: category, error: insertError } = await supabase
      .from("engagement_categories")
      .insert({
        campaign_id: access.campaign.id,
        label: parsed.data.label.trim(),
        slug: makeEngagementCategorySlug(parsed.data.label),
        description: parsed.data.description?.trim() || null,
        sort_order: parsed.data.sortOrder ?? 0,
        created_by: user.id,
      })
      .select("id, campaign_id, label, slug, description, sort_order, created_at, updated_at")
      .single();

    if (insertError || !category) {
      if (insertError?.code === DUPLICATE_KEY_CODE) {
        return NextResponse.json({ error: "A category with that label already exists" }, { status: 409 });
      }

      audit.error("category_insert_failed", {
        campaignId: access.campaign.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create engagement category" }, { status: 500 });
    }

    audit.info("category_created", {
      userId: user.id,
      campaignId: access.campaign.id,
      categoryId: category.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ categoryId: category.id, category }, { status: 201 });
  } catch (error) {
    audit.error("category_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating engagement category" }, { status: 500 });
  }
}
