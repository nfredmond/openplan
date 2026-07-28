import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import {
  getPublicPortalState,
  mintPublicShareToken,
  normalizeShareToken,
} from "@/lib/engagement/public-portal";

const paramsSchema = z.object({ campaignId: z.string().uuid() });
type RouteContext = { params: Promise<{ campaignId: string }> };

// Collisions at 144 bits of entropy are practically impossible, but the
// share_token column is UNIQUE and we handle the constraint honestly instead
// of assuming — a fresh mint on retry always resolves a real collision.
const MAX_MINT_ATTEMPTS = 3;
const UNIQUE_VIOLATION = "23505";

/**
 * POST — mint a NEW server-generated share token for this campaign and save it
 * in one step. Rotation is immediate: the previous link (if any) stops
 * resolving the moment the row updates — that is the point, and the UI says so
 * before calling. This route only ever touches `share_token`; it never changes
 * campaign status or submission settings, so regenerating the link of a draft
 * or closed campaign yields a STAGED link, never a silently live portal — the
 * response's portal state reports exactly what the new link is.
 * Auth: workspace member with `engagement.write`, same as every other campaign
 * mutation.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.share_token.rotate", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
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

    const previousToken = normalizeShareToken(access.campaign.share_token);

    let mintedToken: string | null = null;
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS && !mintedToken; attempt += 1) {
      const candidate = mintPublicShareToken();
      const { error: updateError } = await supabase
        .from("engagement_campaigns")
        .update({ share_token: candidate })
        .eq("id", access.campaign.id);

      if (!updateError) {
        mintedToken = candidate;
        break;
      }

      if (updateError.code === UNIQUE_VIOLATION) {
        // Token values are credentials — log the collision, never the token.
        audit.warn("campaign_share_token_collision_retry", {
          campaignId: access.campaign.id,
          attempt: attempt + 1,
        });
        continue;
      }

      audit.error("campaign_share_token_update_failed", {
        campaignId: access.campaign.id,
        message: updateError.message,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to save the new share link" }, { status: 500 });
    }

    if (!mintedToken) {
      audit.error("campaign_share_token_mint_exhausted", { campaignId: access.campaign.id });
      return NextResponse.json({ error: "Failed to mint a unique share link" }, { status: 500 });
    }

    audit.info("campaign_share_token_rotated", {
      userId: user.id,
      campaignId: access.campaign.id,
      hadPreviousToken: Boolean(previousToken),
      durationMs: Date.now() - startedAt,
    });

    const portal = getPublicPortalState({
      status: access.campaign.status,
      share_token: mintedToken,
      public_description: access.campaign.public_description,
      allow_public_submissions: access.campaign.allow_public_submissions,
      submissions_closed_at: access.campaign.submissions_closed_at,
    });

    return NextResponse.json(
      {
        success: true,
        campaignId: access.campaign.id,
        shareToken: mintedToken,
        portalPath: portal.portalPath,
        portal,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("campaign_share_token_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while regenerating the share link" }, { status: 500 });
  }
}
