import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithWorkspaceIntegrationKeys } from "@/lib/integrations/context";
import type { IntegrationProviderId } from "@/lib/integrations/providers";
import {
  AI_RATE_LIMIT_MAX_PER_WINDOW,
  AiUsageMeterUnavailableError,
  checkAiUsageRateLimit,
  recordAiUsageEvent,
  reserveAiUsage,
} from "@/lib/runtime/ai-rate-limit";

/** Run `fn` as a request whose workspace stored its own Anthropic key. */
function withWorkspaceKey<T>(fn: () => Promise<T>): Promise<T> {
  const keys = new Map<IntegrationProviderId, string>([["anthropic", "sk-workspace-own"]]);
  return runWithWorkspaceIntegrationKeys("ws-1", keys, fn) as Promise<T>;
}

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
    expect(inFn).toHaveBeenCalledWith("bucket_key", [
      "assistant_chat",
      "grant_narrative_draft",
      "engagement_synthesis",
      "engagement_moderation",
      "document_narrative_draft",
      "rtp_document_extraction",
    ]);
    expect(gte).toHaveBeenCalledWith("occurred_at", new Date(1_000_000_000_000 - 300_000).toISOString());
  });

  describe("on a lookup error", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("fails open (allows) when the workspace's own key pays, so its AI never goes offline", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
      const { supabase } = supabaseReturning({ error: { message: "boom" } });
      const result = await withWorkspaceKey(() => checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase }));
      expect(result.allowed).toBe(true);
    });

    it("fails open when no deployment key is shared", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      const { supabase } = supabaseReturning({ error: { message: "boom" } });
      const result = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase });
      expect(result.allowed).toBe(true);
    });

    it("fails closed when the deployment's shared key would pay", async () => {
      // The operator pays for every workspace on a shared key; an uncounted
      // call is unbounded spend, so the limiter refuses rather than guess.
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
      const { supabase } = supabaseReturning({ error: { message: "boom" } });
      await expect(checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase })).rejects.toBeInstanceOf(
        AiUsageMeterUnavailableError
      );

      const throwing = { from: vi.fn(() => { throw new Error("no network"); }) } as never;
      await expect(checkAiUsageRateLimit("ws-1", { serviceSupabase: throwing })).rejects.toBeInstanceOf(
        AiUsageMeterUnavailableError
      );
    });
  });
});

