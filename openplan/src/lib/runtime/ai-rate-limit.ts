import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Per-workspace rate limit on AI calls (assistant chat, grant narrative drafts,
 * engagement synthesis, engagement moderation scans).
 *
 * This bounds Anthropic spend against a scripted loop. It is independent of the
 * optional operator run cap (src/lib/config/run-cap.ts) and always applies,
 * because AI calls don't insert into the runs table and so are not counted
 * there at all. The window is generous enough that a human clicking through the
 * app never trips it.
 */
export const AI_RATE_LIMIT_BUCKET_KEYS = [
  "assistant_chat",
  "grant_narrative_draft",
  "engagement_synthesis",
  "engagement_moderation",
] as const;
export const AI_RATE_LIMIT_WINDOW_SECONDS = 300;
export const AI_RATE_LIMIT_MAX_PER_WINDOW = 20;

/**
 * Public, unauthenticated AI (E8 comment translation) records into its OWN
 * bucket, deliberately OUTSIDE AI_RATE_LIMIT_BUCKET_KEYS, so anonymous portal
 * traffic can never consume — and 429-lock-out — the workspace's STAFF AI
 * allowance (assistant chat, grant drafts, synthesis). It is metered separately
 * with its own cap.
 */
export const PUBLIC_ENGAGEMENT_AI_BUCKET_KEYS = ["engagement_public_translation"] as const;
export const PUBLIC_ENGAGEMENT_AI_MAX_PER_WINDOW = 30;

export type AiRateLimitResult = {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
};

type CountSupabaseLike = {
  from: ReturnType<typeof createServiceRoleClient>["from"];
};

/**
 * Counts recent AI usage events for a workspace. Fails OPEN (allows the request)
 * on any lookup error or missing schema — the limiter must never take the AI
 * features offline, only cap runaway volume.
 */
export async function checkAiUsageRateLimit(
  workspaceId: string,
  options?: {
    serviceSupabase?: CountSupabaseLike;
    windowSeconds?: number;
    max?: number;
    nowMs?: number;
    // Which usage buckets to count against this limit. Defaults to the STAFF
    // buckets; public translation passes its own bucket so the two meter
    // independently and public traffic can't lock out staff AI.
    bucketKeys?: readonly string[];
  }
): Promise<AiRateLimitResult> {
  const windowSeconds = options?.windowSeconds ?? AI_RATE_LIMIT_WINDOW_SECONDS;
  const max = options?.max ?? AI_RATE_LIMIT_MAX_PER_WINDOW;
  const nowMs = options?.nowMs ?? Date.now();
  const bucketKeys = options?.bucketKeys ?? AI_RATE_LIMIT_BUCKET_KEYS;
  const sinceIso = new Date(nowMs - windowSeconds * 1000).toISOString();

  try {
    const supabase = options?.serviceSupabase ?? createServiceRoleClient();
    const { count, error } = await supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("bucket_key", [...bucketKeys])
      .gte("occurred_at", sinceIso);

    if (error) {
      return { allowed: true, count: 0, retryAfterSeconds: 0 };
    }

    const observed = count ?? 0;
    return {
      allowed: observed < max,
      count: observed,
      retryAfterSeconds: observed < max ? 0 : windowSeconds,
    };
  } catch {
    return { allowed: true, count: 0, retryAfterSeconds: 0 };
  }
}

/**
 * Records one AI usage event into `usage_events` — the row
 * `checkAiUsageRateLimit` counts. This is ABUSE METERING for a free product,
 * not billing: OpenPlan has no paid tier, and the only consumer of these rows
 * is the per-workspace spend limiter above. (The table itself is retained from
 * migration 20260424000072; its stripe_* columns stay NULL forever.)
 *
 * BEST-EFFORT by design: call sites fire this after a successful model call
 * and must never fail the user's request because metering hiccuped, so any
 * insert error is swallowed with a single console warning. The asymmetry is
 * deliberate — the limiter fails open on lookup errors, and recording fails
 * silent on insert errors; a broken usage_events table can only ever mean
 * "unmetered", never "AI offline".
 */
export async function recordAiUsageEvent(params: {
  workspaceId: string;
  bucketKey: string;
  eventKey: string;
  sourceRoute?: string;
  metadataJson?: Record<string, unknown>;
  serviceSupabase?: CountSupabaseLike;
}): Promise<void> {
  try {
    const supabase = params.serviceSupabase ?? createServiceRoleClient();
    const { error } = await supabase.from("usage_events").insert({
      workspace_id: params.workspaceId,
      bucket_key: params.bucketKey,
      event_key: params.eventKey,
      weight: 1,
      source_route: params.sourceRoute ?? null,
      metadata_json: params.metadataJson ?? {},
    });
    if (error) {
      console.warn(
        `[ai-rate-limit] usage event insert failed (${params.bucketKey}): ${error.message}`
      );
    }
  } catch (error) {
    console.warn(
      `[ai-rate-limit] usage event insert failed (${params.bucketKey}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
