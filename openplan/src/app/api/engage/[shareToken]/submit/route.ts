import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildPublicSubmissionSupportMetadata,
  evaluatePublicSubmissionSafety,
  PUBLIC_SUBMISSION_RECENT_LOOKBACK_MINUTES,
  type RecentPublicSubmissionRecord,
} from "@/lib/engagement/public-submit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { recordOperatorNotification } from "@/lib/notifications/engagement";
import {
  computeEngagementGeometryRepresentativePoint,
  parseEngagementGeometry,
  type EngagementGeometry,
} from "@/lib/engagement/geometry";
import {
  ENGAGEMENT_PHOTO_BUCKET,
  ENGAGEMENT_PHOTO_UPLOAD_LOOKBACK_MINUTES,
  isEngagementPhotoPathForCampaign,
  splitEngagementPhotoPath,
} from "@/lib/engagement/photo";
import {
  AGE_BANDS,
  HOUSEHOLD_TENURE,
  LANGUAGES,
  RACE_ETHNICITY,
  demographicsRowFromInput,
  type DemographicsInput,
} from "@/lib/engagement/demographics";

const PUBLIC_SUBMISSION_MAX_BODY_BYTES = BODY_LIMITS.smallJson;

const paramsSchema = z.object({
  shareToken: z.string().min(8).max(64),
});

const submitSchema = z.object({
  categoryId: z.string().uuid().optional(),
  // E6 — when present, this submission is a reply to an approved top-level
  // comment. Validated (approved, same campaign, itself top-level) below.
  parentItemId: z.string().uuid().optional(),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(4000),
  submittedBy: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // GeoJSON Point | LineString | Polygon; fully validated by
  // parseEngagementGeometry after the base parse.
  geometry: z.unknown().optional(),
  // Storage path returned by /api/engage/[shareToken]/photo-upload.
  photoPath: z.string().trim().max(200).optional(),
  // Honeypot field: should be empty. Bots fill this in.
  website: z.string().max(500).optional(),
  // E5a — optional demographics, parsed separately + non-fatally below so a
  // malformed optional field can never block a valid comment.
  demographics: z.unknown().optional(),
});

// Parsed on its own after the comment is saved; failure just skips storage.
const demographicsSchema = z.object({
  ageBand: z.enum(AGE_BANDS).optional(),
  zip5: z.string().trim().regex(/^\d{5}$/).optional(),
  primaryLanguage: z.enum(LANGUAGES).optional(),
  raceEthnicity: z.array(z.enum(RACE_ETHNICITY)).max(8).optional(),
  householdTenure: z.enum(HOUSEHOLD_TENURE).optional(),
  consented: z.boolean().optional(),
});

