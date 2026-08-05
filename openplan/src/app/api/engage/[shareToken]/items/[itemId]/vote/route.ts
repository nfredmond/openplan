import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readTextWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { buildPublicSubmissionClientFingerprint } from "@/lib/engagement/public-submit";
import {
  PUBLIC_VOTE_MAX_PER_WINDOW,
  PUBLIC_VOTE_RATE_WINDOW_MINUTES,
} from "@/lib/engagement/votes";

const paramsSchema = z.object({
  shareToken: z.string().min(8).max(64),
  itemId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ shareToken: string; itemId: string }>;
};

type SupabaseServiceClient = ReturnType<typeof createServiceRoleClient>;

type VoteTarget =
  | { ok: true; campaignId: string; itemId: string }
  | { ok: false; response: NextResponse };

/**
 * Anonymous community "support" votes (upvote only — public downvoting
 * invites brigading and suppression, so un-support is the only reversal).
 *
 * Idempotency: one row per (item_id, voter_fingerprint) enforced by the
 * UNIQUE constraint in migration 20260717000084. A repeat POST hits the
 * 23505 unique violation and returns 200 with alreadyVoted, so the client's
 * localStorage memory is only a soft hint — the database is the guard.
 *
 * The engagement_item_votes table has RLS enabled with NO policies; this
 * service-role route is the only path in, gated on share-token knowledge,
 * campaign active status, and item approval.
 */
async function resolveVoteTarget(
  supabase: SupabaseServiceClient,
  audit: ReturnType<typeof createApiAuditLogger>,
  shareToken: string,
  itemId: string
): Promise<VoteTarget> {
  const { data: campaign, error: campaignError } = await supabase
    .from("engagement_campaigns")
    .select("id, status")
    .eq("share_token", shareToken)
    .eq("status", "active")
    .maybeSingle();

  if (campaignError) {
    audit.error("engagement_vote_campaign_lookup_failed", {
      message: campaignError.message,
      code: campaignError.code ?? null,
    });
    return { ok: false, response: NextResponse.json({ error: "Failed to verify campaign" }, { status: 500 }) };
  }

  if (!campaign) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Campaign not found or not publicly available" }, { status: 404 }),
    };
  }

  // Only APPROVED items are votable. Non-approved items return the same 404
  // as missing ones so pending/rejected submissions cannot be enumerated
  // through the vote endpoint.
  const { data: item, error: itemError } = await supabase
    .from("engagement_items")
    .select("id, campaign_id, status")
    .eq("id", itemId)
    .eq("campaign_id", campaign.id)
    .eq("status", "approved")
    .maybeSingle();

  if (itemError) {
    audit.error("engagement_vote_item_lookup_failed", {
      campaignId: campaign.id,
      itemId,
      message: itemError.message,
      code: itemError.code ?? null,
    });
    return { ok: false, response: NextResponse.json({ error: "Failed to verify feedback item" }, { status: 500 }) };
  }

  if (!item) {
    return { ok: false, response: NextResponse.json({ error: "Feedback item not found" }, { status: 404 }) };
  }

  return { ok: true, campaignId: campaign.id, itemId: item.id };
}

/**
 * The item's support total, or `null` when this deployment could not read it.
 *
 * Zero is a real tally a participant reads next to the vote they just cast, so a
 * failed read may not answer it — and it would contradict the vote in the same
 * response. The vote itself is already recorded by the time this runs, so the
 * failure must not fail the request either; the count is simply left out.
 *
 * A read that succeeds and still yields no number is `null` for the same reason:
 * `votes_count` is NOT NULL DEFAULT 0 (20260717000084), so the only way to miss
 * it is to miss the row — which is not a count of zero.
 */
async function readVotesCount(
  supabase: SupabaseServiceClient,
  audit: ReturnType<typeof createApiAuditLogger>,
  itemId: string
): Promise<number | null> {
  const countResult = await supabase
    .from("engagement_items")
    .select("votes_count")
    .eq("id", itemId)
    .maybeSingle();

  const failure = classifyRouteReadFailure("the support count", countResult);
  if (failure) {
    audit.warn("engagement_vote_count_read_failed", {
      itemId,
      message: failure.message,
      pendingSchema: failure.pending,
    });
    return null;
  }

  const votes = (countResult.data as { votes_count?: number | null } | null)?.votes_count;
  return typeof votes === "number" && Number.isFinite(votes) ? votes : null;
}

