import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignAccess = vi.fn();
const validateCampaignCategoryAccess = vi.fn();
const getUser = vi.fn();
const generateEngagementSynthesis = vi.fn();
const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const checkAiUsageRateLimit = vi.fn();
const recordAiUsageEvent = vi.fn();

// Terminal resolvers for the engagement_closeloop_entries chains.
const entryInsertSingle = vi.fn();
const entryUpdateMaybeSingle = vi.fn();
const entryDelete = vi.fn();
const entryListResolve = vi.fn();
const entryPriorStatus = vi.fn(); // pre-update status read on publish
// Draft route reads.
const itemsResolve = vi.fn();
const categoriesResolve = vi.fn();

const fakeSupabase = {
  auth: { getUser },
  rpc: vi.fn(async (name: string, args: { p_campaign: string; p_published_only: boolean }) => {
    expect(name).toBe("read_engagement_response_snapshot");
    expect(args).toEqual({ p_campaign: CAMPAIGN_ID, p_published_only: false });
    const result = await entryListResolve();
    return { data: { campaignId: args.p_campaign, publishedOnly: false, count: result.data?.length ?? 0, entries: result.data ?? [] }, error: result.error };
  }),
  from: vi.fn((table: string) => {
    if (table === "engagement_closeloop_entries") {
      return {
        insert: () => ({ select: () => ({ single: entryInsertSingle }) }),
        update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: entryUpdateMaybeSingle }) }) }) }),
        delete: () => ({ eq: () => ({ eq: () => entryDelete() }) }),
        // The pre-publish status read remains a separately scoped table query.
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: entryPriorStatus }) }) }),
      };
    }
    if (table === "engagement_items") {
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: itemsResolve }) }) }) }) };
    }
    if (table === "engagement_categories") {
      return { select: () => ({ eq: categoriesResolve }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeSupabase),
  createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
// On publish the route fires best-effort notifications/subscriber emails — no-op
// them, but keep handles: a publish that silently notifies nobody must fail here.
const recordOperatorNotificationMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const enqueueCampaignSubscriberEmailsMock = vi.hoisted(() => vi.fn(async () => ({ enqueued: 0 })));
vi.mock("@/lib/notifications/engagement", () => ({
  recordOperatorNotification: recordOperatorNotificationMock,
  enqueueCampaignSubscriberEmails: enqueueCampaignSubscriberEmailsMock,
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccess(...args),
  validateCampaignCategoryAccess: (...args: unknown[]) => validateCampaignCategoryAccess(...args),
}));
vi.mock("@/lib/engagement/ai-synthesis", () => ({
  generateEngagementSynthesis: (...args: unknown[]) => generateEngagementSynthesis(...args),
  SYNTHESIS_MAX_ITEMS: 300,
}));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  checkAiUsageRateLimit: (...args: unknown[]) => checkAiUsageRateLimit(...args),
  recordAiUsageEvent: (...args: unknown[]) => recordAiUsageEvent(...args),
}));

import { GET } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/route";
import { POST as DRAFT_POST } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/draft/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";

const listCtx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  createServiceRoleClientMock.mockReturnValue(fakeSupabase);
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  checkAiUsageRateLimit.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
  entryPriorStatus.mockResolvedValue({ data: { status: "draft" }, error: null }); // draft -> published transition
  loadCampaignAccess.mockResolvedValue({
    campaign: { id: CAMPAIGN_ID, workspace_id: "ws-1", title: "Campaign", share_token: "share-abc" },
    membership: { role: "editor" },
    error: null,
    allowed: true,
  });
  validateCampaignCategoryAccess.mockResolvedValue({ category: { id: "cat-1" }, error: null });
});