type RouteContext = {
  params: Promise<{ shareToken: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.public_submit", request);
  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid share token" }, { status: 400 });
    }

    const bodyRead = await readJsonWithLimit(request, PUBLIC_SUBMISSION_MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      audit.warn("engagement_public_submission_body_too_large", {
        byteLength: bodyRead.byteLength,
        maxBytes: PUBLIC_SUBMISSION_MAX_BODY_BYTES,
      });
      return bodyRead.response;
    }

    const payload = bodyRead.data;
    const parsed = submitSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid submission", details: parsed.error.issues }, { status: 400 });
    }

    // Honeypot check: if 'website' field has content, silently accept but discard
    if (parsed.data.website && parsed.data.website.length > 0) {
      return NextResponse.json({ success: true, message: "Thank you for your feedback." }, { status: 201 });
    }

    // Geometry: validate structure, vertex cap, ring closure, and WGS84
    // bounds; then derive the representative lat/lng that keeps every legacy
    // point surface working. A geometry, when present, wins over any
    // separately supplied latitude/longitude.
    let geometry: EngagementGeometry | null = null;
    let latitude = parsed.data.latitude ?? null;
    let longitude = parsed.data.longitude ?? null;

    if (parsed.data.geometry !== undefined && parsed.data.geometry !== null) {
      const geometryResult = parseEngagementGeometry(parsed.data.geometry);
      if (!geometryResult.ok) {
        return NextResponse.json({ error: geometryResult.error }, { status: 400 });
      }
      geometry = geometryResult.geometry;
      const representative = computeEngagementGeometryRepresentativePoint(geometry);
      latitude = representative.latitude;
      longitude = representative.longitude;
    } else if (latitude !== null && longitude !== null) {
      // Legacy lat/lng-only payload: synthesize a Point geometry so newer
      // geometry-aware surfaces see a consistent record.
      geometry = { type: "Point", coordinates: [longitude, latitude] };
    }

    const supabase = createServiceRoleClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("engagement_campaigns")
      .select("id, workspace_id, title, status, allow_public_submissions, submissions_closed_at, demographics_enabled")
      .eq("share_token", parsedParams.data.shareToken)
      .eq("status", "active")
      .maybeSingle();

    if (campaignError) {
      audit.error("engagement_campaign_submit_lookup_failed", {
        message: campaignError.message,
        code: campaignError.code ?? null,
      });
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

    // E6 — reply target: must be an APPROVED, top-level (parent_item_id IS NULL)
    // item in THIS campaign. One level of nesting only, so a reply can't be
    // replied to. An unknown/non-approved/nested parent returns 400 rather than
    // silently dropping the link, and never lets a reply attach to a
    // pending/rejected item (which would leak its existence).
    let parentItemId: string | null = null;
    if (parsed.data.parentItemId) {
      const { data: parent, error: parentError } = await supabase
        .from("engagement_items")
        .select("id, parent_item_id")
        .eq("id", parsed.data.parentItemId)
        .eq("campaign_id", campaign.id)
        .eq("status", "approved")
        .maybeSingle();

      if (parentError) {
        audit.error("engagement_reply_parent_lookup_failed", {
          campaignId: campaign.id,
          message: parentError.message,
          code: parentError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify the comment being replied to" }, { status: 500 });
      }

      if (!parent || (parent as { parent_item_id: string | null }).parent_item_id !== null) {
        return NextResponse.json(
          { error: "You can only reply to an approved top-level comment." },
          { status: 400 }
        );
      }
      parentItemId = (parent as { id: string }).id;
    }

    // Photo path: never trust a client-provided storage path. It must match
    // the strict <campaignId>/<uuid>.<ext> shape for THIS campaign, and the
    // object must actually exist in the private bucket with a recent
    // created_at (i.e. it came from this campaign's photo-upload lane).
    const photoPath = parsed.data.photoPath || null;
    if (photoPath) {
      if (!isEngagementPhotoPathForCampaign(photoPath, campaign.id)) {
        return NextResponse.json({ error: "Invalid photo reference for this campaign" }, { status: 400 });
      }

      const pathParts = splitEngagementPhotoPath(photoPath);
      const { data: photoObjects, error: photoLookupError } = await supabase.storage
        .from(ENGAGEMENT_PHOTO_BUCKET)
        .list(pathParts?.folder ?? campaign.id, { limit: 1, search: pathParts?.fileName ?? "" });

      if (photoLookupError) {
        audit.error("engagement_photo_lookup_failed", {
          campaignId: campaign.id,
          message: photoLookupError.message,
        });
        return NextResponse.json({ error: "Failed to verify photo upload" }, { status: 500 });
      }

      const photoObject = (photoObjects ?? []).find((object) => object.name === pathParts?.fileName);
      const createdAtMs = photoObject?.created_at ? Date.parse(photoObject.created_at) : Number.NaN;
      const lookbackMs = ENGAGEMENT_PHOTO_UPLOAD_LOOKBACK_MINUTES * 60 * 1000;

      if (!photoObject || Number.isNaN(createdAtMs) || Date.now() - createdAtMs > lookbackMs) {
        return NextResponse.json({ error: "Photo upload not found or expired. Please re-attach the photo." }, { status: 400 });
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
      audit.error("engagement_recent_items_lookup_failed", {
        campaignId: campaign.id,
        message: recentItemsError.message,
        code: recentItemsError.code ?? null,
      });
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
        parent_item_id: parentItemId,
        title: parsed.data.title?.trim() || null,
        body: parsed.data.body.trim(),
        submitted_by: parsed.data.submittedBy?.trim() || null,
        status: safety.autoFlagReason ? "flagged" : "pending",
        source_type: "public",
        latitude,
        longitude,
        geometry,
        photo_path: photoPath,
        metadata_json: metadata,
        moderation_notes: safety.autoFlagReason,
        created_by: null,
      })
      .select("id, created_at")
      .single();

    if (insertError || !item) {
      audit.error("engagement_item_insert_failed", {
        campaignId: campaign.id,
        message: insertError?.message ?? null,
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
    }

    // E5a — persist optional demographics only when the campaign opted in, into
    // the service-role-only sibling table. Parsed + stored non-fatally: the
    // comment is already saved, so nothing here can fail the submission.
    if (campaign.demographics_enabled && parsed.data.demographics !== undefined) {
      const demographicsParse = demographicsSchema.safeParse(parsed.data.demographics);
      if (demographicsParse.success) {
        const demographicsRow = demographicsRowFromInput(
          item.id,
          campaign.id,
          demographicsParse.data as DemographicsInput
        );
        if (demographicsRow) {
          const { error: demographicsError } = await supabase
            .from("engagement_item_demographics")
            .insert(demographicsRow);
          if (demographicsError) {
            audit.warn("engagement_demographics_insert_failed", {
              campaignId: campaign.id,
              submissionId: item.id,
              message: demographicsError.message,
            });
          }
        }
      }
    }

    // Best-effort operator notification — the submission is already saved, so a
    // failure here never fails the request (mirrors the demographics insert).
    const flagged = Boolean(safety.autoFlagReason);
    await recordOperatorNotification(supabase, {
      workspaceId: campaign.workspace_id,
      campaignId: campaign.id,
      type: flagged ? "comment_flagged" : "comment_submitted",
      title: flagged
        ? `Flagged submission needs review on “${campaign.title}”`
        : `New public submission on “${campaign.title}”`,
      body: parsed.data.title?.trim() || parsed.data.body.trim().slice(0, 140),
      payload: { itemId: item.id, isReply: parentItemId !== null, reviewStatus: flagged ? "flagged" : "pending" },
    }).catch(() => {});

    audit.info("engagement_public_submission_accepted", {
      campaignId: campaign.id,
      submissionId: item.id,
      reviewStatus: safety.autoFlagReason ? "flagged" : "pending",
    });

    return NextResponse.json(
      {
        success: true,
        message: "Thank you for your feedback. Your submission will be reviewed by the project team.",
        submissionId: item.id,
        reviewStatus: safety.autoFlagReason ? "flagged" : "pending",
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("engage_public_submit_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while submitting feedback" }, { status: 500 });
  }
}
