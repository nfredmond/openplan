import { anthropicKeySource } from "@/lib/integrations/anthropic-access";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Per-workspace rate limit on AI calls (assistant chat, grant narrative drafts,
 * engagement synthesis, engagement moderation scans, document narrative drafts
 * for report sections and RTP chapters, RTP document extraction).
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
  "document_narrative_draft",
  // One event PER MODEL CALL, not per run: transcribing an adopted RTP is many
  // calls over one document, and metering the run would understate the spend by
  // an order of magnitude.
  "rtp_document_extraction",
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

/**
 * Integration-key live probes (the validate-before-save checks in the
 * integration-keys routes) meter into their OWN bucket, outside
 * AI_RATE_LIMIT_BUCKET_KEYS, for the same isolation reason as public
 * translation: probe traffic relays caller-supplied keys to external
 * providers, and throttling it must never consume — or be consumed by — the
 * workspace's staff AI allowance. The cap bounds how fast the probe endpoints
 * can be used to spray keys at providers; a human configuring a workspace's
 * providers never approaches it.
 */
export const INTEGRATION_KEY_PROBE_BUCKET_KEYS = ["integration_key_probe"] as const;
export const INTEGRATION_KEY_PROBE_MAX_PER_WINDOW = 20;

export type AiRateLimitResult = {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
};

type CountSupabaseLike = {
  from: ReturnType<typeof createServiceRoleClient>["from"];
};

/**
 * Thrown instead of a verdict when usage cannot be counted or recorded while
 * the deployment's own key would pay for the call. Callers let it reach their
 * error handler: it is not "too many requests", and saying so would invent a
 * cause.
 */
export class AiUsageMeterUnavailableError extends Error {
  constructor(detail: string) {
    super(`AI usage could not be metered, so the deployment's shared AI key is not used: ${detail}`);
    this.name = "AiUsageMeterUnavailableError";
  }
}

/**
 * Whether the effective Anthropic key for this request is the deployment's
 * shared key rather than the workspace's own. Read inside the request's
 * integration context, where the workspace key (if any) takes precedence.
 */
function deploymentKeyPays(): boolean {
  return anthropicKeySource() === "env";
}

/**
 * Counts recent AI usage events for a workspace.
 *
 * On a lookup error the answer depends on who pays. With the workspace's own
 * key it fails OPEN (allows the request), as it always has: the limiter must
 * never take a workspace's AI offline, and the spend is the workspace's own.
 * With the deployment's shared key it fails CLOSED by throwing
 * {@link AiUsageMeterUnavailableError}, because an unmetered call bills the
 * operator for every workspace on the deployment.
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
    // Defaults to whether the deployment's shared key pays for this request.
    failClosed?: boolean;
  }
): Promise<AiRateLimitResult> {
  const windowSeconds = options?.windowSeconds ?? AI_RATE_LIMIT_WINDOW_SECONDS;
  const max = options?.max ?? AI_RATE_LIMIT_MAX_PER_WINDOW;
  const nowMs = options?.nowMs ?? Date.now();
  const bucketKeys = options?.bucketKeys ?? AI_RATE_LIMIT_BUCKET_KEYS;
  const sinceIso = new Date(nowMs - windowSeconds * 1000).toISOString();
  const failClosed = options?.failClosed ?? deploymentKeyPays();

  let observed: number;
  try {
    const supabase = options?.serviceSupabase ?? createServiceRoleClient();
    const { count, error } = await supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("bucket_key", [...bucketKeys])
      .gte("occurred_at", sinceIso);

    if (error) {
      if (failClosed) throw new AiUsageMeterUnavailableError(error.message);
      return { allowed: true, count: 0, retryAfterSeconds: 0 };
    }
    observed = count ?? 0;
  } catch (error) {
    if (error instanceof AiUsageMeterUnavailableError) throw error;
    if (failClosed) throw new AiUsageMeterUnavailableError(error instanceof Error ? error.message : String(error));
    return { allowed: true, count: 0, retryAfterSeconds: 0 };
  }

  return {
    allowed: observed < max,
    count: observed,
    retryAfterSeconds: observed < max ? 0 : windowSeconds,
  };
}

/**
 * Records one AI usage event into `usage_events` — the row
 * `checkAiUsageRateLimit` counts. This is ABUSE METERING for a free product,
 * not billing: OpenPlan has no paid tier, and the only consumer of these rows
 * is the per-workspace spend limiter above. (The table itself is retained from
 * migration 20260424000072; its stripe_* columns stay NULL forever.)
 *
 * BEST-EFFORT by design: most call sites fire this after a successful model
 * call and must never fail the user's request because metering hiccuped, so
 * any insert error is swallowed with a single console warning and reported
 * only through the returned boolean. {@link reserveAiUsage} is the caller that
 * acts on that boolean.
 */
export async function recordAiUsageEvent(params: {
  workspaceId: string;
  bucketKey: string;
  eventKey: string;
  sourceRoute?: string;
  metadataJson?: Record<string, unknown>;
  serviceSupabase?: CountSupabaseLike;
}): Promise<boolean> {
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
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      `[ai-rate-limit] usage event insert failed (${params.bucketKey}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

/**
 * Check the limit and record the call BEFORE it is dispatched, for calls the
 * provider bills even when the caller never sees the end: a streamed chat
 * reply the planner closes mid-stream still costs every token generated so
 * far. Recording after the stream finished left those calls uncounted.
 *
 * A refused check records nothing. When the deployment's shared key pays, a
 * failed lookup or a failed insert throws {@link AiUsageMeterUnavailableError}
 * instead of letting an unmetered call through; with the workspace's own key
 * both stay best-effort, as {@link checkAiUsageRateLimit} describes.
 */
export async function reserveAiUsage(params: {
  workspaceId: string;
  bucketKey: string;
  eventKey: string;
  sourceRoute?: string;
  metadataJson?: Record<string, unknown>;
  serviceSupabase?: CountSupabaseLike;
}): Promise<AiRateLimitResult> {
  const failClosed = deploymentKeyPays();
  const limit = await checkAiUsageRateLimit(params.workspaceId, {
    serviceSupabase: params.serviceSupabase,
    failClosed,
  });
  if (!limit.allowed) return limit;
  const recorded = await recordAiUsageEvent(params);
  if (!recorded && failClosed) throw new AiUsageMeterUnavailableError("the usage event was not recorded");
  return limit;
}
