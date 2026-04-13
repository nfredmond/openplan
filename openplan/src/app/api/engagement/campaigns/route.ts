import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES } from "@/lib/engagement/catalog";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

const listCampaignsSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(ENGAGEMENT_CAMPAIGN_STATUSES).optional(),
});

const createCampaignSchema = z.object({
  projectId: z.string().uuid().optional(),
  rtpCycleId: z.string().uuid().optional(),
  rtpCycleChapterId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  engagementType: z.enum(ENGAGEMENT_TYPES).optional(),
  status: z.enum(ENGAGEMENT_CAMPAIGN_STATUSES).optional(),
}).superRefine((value, context) => {
  if (value.rtpCycleChapterId && !value.rtpCycleId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rtpCycleId"],
      message: "An RTP chapter target requires an RTP cycle target.",
    });
  }
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("engagement.campaigns.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listCampaignsSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    });

    if (!parsedFilters.success) {
      audit.warn("validation_failed", { issues: parsedFilters.error.issues });
      return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let query = supabase
      .from("engagement_campaigns")
      .select(
        "id, workspace_id, project_id, rtp_cycle_id, rtp_cycle_chapter_id, title, summary, status, engagement_type, created_at, updated_at, projects(id, name), workspaces(name)"
      )
      .order("updated_at", { ascending: false });

    if (parsedFilters.data.projectId) {
      query = query.eq("project_id", parsedFilters.data.projectId);
    }

    if (parsedFilters.data.status) {
      query = query.eq("status", parsedFilters.data.status);
    }

    const { data, error } = await query;

    if (error) {
      audit.error("campaign_list_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load engagement campaigns" }, { status: 500 });
    }

    const campaigns = data ?? [];
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const itemsResult = campaignIds.length
      ? await supabase
          .from("engagement_items")
          .select("id, campaign_id, status, category_id, source_type, latitude, longitude, moderation_notes, created_at, updated_at")
          .in("campaign_id", campaignIds)
      : { data: [], error: null };

    if (itemsResult.error) {
      audit.error("campaign_item_summary_failed", {
        message: itemsResult.error.message,
        code: itemsResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to summarize engagement items" }, { status: 500 });
    }

    const itemsByCampaign = new Map<string, Array<(typeof itemsResult.data)[number]>>();
    for (const item of itemsResult.data ?? []) {
      const current = itemsByCampaign.get(item.campaign_id) ?? [];
      current.push(item);
      itemsByCampaign.set(item.campaign_id, current);
    }

    audit.info("campaign_list_loaded", {
      userId: user.id,
      count: campaigns.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        campaigns: campaigns.map((campaign) => ({
          ...campaign,
          counts: summarizeEngagementItems([], itemsByCampaign.get(campaign.id) ?? []),
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("campaign_list_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading engagement campaigns" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("engagement.campaigns.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createCampaignSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let workspaceId: string | null = null;
    let nextRtpCycleId: string | null = null;
    let nextRtpCycleChapterId: string | null = null;

    if (parsed.data.projectId) {
      const access = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "engagement.write");

      if (access.error) {
        audit.error("project_access_failed", {
          projectId: parsed.data.projectId,
          message: access.error.message,
          code: access.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
      }

      if (!access.project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }

      if (!access.allowed) {
        return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
      }

      workspaceId = access.project.workspace_id;
    }

    if (parsed.data.rtpCycleId) {
      const { data: cycle, error: cycleError } = await supabase
        .from("rtp_cycles")
        .select("id, workspace_id")
        .eq("id", parsed.data.rtpCycleId)
        .maybeSingle();

      if (cycleError) {
        audit.error("rtp_cycle_lookup_failed", {
          rtpCycleId: parsed.data.rtpCycleId,
          message: cycleError.message,
          code: cycleError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify RTP cycle target" }, { status: 500 });
      }

      if (!cycle) {
        return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
      }

      if (workspaceId && workspaceId !== cycle.workspace_id) {
        return NextResponse.json({ error: "Project and RTP cycle must belong to the same workspace" }, { status: 400 });
      }

      workspaceId = cycle.workspace_id;
      nextRtpCycleId = cycle.id;
    }

    if (parsed.data.rtpCycleChapterId) {
      const { data: chapter, error: chapterError } = await supabase
        .from("rtp_cycle_chapters")
        .select("id, workspace_id, rtp_cycle_id")
        .eq("id", parsed.data.rtpCycleChapterId)
        .maybeSingle();

      if (chapterError) {
        audit.error("rtp_chapter_lookup_failed", {
          rtpCycleChapterId: parsed.data.rtpCycleChapterId,
          message: chapterError.message,
          code: chapterError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify RTP chapter target" }, { status: 500 });
      }

      if (!chapter) {
        return NextResponse.json({ error: "RTP chapter not found" }, { status: 404 });
      }

      if (parsed.data.rtpCycleId && chapter.rtp_cycle_id !== parsed.data.rtpCycleId) {
        return NextResponse.json({ error: "RTP chapter does not belong to the selected RTP cycle" }, { status: 400 });
      }

      if (workspaceId && workspaceId !== chapter.workspace_id) {
        return NextResponse.json({ error: "Engagement targets must belong to the same workspace" }, { status: 400 });
      }

      workspaceId = chapter.workspace_id;
      nextRtpCycleId = chapter.rtp_cycle_id;
      nextRtpCycleChapterId = chapter.id;
    }

    if (!workspaceId) {
      try {
        const currentMembership = await loadCurrentWorkspaceMembership(supabase, user.id);
        const membership = currentMembership.membership;

        if (!membership || !canAccessWorkspaceAction("engagement.write", membership.role)) {
          return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
        }

        workspaceId = membership.workspace_id;
      } catch (error) {
        audit.error("workspace_membership_lookup_failed", {
          userId: user.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
      }
    } else {
      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", user.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (membershipError) {
        audit.error("workspace_membership_lookup_failed", {
          userId: user.id,
          workspaceId,
          message: membershipError.message,
          code: membershipError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
      }

      if (!membership || !canAccessWorkspaceAction("engagement.write", membership.role)) {
        return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
      }
    }

    const { data: campaign, error: insertError } = await supabase
      .from("engagement_campaigns")
      .insert({
        workspace_id: workspaceId,
        project_id: parsed.data.projectId ?? null,
        rtp_cycle_id: nextRtpCycleId,
        rtp_cycle_chapter_id: nextRtpCycleChapterId,
        title: parsed.data.title.trim(),
        summary: parsed.data.summary?.trim() || null,
        engagement_type: parsed.data.engagementType ?? "comment_collection",
        status: parsed.data.status ?? "draft",
        created_by: user.id,
      })
      .select("id, workspace_id, project_id, rtp_cycle_id, rtp_cycle_chapter_id, title, summary, status, engagement_type, created_at, updated_at")
      .single();

    if (insertError || !campaign) {
      audit.error("campaign_insert_failed", {
        userId: user.id,
        workspaceId,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create engagement campaign" }, { status: 500 });
    }

    audit.info("campaign_created", {
      userId: user.id,
      workspaceId,
      campaignId: campaign.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ campaignId: campaign.id, campaign }, { status: 201 });
  } catch (error) {
    audit.error("campaign_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating engagement campaign" }, { status: 500 });
  }
}
