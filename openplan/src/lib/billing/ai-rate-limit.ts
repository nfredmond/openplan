import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Per-workspace rate limit for paid AI calls (assistant chat, grant narrative
 * drafts). This bounds Anthropic spend against a scripted loop regardless of
 * the workspace's monthly plan allotment — the monthly run-count quota does not
 * bound pure-AI usage because AI calls don't insert into the runs table. The
 * window is generous enough that a human clicking through a demo never trips it.
 */
export const AI_RATE_LIMIT_BUCKET_KEYS = ["assistant_chat", "grant_narrative_draft", "engagement_synthesis"] as const;
export const AI_RATE_LIMIT_WINDOW_SECONDS = 300;
export const AI_RATE_LIMIT_MAX_PER_WINDOW = 20;

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
  }
): Promise<AiRateLimitResult> {
  const windowSeconds = options?.windowSeconds ?? AI_RATE_LIMIT_WINDOW_SECONDS;
  const max = options?.max ?? AI_RATE_LIMIT_MAX_PER_WINDOW;
  const nowMs = options?.nowMs ?? Date.now();
  const sinceIso = new Date(nowMs - windowSeconds * 1000).toISOString();

  try {
    const supabase = options?.serviceSupabase ?? createServiceRoleClient();
    const { count, error } = await supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("bucket_key", [...AI_RATE_LIMIT_BUCKET_KEYS])
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
