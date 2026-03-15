import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, loadProjectAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES } from "@/lib/engagement/catalog";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
});

const patchCampaignSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.union([z.string().trim().max(2000), z.null()]).optional(),
    status: z.enum(ENGAGEMENT_CAMPAIGN_STATUSES).optional(),
    engagementType: z.enum(ENGAGEMENT_TYPES).optional(),
    projectId: z.union([z.string().uuid(), z.null()]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ campaignId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadCampaignAccess(supabase, parsedParams.data.campaignId, user.id, "engagement.read");

    if (access.error) {
      audit.error("campaign_access_failed", {
        campaignId: parsedParams.data.campaignId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement campaign" }, { status: 500 });
    }

    if (!access.campaign) {
      return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const [{ data: project, error: projectError }, { data: categories, error: categoriesError }, { data: items, error: itemsError }] =
      await Promise.all([
        access.campaign.project_id
          ? supabase
              .from("projects")
              .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
              .eq("id", access.campaign.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("engagement_categories")
          .select("id, campaign_id, label, slug, description, sort_order, created_at, updated_at")
          .eq("campaign_id", access.campaign.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("engagement_items")
          .select(
            "id, campaign_id, category_id, title, body, submitted_by, status, source_type, latitude, longitude, metadata_json, moderation_notes, created_at, updated_at"
          )
          .eq("campaign_id", access.campaign.id)
          .order("updated_at", { ascending: false }),
      ]);

    if (projectError) {
      audit.error("campaign_project_lookup_failed", {
        campaignId: access.campaign.id,
        message: projectError.message,
        code: projectError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked project" }, { status: 500 });
    }

    if (categoriesError) {
      audit.error("campaign_categories_lookup_failed", {
        campaignId: access.campaign.id,
        message: categoriesError.message,
        code: categoriesError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement categories" }, { status: 500 });
    }

    if (itemsError) {
      audit.error("campaign_items_lookup_failed", {
        campaignId: access.campaign.id,
        message: itemsError.message,
        code: itemsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement items" }, { status: 500 });
    }

    const categoryMap = new Map((categories ?? []).map((category) => [category.id, category]));
    const statusCounts = { pending: 0, approved: 0, rejected: 0, flagged: 0 } as Record<string, number>;
    const categoryCounts = new Map<string, number>();
    let geolocatedCount = 0;

    for (const item of items ?? []) {
      statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
      if (item.category_id) {
        categoryCounts.set(item.category_id, (categoryCounts.get(item.category_id) ?? 0) + 1);
      }
      if (typeof item.latitude === "number" && typeof item.longitude === "number") {
        geolocatedCount += 1;
      }
    }

    return NextResponse.json(
      {
        campaign: access.campaign,
        project,
        categories,
        recentItems: (items ?? []).slice(0, 8).map((item) => ({
          ...item,
          category: item.category_id ? categoryMap.get(item.category_id) ?? null : null,
        })),
        counts: {
          totalItems: (items ?? []).length,
          geolocatedItems: geolocatedCount,
          statusCounts,
          categoryCounts: (categories ?? []).map((category) => ({
            categoryId: category.id,
            label: category.label,
            count: categoryCounts.get(category.id) ?? 0,
          })),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("campaign_detail_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading engagement campaign" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchCampaignSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid campaign update payload" }, { status: 400 });
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

    let nextProjectId = access.campaign.project_id;
    if (parsed.data.projectId !== undefined) {
      if (parsed.data.projectId === null) {
        nextProjectId = null;
      } else {
        const projectAccess = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "engagement.write");
        if (projectAccess.error) {
          audit.error("campaign_patch_project_access_failed", {
            campaignId: access.campaign.id,
            projectId: parsed.data.projectId,
            message: projectAccess.error.message,
            code: projectAccess.error.code ?? null,
          });
          return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
        }

        if (!projectAccess.project) {
          return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        if (!projectAccess.allowed || projectAccess.project.workspace_id !== access.campaign.workspace_id) {
          return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
        }

        nextProjectId = projectAccess.project.id;
      }
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.summary !== undefined) updates.summary = parsed.data.summary;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.engagementType !== undefined) updates.engagement_type = parsed.data.engagementType;
    if (parsed.data.projectId !== undefined) updates.project_id = nextProjectId;

    const { error: updateError } = await supabase.from("engagement_campaigns").update(updates).eq("id", access.campaign.id);

    if (updateError) {
      audit.error("campaign_update_failed", {
        campaignId: access.campaign.id,
        message: updateError.message,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update engagement campaign" }, { status: 500 });
    }

    audit.info("campaign_updated", {
      userId: user.id,
      campaignId: access.campaign.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, campaignId: access.campaign.id }, { status: 200 });
  } catch (error) {
    audit.error("campaign_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating engagement campaign" }, { status: 500 });
  }
}
