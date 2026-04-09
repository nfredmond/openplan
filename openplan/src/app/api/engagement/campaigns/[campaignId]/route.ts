import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, loadProjectAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES } from "@/lib/engagement/catalog";
import { normalizeShareToken } from "@/lib/engagement/public-portal";
import { summarizeEngagementItems } from "@/lib/engagement/summary";

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
    rtpCycleId: z.union([z.string().uuid(), z.null()]).optional(),
    rtpCycleChapterId: z.union([z.string().uuid(), z.null()]).optional(),
    shareToken: z
      .union([z.string().trim().min(8).max(64).regex(/^[a-zA-Z0-9_-]+$/), z.null()])
      .optional(),
    publicDescription: z.union([z.string().trim().max(4000), z.null()]).optional(),
    allowPublicSubmissions: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.rtpCycleChapterId && value.rtpCycleId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rtpCycleId"],
        message: "An RTP chapter target requires an RTP cycle target.",
      });
    }
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

    const [
      { data: project, error: projectError },
      { data: categories, error: categoriesError },
      { data: items, error: itemsError },
      { data: reports, error: reportsError },
    ] =
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
        access.campaign.project_id
          ? supabase
              .from("reports")
              .select("id, project_id, title, report_type, status, generated_at, updated_at")
              .eq("project_id", access.campaign.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
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

    if (reportsError) {
      audit.error("campaign_reports_lookup_failed", {
        campaignId: access.campaign.id,
        projectId: access.campaign.project_id,
        message: reportsError.message,
        code: reportsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked reports" }, { status: 500 });
    }

    const categoryMap = new Map((categories ?? []).map((category) => [category.id, category]));
    const counts = summarizeEngagementItems(categories ?? [], items ?? []);

    return NextResponse.json(
      {
        campaign: access.campaign,
        project,
        categories,
        recentItems: (items ?? []).slice(0, 8).map((item) => ({
          ...item,
          category: item.category_id ? categoryMap.get(item.category_id) ?? null : null,
        })),
        linkedReports: reports ?? [],
        counts,
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

    let nextRtpCycleId = access.campaign.rtp_cycle_id ?? null;
    if (parsed.data.rtpCycleId !== undefined) {
      if (parsed.data.rtpCycleId === null) {
        nextRtpCycleId = null;
      } else {
        const { data: cycle, error: cycleError } = await supabase
          .from("rtp_cycles")
          .select("id, workspace_id")
          .eq("id", parsed.data.rtpCycleId)
          .maybeSingle();

        if (cycleError) {
          audit.error("campaign_patch_rtp_cycle_access_failed", {
            campaignId: access.campaign.id,
            rtpCycleId: parsed.data.rtpCycleId,
            message: cycleError.message,
            code: cycleError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to verify RTP cycle target" }, { status: 500 });
        }

        if (!cycle || cycle.workspace_id !== access.campaign.workspace_id) {
          return NextResponse.json({ error: "RTP cycle not found in this workspace" }, { status: 404 });
        }

        nextRtpCycleId = cycle.id;
      }
    }

    let nextRtpCycleChapterId = access.campaign.rtp_cycle_chapter_id ?? null;
    if (parsed.data.rtpCycleChapterId !== undefined) {
      if (parsed.data.rtpCycleChapterId === null) {
        nextRtpCycleChapterId = null;
      } else {
        const { data: chapter, error: chapterError } = await supabase
          .from("rtp_cycle_chapters")
          .select("id, workspace_id, rtp_cycle_id")
          .eq("id", parsed.data.rtpCycleChapterId)
          .maybeSingle();

        if (chapterError) {
          audit.error("campaign_patch_rtp_chapter_access_failed", {
            campaignId: access.campaign.id,
            rtpCycleChapterId: parsed.data.rtpCycleChapterId,
            message: chapterError.message,
            code: chapterError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to verify RTP chapter target" }, { status: 500 });
        }

        if (!chapter || chapter.workspace_id !== access.campaign.workspace_id) {
          return NextResponse.json({ error: "RTP chapter not found in this workspace" }, { status: 404 });
        }

        if (nextRtpCycleId && chapter.rtp_cycle_id !== nextRtpCycleId) {
          return NextResponse.json({ error: "RTP chapter does not belong to the selected RTP cycle" }, { status: 400 });
        }

        nextRtpCycleId = chapter.rtp_cycle_id;
        nextRtpCycleChapterId = chapter.id;
      }
    }

    if (nextProjectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", nextProjectId)
        .maybeSingle();
      if (!project || project.workspace_id !== access.campaign.workspace_id) {
        return NextResponse.json({ error: "Project not found in this workspace" }, { status: 404 });
      }
    }

    const nextShareToken =
      parsed.data.shareToken !== undefined ? normalizeShareToken(parsed.data.shareToken) : undefined;

    if (nextShareToken && nextShareToken !== normalizeShareToken(access.campaign.share_token)) {
      const { data: existingShareTokenCampaign, error: shareTokenLookupError } = await supabase
        .from("engagement_campaigns")
        .select("id")
        .eq("share_token", nextShareToken)
        .maybeSingle();

      if (shareTokenLookupError) {
        audit.error("campaign_share_token_lookup_failed", {
          campaignId: access.campaign.id,
          shareToken: nextShareToken,
          message: shareTokenLookupError.message,
          code: shareTokenLookupError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify share token availability" }, { status: 500 });
      }

      if (existingShareTokenCampaign && existingShareTokenCampaign.id !== access.campaign.id) {
        return NextResponse.json(
          { error: "That share token is already in use by another engagement campaign" },
          { status: 409 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.summary !== undefined) updates.summary = parsed.data.summary;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.engagementType !== undefined) updates.engagement_type = parsed.data.engagementType;
    if (parsed.data.projectId !== undefined) updates.project_id = nextProjectId;
    if (parsed.data.rtpCycleId !== undefined || parsed.data.rtpCycleChapterId !== undefined) {
      updates.rtp_cycle_id = nextRtpCycleId;
      updates.rtp_cycle_chapter_id = nextRtpCycleChapterId;
    }
    if (parsed.data.shareToken !== undefined) updates.share_token = nextShareToken;
    if (parsed.data.publicDescription !== undefined) updates.public_description = parsed.data.publicDescription;
    if (parsed.data.allowPublicSubmissions !== undefined) updates.allow_public_submissions = parsed.data.allowPublicSubmissions;

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
