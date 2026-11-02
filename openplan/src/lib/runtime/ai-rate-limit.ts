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
 * Thrown by a caller's reservation callback when the workspace's AI allowance
 * for the window is used up, so a library that makes the model call can stop
 * before it and the route can answer with its usual 429. Carries the verdict
 * for the `retry-after` header.
 */
export class AiUsageLimitReachedError extends Error {
  readonly limit: AiRateLimitResult;
  constructor(limit: AiRateLimitResult) {
    super("The workspace's AI allowance for this window is used up.");
    this.name = "AiUsageLimitReachedError";
    this.limit = limit;
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
 * BEST-EFFORT by design: any insert error is swallowed with a single console
 * warning and reported only through the returned boolean. Every model call
 * the deployment's key can pay for goes through {@link reserveAiUsage}, which
 * records through its SQL function instead and uses this only for the
 * workspace's own key when that function cannot answer. The direct callers
 * left are the integration-key probes, which relay the caller's own key and
 * meter their own bucket.
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

/** The migration that installs {@link reserveAiUsage}'s atomic SQL function. */
export const AI_USAGE_RESERVATION_MIGRATION = "20261102110000_reserve_ai_usage";

type ReserveSupabaseLike = CountSupabaseLike & {
  rpc: ReturnType<typeof createServiceRoleClient>["rpc"];
};

type ReserveParams = {
  workspaceId: string;
  bucketKey: string;
  eventKey: string;
  sourceRoute?: string;
  metadataJson?: Record<string, unknown>;
  serviceSupabase?: ReserveSupabaseLike;
};

/**
 * PostgREST answers PGRST202 when its schema cache has no such function, and
 * Postgres answers 42883 (undefined_function). Either means this database has
 * not applied {@link AI_USAGE_RESERVATION_MIGRATION}.
 */
function reservationFunctionMissing(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = error.message ?? "";
  return /reserve_ai_usage/.test(message) && /could not find|does not exist|schema cache/i.test(message);
}

/** The SQL function's answer: `{ allowed, count }`, or null for any other shape. */
function parseReservation(data: unknown): { allowed: boolean; count: number } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { allowed, count } = data as { allowed?: unknown; count?: unknown };
  if (typeof allowed !== "boolean" || typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  return { allowed, count };
}

/**
 * Check the limit and record the call BEFORE it is dispatched, for calls the
 * provider bills even when the caller never sees the end: a streamed chat
 * reply the planner closes mid-stream still costs every token generated so
 * far. Recording after the stream finished left those calls uncounted.
 *
 * ATOMIC: the count and the insert run in one SQL function,
 * `public.reserve_ai_usage` (migration {@link AI_USAGE_RESERVATION_MIGRATION}),
 * under the per-workspace advisory lock the SQL dispatchers for Planner Agent
 * API tasks, workspace-connection chat and staff translation take. Parallel
 * requests for one workspace queue on that lock, so the window admits exactly
 * its limit. A refused check records nothing.
 *
 * When the function cannot answer (not installed yet, a lock timeout, any
 * other error or an unexpected reply) the answer depends on who pays. With the
 * deployment's shared key it throws {@link AiUsageMeterUnavailableError}: an
 * unmetered call bills the operator for every workspace. With the workspace's
 * own key, or no shared key, it falls back to the earlier best-effort count
 * then record, which is not atomic and never takes a workspace's own AI
 * offline.
 *
 * A reservation is KEPT when the provider call then fails. A provider can bill
 * a call that times out or errors after generating tokens, a refund would be a
 * second write that can fail on its own, and a caller who can make calls fail
 * must not get free retries. The cost is one of the window's calls per failed
 * attempt.
 */
export async function reserveAiUsage(params: ReserveParams): Promise<AiRateLimitResult> {
  const failClosed = deploymentKeyPays();
  const windowSeconds = AI_RATE_LIMIT_WINDOW_SECONDS;

  let failure: string;
  try {
    const supabase = params.serviceSupabase ?? createServiceRoleClient();
    const { data, error } = await supabase.rpc("reserve_ai_usage", {
      p_workspace_id: params.workspaceId,
      p_bucket_keys: [...AI_RATE_LIMIT_BUCKET_KEYS],
      p_max_per_window: AI_RATE_LIMIT_MAX_PER_WINDOW,
      p_window_seconds: windowSeconds,
      p_bucket_key: params.bucketKey,
      p_event_key: params.eventKey,
      p_source_route: params.sourceRoute ?? null,
      p_metadata: params.metadataJson ?? {},
    });
    if (error) {
      failure = reservationFunctionMissing(error)
        ? `the reserve_ai_usage function is not installed; apply migration ${AI_USAGE_RESERVATION_MIGRATION}`
        : error.message;
    } else {
      const verdict = parseReservation(data);
      if (verdict) {
        return {
          allowed: verdict.allowed,
          count: verdict.count,
          retryAfterSeconds: verdict.allowed ? 0 : windowSeconds,
        };
      }
      failure = "the usage reservation returned an unexpected answer";
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failClosed) throw new AiUsageMeterUnavailableError(failure);
  console.warn(`[ai-rate-limit] atomic usage reservation unavailable (${params.bucketKey}): ${failure}`);
  return reserveWithoutLock(params);
}

/**
 * The earlier two-request reservation, kept only for the workspace's own key
 * when the SQL function cannot answer. NOT ATOMIC: parallel requests can all
 * pass one count. Both steps stay best-effort, as
 * {@link checkAiUsageRateLimit} and {@link recordAiUsageEvent} describe.
 */
async function reserveWithoutLock(params: ReserveParams): Promise<AiRateLimitResult> {
  const limit = await checkAiUsageRateLimit(params.workspaceId, {
    serviceSupabase: params.serviceSupabase,
    failClosed: false,
  });
  if (!limit.allowed) return limit;
  await recordAiUsageEvent(params);
  return limit;
}