/**
 * `votesCount` is present only when it was actually read. A caller cannot tell a
 * zero it was sent from a zero we invented, so an unread count is disclosed as
 * missing instead — both vote surfaces already keep their own optimistic count
 * when the field is absent.
 */
function withVotesCount<T extends object>(body: T, votesCount: number | null) {
  return votesCount === null ? { ...body, votesCountUnavailable: true } : { ...body, votesCount };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.public_vote", request);

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid vote route params" }, { status: 400 });
    }

    // Votes carry no payload, but the body limit still applies to every
    // public route so oversized bodies are rejected before any work happens.
    const bodyRead = await readTextWithLimit(request, BODY_LIMITS.adminTriageJson);
    if (!bodyRead.ok) {
      return bodyRead.response;
    }

    const supabase = createServiceRoleClient();
    const target = await resolveVoteTarget(supabase, audit, parsedParams.data.shareToken, parsedParams.data.itemId);

    if (!target.ok) {
      return target.response;
    }

    const fingerprint = buildPublicSubmissionClientFingerprint(request);

    // Rate limit: recent votes from this fingerprint within the campaign.
    const windowStart = new Date(Date.now() - PUBLIC_VOTE_RATE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count: recentVoteCount, error: recentVotesError } = await supabase
      .from("engagement_item_votes")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", target.campaignId)
      .eq("voter_fingerprint", fingerprint)
      .gte("created_at", windowStart);

    if (recentVotesError) {
      audit.error("engagement_vote_rate_lookup_failed", {
        campaignId: target.campaignId,
        message: recentVotesError.message,
        code: recentVotesError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify recent voting activity" }, { status: 500 });
    }

    if ((recentVoteCount ?? 0) >= PUBLIC_VOTE_MAX_PER_WINDOW) {
      return NextResponse.json(
        { error: "Too many recent votes from this connection. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const { error: insertError } = await supabase.from("engagement_item_votes").insert({
      item_id: target.itemId,
      campaign_id: target.campaignId,
      voter_fingerprint: fingerprint,
    });

    if (insertError) {
      // Unique violation → the fingerprint already supported this item.
      if (insertError.code === "23505") {
        const votesCount = await readVotesCount(supabase, audit, target.itemId);
        return NextResponse.json(withVotesCount({ success: true, alreadyVoted: true }, votesCount), {
          status: 200,
        });
      }

      audit.error("engagement_vote_insert_failed", {
        campaignId: target.campaignId,
        itemId: target.itemId,
        message: insertError.message,
        code: insertError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to record support" }, { status: 500 });
    }

    const votesCount = await readVotesCount(supabase, audit, target.itemId);

    audit.info("engagement_vote_recorded", {
      campaignId: target.campaignId,
      itemId: target.itemId,
    });

    return NextResponse.json(withVotesCount({ success: true, alreadyVoted: false }, votesCount), {
      status: 201,
    });
  } catch (error) {
    audit.error("engage_public_vote_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while recording support" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.public_vote_remove", request);

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid vote route params" }, { status: 400 });
    }

    const bodyRead = await readTextWithLimit(request, BODY_LIMITS.adminTriageJson);
    if (!bodyRead.ok) {
      return bodyRead.response;
    }

    const supabase = createServiceRoleClient();
    const target = await resolveVoteTarget(supabase, audit, parsedParams.data.shareToken, parsedParams.data.itemId);

    if (!target.ok) {
      return target.response;
    }

    const fingerprint = buildPublicSubmissionClientFingerprint(request);

    // No rate limit on removal: each delete requires a matching prior vote
    // from the same fingerprint, so the insert-side limit already bounds it.
    const { data: deletedRows, error: deleteError } = await supabase
      .from("engagement_item_votes")
      .delete()
      .eq("item_id", target.itemId)
      .eq("voter_fingerprint", fingerprint)
      .select("id");

    if (deleteError) {
      audit.error("engagement_vote_delete_failed", {
        campaignId: target.campaignId,
        itemId: target.itemId,
        message: deleteError.message,
        code: deleteError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to remove support" }, { status: 500 });
    }

    const votesCount = await readVotesCount(supabase, audit, target.itemId);

    return NextResponse.json(
      withVotesCount({ success: true, removed: (deletedRows ?? []).length > 0 }, votesCount),
      { status: 200 }
    );
  } catch (error) {
    audit.error("engage_public_vote_remove_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while removing support" }, { status: 500 });
  }
}
