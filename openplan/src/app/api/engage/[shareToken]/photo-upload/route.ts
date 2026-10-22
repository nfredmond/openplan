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
  ENGAGEMENT_PHOTO_MAX_BYTES,
  isEngagementPhotoContentType,
  sniffEngagementPhotoContentType,
} from "@/lib/engagement/photo";
import { stripPhotoMetadata } from "@/lib/engagement/photo-metadata";
import {
  photoUploadRefusal,
  readPhotoUploadUsage,
  releasePhotoUpload,
  reservePhotoUpload,
  type PhotoUploadRefusal,
  type PhotoUploadScope,
} from "@/lib/engagement/photo-upload-allowance";

const paramsSchema = z.object({
  shareToken: z.string().min(8).max(64),
});

type RouteContext = {
  params: Promise<{ shareToken: string }>;
};

function refusedResponse(refusal: PhotoUploadRefusal) {
  return NextResponse.json(
    {
      error:
        refusal === "connection"
          ? "Too many recent photo uploads from this connection. Please wait a few minutes and try again."
          : "This consultation cannot take more photos today. Please try again tomorrow.",
    },
    { status: 429 }
  );
}

/**
 * Step one of the two-step public photo attachment flow.
 *
 * The client POSTs the raw image bytes with an image/* content-type header.
 * The route validates the declared type AND the magic bytes, size-caps the
 * body, verifies the campaign is live and accepting submissions, then writes
 * a re-encoded copy with location, device and other embedded metadata removed
 * to the PRIVATE engagement-photos bucket at <campaignId>/<uuid>.<ext> via
 * the service role; the participant's original bytes are never stored. Each
 * stored photo is counted in `usage_events` first, which is both the shared
 * limit and the record the daily sweep uses to remove photos never attached. Only
 * the resulting storage path is returned — the submit route later
 * re-validates that path (campaign prefix + object existence + recency)
 * before persisting it on the item. The photo is never publicly
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

    const supabase = createServiceRoleClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("engagement_campaigns")
      .select("id, workspace_id, status, allow_public_submissions, submissions_closed_at, participation_starts_at, participation_ends_at")
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

    if ((campaign.participation_starts_at && Date.parse(campaign.participation_starts_at) > Date.now()) || (campaign.participation_ends_at && Date.parse(campaign.participation_ends_at) <= Date.now())) {
      return NextResponse.json({ error: "This campaign is outside its participation dates." }, { status: 403 });
    }

    // The limits are counted in the database, so every server instance sees
    // the same numbers. See photo-upload-allowance.ts.
    const scope: PhotoUploadScope = {
      workspaceId: campaign.workspace_id,
      campaignId: campaign.id,
      fingerprint: buildPublicSubmissionClientFingerprint(request),
    };
    const before = await readPhotoUploadUsage(supabase, scope);
    if (!before.ok) {
      audit.error("engagement_photo_allowance_lookup_failed", { campaignId: campaign.id, message: before.message });
      return NextResponse.json({ error: "Failed to verify recent photo uploads" }, { status: 500 });
    }
    const refusedBefore = photoUploadRefusal(before.usage, { includesThisUpload: false });
    if (refusedBefore) return refusedResponse(refusedBefore);

    // Decoding runs after the limits and campaign checks so a closed or
    // unknown campaign never costs an image decode. A file that passed the
    // magic-byte check but does not decode is refused, never stored raw.
    const stripped = await stripPhotoMetadata(bodyRead.bytes, sniffedContentType);
    if (!stripped.ok) {
      return NextResponse.json(
        { error: "This photo could not be read. Please attach a JPEG, PNG, or WebP image." },
        { status: 415 }
      );
    }

    // Re-encoding can make a well-compressed original larger; the bucket's
    // file_size_limit would refuse it with an unexplained storage error.
    if (stripped.bytes.byteLength > ENGAGEMENT_PHOTO_MAX_BYTES) {
      return NextResponse.json(
        { error: "This photo is too large to store. Please attach a smaller image." },
        { status: 413 }
      );
    }

    // Server-generated path — the client never influences it beyond the
    // campaign resolved from the share token.
    const photoPath = buildEngagementPhotoPath(campaign.id, randomUUID(), stripped.contentType);

    /*
      WRITE THE ROW, THEN COUNT AGAIN, THEN STORE. Parallel requests all read
      the counts above before any of them writes, so that check alone admits a
      whole burst. The row is written first and the counts read again with it
      included; an upload that finds a limit passed withdraws its row. The row
      also exists before the bytes do, so the sweep can always find a photo
      that was stored and never attached.
    */
    const reservationId = await reservePhotoUpload(supabase, {
      ...scope,
      photoPath,
      bytes: stripped.bytes.byteLength,
    });
    if (!reservationId) {
      audit.error("engagement_photo_reservation_failed", { campaignId: campaign.id });
      return NextResponse.json({ error: "Failed to store photo" }, { status: 500 });
    }
    const after = await readPhotoUploadUsage(supabase, scope);
    const refusedAfter = after.ok ? photoUploadRefusal(after.usage, { includesThisUpload: true }) : null;
    if (!after.ok || refusedAfter) {
      await releasePhotoUpload(supabase, reservationId);
      if (refusedAfter) return refusedResponse(refusedAfter);
      audit.error("engagement_photo_allowance_lookup_failed", {
        campaignId: campaign.id,
        message: after.ok ? null : after.message,
      });
      return NextResponse.json({ error: "Failed to verify recent photo uploads" }, { status: 500 });
    }

    const { error: uploadError } = await supabase.storage
      .from(ENGAGEMENT_PHOTO_BUCKET)
      .upload(photoPath, stripped.bytes, { contentType: stripped.contentType, upsert: false });

    if (uploadError) {
      await releasePhotoUpload(supabase, reservationId);
      audit.error("engagement_photo_upload_failed", {
        campaignId: campaign.id,
        message: uploadError.message,
      });
      return NextResponse.json({ error: "Failed to store photo" }, { status: 500 });
    }

    audit.info("engagement_photo_uploaded", {
      campaignId: campaign.id,
      byteLength: bodyRead.byteLength,
      storedByteLength: stripped.bytes.byteLength,
      contentType: stripped.contentType,
    });

    return NextResponse.json({ success: true, photoPath }, { status: 201 });
  } catch (error) {
    audit.error("engage_public_photo_upload_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while uploading photo" }, { status: 500 });
  }
}
