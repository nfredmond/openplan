import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readBytesWithLimit } from "@/lib/http/body-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { buildPublicSubmissionClientFingerprint } from "@/lib/engagement/public-submit";
import {
  buildEngagementPhotoPath,
  ENGAGEMENT_PHOTO_BUCKET,
  isEngagementPhotoContentType,
  registerEngagementPhotoUpload,
  sniffEngagementPhotoContentType,
} from "@/lib/engagement/photo";

const paramsSchema = z.object({
  shareToken: z.string().min(8).max(64),
});

type RouteContext = {
  params: Promise<{ shareToken: string }>;
};

/**
 * Step one of the two-step public photo attachment flow.
 *
 * The client POSTs the raw image bytes with an image/* content-type header.
 * The route validates the declared type AND the magic bytes, size-caps the
 * body, verifies the campaign is live and accepting submissions, then writes
 * to the PRIVATE engagement-photos bucket at <campaignId>/<uuid>.<ext> via
 * the service role. Only the resulting storage path is returned — the submit
 * route later re-validates that path (campaign prefix + object existence +
 * recency) before persisting it on the item. The photo is never publicly
 * reachable; display goes through server-minted signed URLs on approved
 * items only.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.public_photo_upload", request);

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid share token" }, { status: 400 });
    }

    const declaredContentType = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!isEngagementPhotoContentType(declaredContentType)) {
      return NextResponse.json(
        { error: "Unsupported photo type. Please attach a JPEG, PNG, or WebP image." },
        { status: 415 }
      );
    }

    const bodyRead = await readBytesWithLimit(request, BODY_LIMITS.publicPhotoRaw);
    if (!bodyRead.ok) {
      audit.warn("engagement_photo_body_too_large", {
        byteLength: bodyRead.byteLength,
        maxBytes: BODY_LIMITS.publicPhotoRaw,
      });
      return bodyRead.response;
    }

    if (bodyRead.byteLength === 0) {
      return NextResponse.json({ error: "Photo upload is empty" }, { status: 400 });
    }

    // Magic-byte sniffing: the actual bytes must agree with the declared
    // content type. A renamed HTML/SVG payload does not get stored.
    const sniffedContentType = sniffEngagementPhotoContentType(bodyRead.bytes);
    if (sniffedContentType !== declaredContentType) {
      return NextResponse.json(
        { error: "Photo contents do not match the declared image type." },
        { status: 415 }
      );
    }

    const fingerprint = buildPublicSubmissionClientFingerprint(request);
    const rate = registerEngagementPhotoUpload(fingerprint);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many recent photo uploads from this connection. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const supabase = createServiceRoleClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("engagement_campaigns")
      .select("id, status, allow_public_submissions, submissions_closed_at")
      .eq("share_token", parsedParams.data.shareToken)
      .eq("status", "active")
      .maybeSingle();

    if (campaignError) {
      audit.error("engagement_photo_campaign_lookup_failed", {
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

    // Server-generated path — the client never influences it beyond the
    // campaign resolved from the share token.
    const photoPath = buildEngagementPhotoPath(campaign.id, randomUUID(), declaredContentType);

    const { error: uploadError } = await supabase.storage
      .from(ENGAGEMENT_PHOTO_BUCKET)
      .upload(photoPath, bodyRead.bytes, { contentType: declaredContentType, upsert: false });

    if (uploadError) {
      audit.error("engagement_photo_upload_failed", {
        campaignId: campaign.id,
        message: uploadError.message,
      });
      return NextResponse.json({ error: "Failed to store photo" }, { status: 500 });
    }

    audit.info("engagement_photo_uploaded", {
      campaignId: campaign.id,
      byteLength: bodyRead.byteLength,
      contentType: declaredContentType,
    });

    return NextResponse.json({ success: true, photoPath }, { status: 201 });
  } catch (error) {
    audit.error("engage_public_photo_upload_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while uploading photo" }, { status: 500 });
  }
}