describe("close-loop operator routes", () => {
  it("GET 401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(new NextRequest(`http://localhost/x`), listCtx);
    expect(res.status).toBe(401);
  });

  it("GET 403 when the member lacks workspace access", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: { id: CAMPAIGN_ID }, membership: null, error: null, allowed: false });
    const res = await GET(new NextRequest(`http://localhost/x`), listCtx);
    expect(res.status).toBe(403);
  });

  it("GET returns the campaign's entries", async () => {
    entryListResolve.mockResolvedValue({ data: [{ id: ENTRY_ID, campaign_id: CAMPAIGN_ID, category_id: null, theme_title: "T", you_said: "Input", we_did: "Response", status: "draft", ai_assisted: false, source_item_ids: [], sort_order: 0, published_at: null, created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z" }], error: null });
    const res = await GET(new NextRequest(`http://localhost/x`), listCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(1);
  });

  it.each([
    [{ message: "SYNTHETIC database connection lost" }, 500],
    [{ message: 'relation "engagement_closeloop_entries" does not exist' }, 503],
  ])("GET refuses a failed read instead of returning an empty list: %j", async (error, status) => {
    entryListResolve.mockResolvedValue({ data: null, error });
    const res = await GET(new NextRequest("http://localhost/x"), listCtx);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).not.toHaveProperty("entries");
    expect(body.error).toMatch(/saved staff responses/i);
    expect(body.error).not.toContain("SYNTHETIC");
  });

  it("GET returns a successful empty list when the read actually succeeds", async () => {
    entryListResolve.mockResolvedValue({ data: [], error: null });
    const res = await GET(new NextRequest("http://localhost/x"), listCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

});

describe("close-loop draft route", () => {
  it("maps synthesis themes into drafts and surfaces the honest source", async () => {
    itemsResolve.mockResolvedValue({ data: [{ id: "a1", body: "x", title: null, category_id: null, latitude: null, longitude: null }], error: null });
    categoriesResolve.mockResolvedValue({ data: [], error: null });
    generateEngagementSynthesis.mockResolvedValue({
      source: "deterministic-fallback",
      model: null,
      fallback_reason: "missing_api_key",
      item_count: 1,
      analyzed_item_count: 1,
      overall_sentiment: "neutral",
      themes: [{ label: "Crossings", sentiment: "negative", item_count: 1, fact_ids: ["item_a1"], summary: "safer crossings" }],
      narrative: "…",
      grounding: { facts: [], claims: [] },
      caveat: "AI offline.",
    });

    const res = await DRAFT_POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("deterministic-fallback");
    expect(body.fallbackReason).toBe("missing_api_key");
    expect(body.drafts).toEqual([{ themeTitle: "Crossings", youSaid: "safer crossings", sourceItemIds: ["a1"] }]);
    // The deterministic fallback made no model call, so nothing is metered.
    expect(recordAiUsageEvent).not.toHaveBeenCalled();
  });

  it("meters a successful AI synthesis into the engagement_synthesis bucket", async () => {
    itemsResolve.mockResolvedValue({ data: [{ id: "a1", body: "x", title: null, category_id: null, latitude: null, longitude: null }], error: null });
    categoriesResolve.mockResolvedValue({ data: [], error: null });
    generateEngagementSynthesis.mockResolvedValue({
      source: "ai",
      model: "claude-haiku-4-5-20251001",
      fallback_reason: null,
      item_count: 1,
      analyzed_item_count: 1,
      overall_sentiment: "neutral",
      themes: [{ label: "Crossings", sentiment: "negative", item_count: 1, fact_ids: ["item_a1"], summary: "safer crossings" }],
      narrative: "…",
      grounding: { facts: [], claims: [] },
      caveat: "c",
    });

    const res = await DRAFT_POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);
    expect(res.status).toBe(200);
    expect(recordAiUsageEvent).toHaveBeenCalledTimes(1);
    expect(recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", bucketKey: "engagement_synthesis" })
    );
  });

  it("draft route 429 without a model call when the workspace AI allowance is exhausted", async () => {
    checkAiUsageRateLimit.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 300 });
    const res = await DRAFT_POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    expect(generateEngagementSynthesis).not.toHaveBeenCalled();
    expect(recordAiUsageEvent).not.toHaveBeenCalled();
  });

  it("draft route 403 without write access", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: { id: CAMPAIGN_ID }, membership: null, error: null, allowed: false });
    const res = await DRAFT_POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);
    expect(res.status).toBe(403);
  });
});
