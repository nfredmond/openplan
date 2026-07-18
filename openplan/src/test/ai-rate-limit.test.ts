import { describe, expect, it, vi } from "vitest";
import {
  AI_RATE_LIMIT_MAX_PER_WINDOW,
  checkAiUsageRateLimit,
} from "@/lib/billing/ai-rate-limit";

function supabaseReturning(result: { count?: number | null; error?: unknown }) {
  const gte = vi.fn(async () => result);
  const inFn = vi.fn(() => ({ gte }));
  const eq = vi.fn(() => ({ in: inFn }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { supabase: { from } as never, from, select, eq, inFn, gte };
}

describe("checkAiUsageRateLimit", () => {
  it("allows when recent AI usage is under the window max", async () => {
    const { supabase } = supabaseReturning({ count: AI_RATE_LIMIT_MAX_PER_WINDOW - 1 });
    const result = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase });
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("blocks at the window max", async () => {
    const { supabase } = supabaseReturning({ count: AI_RATE_LIMIT_MAX_PER_WINDOW });
    const result = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.count).toBe(AI_RATE_LIMIT_MAX_PER_WINDOW);
  });

  it("filters to the workspace, the AI buckets, and the time window", async () => {
    const { supabase, eq, inFn, gte } = supabaseReturning({ count: 0 });
    await checkAiUsageRateLimit("ws-42", { serviceSupabase: supabase, nowMs: 1_000_000_000_000 });
    expect(eq).toHaveBeenCalledWith("workspace_id", "ws-42");
    expect(inFn).toHaveBeenCalledWith("bucket_key", ["assistant_chat", "grant_narrative_draft"]);
    expect(gte).toHaveBeenCalledWith("occurred_at", new Date(1_000_000_000_000 - 300_000).toISOString());
  });

  it("fails open (allows) on a lookup error so AI never goes offline", async () => {
    const { supabase } = supabaseReturning({ error: { message: "boom" } });
    const result = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase });
    expect(result.allowed).toBe(true);
  });
});
