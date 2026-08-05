import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";

/**
 * THE PUBLIC READ OF A CONSULTATION, and the most-read JSON this product serves:
 * anyone with the share token can call it, and an agency embedding OpenPlan
 * elsewhere reads its consultation through it.
 *
 * The campaign lookup has always kept its error. The two reads BELOW it did not —
 * `const [{ data: categories }, { data: approvedItems }] = await Promise.all(…)`
 * bound no error at all, and the route then answered `200` with
 * `categories: []` and `approvedFeedback: []`. To every consumer that is the
 * agency stating that its consultation has no topics and that nobody commented.
 * The 200 is the last place the truth existed; nothing downstream can recover it.
 *
 * Both now classify through `classifyRouteReadFailure`, which is the route-side
 * half of the rule the portal page follows: a read that failed may not be
 * answered as a read that succeeded and found nothing. A pending migration is a
 * 503 (come back); anything else is a 500 whose hint says in words that this is
 * a read failure and not an empty result.
 */

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

    const [categoriesResult, approvedItemsResult] = await Promise.all([
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

    /*
      THE FEEDBACK READ IS CHECKED FIRST, on purpose. If both broke there is one
      status to give, and "nobody commented" is the more damaging of the two
      claims — the approved comment list IS the public record of participation,
      while an empty topic list mostly makes a form harder to file.
    */
    const feedbackFailure = classifyRouteReadFailure(
      "published feedback for this consultation",
      approvedItemsResult
    );
    if (feedbackFailure) {
      audit.error("engagement_public_feedback_read_failed", {
        message: feedbackFailure.message,
        pending: feedbackFailure.pending,
      });
      return NextResponse.json(feedbackFailure.body, { status: feedbackFailure.status });
    }

    const categoriesFailure = classifyRouteReadFailure(
      "the topics for this consultation",
      categoriesResult
    );
    if (categoriesFailure) {
      audit.error("engagement_public_categories_read_failed", {
        message: categoriesFailure.message,
        pending: categoriesFailure.pending,
      });
      return NextResponse.json(categoriesFailure.body, { status: categoriesFailure.status });
    }

    // Only past both checks does an empty array mean what it says.
    const categories = categoriesResult.data ?? [];
    const approvedItems = approvedItemsResult.data ?? [];

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
      categories: categories.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
      })),
      approvedFeedback: approvedItems.map((item) => ({
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