describe("recordAiUsageEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts one weight-1 row shaped to the real usage_events columns", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));

    await recordAiUsageEvent({
      workspaceId: "ws-1",
      bucketKey: "assistant_chat",
      eventKey: "assistant_chat_reply",
      sourceRoute: "/api/assistant/chat",
      metadataJson: { model: "claude-opus-4-8" },
      serviceSupabase: { from } as never,
    });

    expect(from).toHaveBeenCalledWith("usage_events");
    // Exact payload: these keys are migration 20260424000072's column names.
    expect(insert).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      bucket_key: "assistant_chat",
      event_key: "assistant_chat_reply",
      weight: 1,
      source_route: "/api/assistant/chat",
      metadata_json: { model: "claude-opus-4-8" },
    });
  });

  it("defaults source_route to null and metadata_json to {}", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));

    await recordAiUsageEvent({
      workspaceId: "ws-1",
      bucketKey: "engagement_synthesis",
      eventKey: "engagement_synthesis",
      serviceSupabase: { from } as never,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ source_route: null, metadata_json: {} })
    );
  });

  it("reports a recorded event as true", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    await expect(
      recordAiUsageEvent({
        workspaceId: "ws-1",
        bucketKey: "assistant_chat",
        eventKey: "assistant_chat_reply",
        serviceSupabase: { from: vi.fn(() => ({ insert })) } as never,
      })
    ).resolves.toBe(true);
  });

  it("swallows a thrown insert — metering must never fail the user's request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const from = vi.fn(() => ({
      insert: vi.fn(async () => {
        throw new Error("usage_events is on fire");
      }),
    }));

    await expect(
      recordAiUsageEvent({
        workspaceId: "ws-1",
        bucketKey: "assistant_chat",
        eventKey: "assistant_chat_reply",
        serviceSupabase: { from } as never,
      })
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("swallows an insert error result the same way", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const from = vi.fn(() => ({ insert: vi.fn(async () => ({ error: { message: "denied" } })) }));

    await expect(
      recordAiUsageEvent({
        workspaceId: "ws-1",
        bucketKey: "assistant_chat",
        eventKey: "assistant_chat_reply",
        serviceSupabase: { from } as never,
      })
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the loop closes: recorded events are what the limiter counts", () => {
  /** An in-memory usage_events table serving BOTH the insert and the
   * select/eq/in/gte counting chain, so record → check runs end to end. */
  function inMemoryUsageEvents() {
    const rows: Array<Record<string, unknown>> = [];
    const from = (table: string) => {
      if (table !== "usage_events") throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          rows.push({ occurred_at: new Date().toISOString(), ...row });
          return { error: null };
        },
        select: () => ({
          eq: (_col: string, workspaceId: unknown) => ({
            in: (_col2: string, bucketKeys: string[]) => ({
              gte: async (_col3: string, sinceIso: string) => ({
                count: rows.filter(
                  (row) =>
                    row.workspace_id === workspaceId &&
                    bucketKeys.includes(row.bucket_key as string) &&
                    (row.occurred_at as string) >= sinceIso
                ).length,
                error: null,
              }),
            }),
          }),
        }),
      };
    };
    return { rows, supabase: { from } as never };
  }

  it("counts recorded staff events and blocks at the max", async () => {
    const { supabase } = inMemoryUsageEvents();
    for (let i = 0; i < 3; i += 1) {
      await recordAiUsageEvent({
        workspaceId: "ws-1",
        bucketKey: "assistant_chat",
        eventKey: "assistant_chat_reply",
        serviceSupabase: supabase,
      });
    }

    const underMax = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase, max: 4 });
    expect(underMax).toMatchObject({ allowed: true, count: 3 });

    const atMax = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase, max: 3 });
    expect(atMax).toMatchObject({ allowed: false, count: 3 });
  });

  it("keeps the public translation bucket out of the staff allowance", async () => {
    const { supabase } = inMemoryUsageEvents();
    await recordAiUsageEvent({
      workspaceId: "ws-1",
      bucketKey: "engagement_public_translation",
      eventKey: "engagement_public_translation",
      serviceSupabase: supabase,
    });

    // Staff check (default buckets) must not see the anonymous portal event…
    const staff = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase });
    expect(staff.count).toBe(0);

    // …while the public check counts it.
    const publicCheck = await checkAiUsageRateLimit("ws-1", {
      serviceSupabase: supabase,
      bucketKeys: ["engagement_public_translation"],
    });
    expect(publicCheck.count).toBe(1);
  });

  it("does not count another workspace's events", async () => {
    const { supabase } = inMemoryUsageEvents();
    await recordAiUsageEvent({
      workspaceId: "ws-other",
      bucketKey: "assistant_chat",
      eventKey: "assistant_chat_reply",
      serviceSupabase: supabase,
    });

    const result = await checkAiUsageRateLimit("ws-1", { serviceSupabase: supabase });
    expect(result.count).toBe(0);
  });
});

describe("reserveAiUsage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** usage_events with a count answer and an insert outcome chosen per test. */
  function usageEvents(options: { count: number; insertError?: { message: string } | null }) {
    const insert = vi.fn(async () => ({ error: options.insertError ?? null }));
    const gte = vi.fn(async () => ({ count: options.count, error: null }));
    const from = vi.fn(() => ({
      insert,
      select: () => ({ eq: () => ({ in: () => ({ gte }) }) }),
    }));
    return { insert, supabase: { from } as never };
  }

  const reservation = (serviceSupabase: never) => ({
    workspaceId: "ws-1",
    bucketKey: "assistant_chat",
    eventKey: "assistant_chat_reply",
    sourceRoute: "/api/assistant/chat",
    serviceSupabase,
  });

  it("records the call before returning an allowed verdict", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
    const { insert, supabase } = usageEvents({ count: 0 });
    const result = await reserveAiUsage(reservation(supabase));
    expect(result).toMatchObject({ allowed: true, count: 0 });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: "ws-1", bucket_key: "assistant_chat", event_key: "assistant_chat_reply" })
    );
  });

  it("records nothing when the limit refuses the call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
    const { insert, supabase } = usageEvents({ count: AI_RATE_LIMIT_MAX_PER_WINDOW });
    const result = await reserveAiUsage(reservation(supabase));
    expect(result.allowed).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses when the event cannot be recorded and the shared key would pay", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
    const { supabase } = usageEvents({ count: 0, insertError: { message: "denied" } });
    await expect(reserveAiUsage(reservation(supabase))).rejects.toBeInstanceOf(AiUsageMeterUnavailableError);
  });

  it("allows an unrecorded call when the workspace's own key pays", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
    const { supabase } = usageEvents({ count: 0, insertError: { message: "denied" } });
    const result = await withWorkspaceKey(() => reserveAiUsage(reservation(supabase)));
    expect(result.allowed).toBe(true);
  });
});
