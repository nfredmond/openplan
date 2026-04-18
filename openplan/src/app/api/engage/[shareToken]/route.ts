import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({
  shareToken: z.string().min(8).max(64),
});

type RouteContext = {
  params: Promise<{ shareToken: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.public_view", request);
  try {
    const routeParams = await context.params;
    const parsed = paramsSchema.safeParse(routeParams);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid share token" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("engagement_campaigns")
      .select("id, title, summary, public_description, status, engagement_type, allow_public_submissions, submissions_closed_at, created_at, updated_at")
      .eq("share_token", parsed.data.shareToken)
      .eq("status", "active")
      .maybeSingle();

    if (campaignError) {
      audit.error("engagement_campaign_lookup_failed", {
        message: campaignError.message,
        code: campaignError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
    }

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found or not publicly available" }, { status: 404 });
    }

    const [{ data: categories }, { data: approvedItems }] = await Promise.all([
      supabase
        .from("engagement_categories")
        .select("id, label, slug, description, sort_order")
        .eq("campaign_id", campaign.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("engagement_items")
        .select("id, category_id, title, body, submitted_by, latitude, longitude, created_at")
        .eq("campaign_id", campaign.id)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const acceptingSubmissions = campaign.allow_public_submissions && !campaign.submissions_closed_at;

    return NextResponse.json({
      campaign: {
        title: campaign.title,
        summary: campaign.summary,
        publicDescription: campaign.public_description,
        engagementType: campaign.engagement_type,
        acceptingSubmissions,
        updatedAt: campaign.updated_at,
      },
      categories: (categories ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
      })),
      approvedFeedback: (approvedItems ?? []).map((item) => ({
        id: item.id,
        categoryId: item.category_id,
        title: item.title,
        body: item.body,
        submittedBy: item.submitted_by,
        latitude: item.latitude,
        longitude: item.longitude,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    audit.error("engage_public_view_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
