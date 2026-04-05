import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildPublicSubmissionSupportMetadata,
  evaluatePublicSubmissionSafety,
  PUBLIC_SUBMISSION_RECENT_LOOKBACK_MINUTES,
  type RecentPublicSubmissionRecord,
} from "@/lib/engagement/public-submit";
import { createServiceRoleClient } from "@/lib/supabase/server";

const paramsSchema = z.object({
  shareToken: z.string().min(8).max(64),
});

const submitSchema = z.object({
  categoryId: z.string().uuid().optional(),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(4000),
  submittedBy: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Honeypot field: should be empty. Bots fill this in.
  website: z.string().max(500).optional(),
});

type RouteContext = {
  params: Promise<{ shareToken: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid share token" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = submitSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid submission", details: parsed.error.issues }, { status: 400 });
    }

    // Honeypot check: if 'website' field has content, silently accept but discard
    if (parsed.data.website && parsed.data.website.length > 0) {
      return NextResponse.json({ success: true, message: "Thank you for your feedback." }, { status: 201 });
    }

    const supabase = createServiceRoleClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("engagement_campaigns")
      .select("id, status, allow_public_submissions, submissions_closed_at")
      .eq("share_token", parsedParams.data.shareToken)
      .eq("status", "active")
      .maybeSingle();

    if (campaignError) {
      return NextResponse.json({ error: "Failed to verify campaign" }, { status: 500 });
    }

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found or not publicly available" }, { status: 404 });
    }

    if (!campaign.allow_public_submissions || campaign.submissions_closed_at) {
      return NextResponse.json({ error: "This campaign is not currently accepting public submissions" }, { status: 403 });
    }

    // Validate category belongs to this campaign if provided
    if (parsed.data.categoryId) {
      const { data: category } = await supabase
        .from("engagement_categories")
        .select("id")
        .eq("id", parsed.data.categoryId)
        .eq("campaign_id", campaign.id)
        .maybeSingle();

      if (!category) {
        return NextResponse.json({ error: "Invalid category for this campaign" }, { status: 400 });
      }
    }

    const lookbackStart = new Date(
      Date.now() - PUBLIC_SUBMISSION_RECENT_LOOKBACK_MINUTES * 60 * 1000
    ).toISOString();

    const { data: recentItemsData, error: recentItemsError } = await supabase
      .from("engagement_items")
      .select("id, title, body, created_at, metadata_json")
      .eq("campaign_id", campaign.id)
      .eq("source_type", "public")
      .gte("created_at", lookbackStart)
      .order("created_at", { ascending: false })
      .limit(25);

    if (recentItemsError) {
      return NextResponse.json({ error: "Failed to verify recent submission activity" }, { status: 500 });
    }

    const safety = evaluatePublicSubmissionSafety({
      request,
      title: parsed.data.title,
      body: parsed.data.body,
      recentItems: (recentItemsData ?? []) as RecentPublicSubmissionRecord[],
    });

    if (safety.isRateLimited) {
      return NextResponse.json(
        { error: "Too many recent submissions from this connection. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    if (safety.isDuplicate) {
      return NextResponse.json(
        {
          error:
            "This feedback looks like a recent duplicate. If you need to add more detail, please revise the note and try again.",
        },
        { status: 409 }
      );
    }

    const receivedAt = new Date().toISOString();
    const metadata = buildPublicSubmissionSupportMetadata(request, {
      title: parsed.data.title,
      body: parsed.data.body,
      receivedAt,
      autoFlagReason: safety.autoFlagReason,
    });

    const { data: item, error: insertError } = await supabase
      .from("engagement_items")
      .insert({
        campaign_id: campaign.id,
        category_id: parsed.data.categoryId ?? null,
        title: parsed.data.title?.trim() || null,
        body: parsed.data.body.trim(),
        submitted_by: parsed.data.submittedBy?.trim() || null,
        status: safety.autoFlagReason ? "flagged" : "pending",
        source_type: "public",
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
        metadata_json: metadata,
        moderation_notes: safety.autoFlagReason,
        created_by: null,
      })
      .select("id, created_at")
      .single();

    if (insertError || !item) {
      return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Thank you for your feedback. Your submission will be reviewed by the project team.",
        submissionId: item.id,
        reviewStatus: safety.autoFlagReason ? "flagged" : "pending",
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Unexpected error while submitting feedback" }, { status: 500 });
  }
}
