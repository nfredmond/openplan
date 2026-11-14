import { NextRequest } from "next/server";
import { createAiUsageMeterFake, reserveThroughFakeMeter } from "./helpers/ai-usage-meter-fake";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignAccess = vi.fn();
const validateCampaignCategoryAccess = vi.fn();
const getUser = vi.fn();
const generateEngagementSynthesis = vi.fn();
const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const reserveAiUsageMock = vi.fn();
const keySourceMock = vi.fn();
const meter = createAiUsageMeterFake();

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
// The real limiter module, with its reservation routed through the fake meter.
vi.mock("@/lib/runtime/ai-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime/ai-rate-limit")>()),
  reserveAiUsage: (...args: unknown[]) => reserveAiUsageMock(...args),
}));
// Who pays for the call, as the AI limiter sees it.
vi.mock("@/lib/integrations/anthropic-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/anthropic-access")>()),
  anthropicKeySource: () => keySourceMock(),
}));

import { GET } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/route";
import { POST as DRAFT_POST } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/draft/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";

const listCtx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

beforeEach(async () => {
  vi.clearAllMocks();
  createServiceRoleClientMock.mockReturnValue(fakeSupabase);
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  keySourceMock.mockReturnValue("env");
  meter.count.mockResolvedValue({ count: 0, error: null });
  meter.insert.mockResolvedValue({ error: null });
  reserveAiUsageMock.mockImplementation(await reserveThroughFakeMeter(meter));
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
    // The deterministic fallback made no model call, so nothing is counted.
    expect(reserveAiUsageMock).not.toHaveBeenCalled();
    expect(meter.insert).not.toHaveBeenCalled();
  });

  describe("the synthesis model call is counted before it is made (KI-2026-10-12-014)", () => {
    // Stands in for the engine's model call. The engine itself is mocked here;
    // engagement-ai-synthesis.test.ts proves it reserves before generateText.
    const modelCall = vi.fn();
    const aiSynthesis = {
      source: "ai",
      model: "SYNTHETIC-model",
      fallback_reason: null,
      item_count: 1,
      analyzed_item_count: 1,
      overall_sentiment: "neutral",
      themes: [{ label: "Crossings", sentiment: "negative", item_count: 1, fact_ids: ["item_a1"], summary: "safer crossings" }],
      narrative: "Narrative.",
      grounding: { facts: [], claims: [] },
      caveat: "c",
    };
    const draft = () => DRAFT_POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);

    beforeEach(() => {
      itemsResolve.mockResolvedValue({ data: [{ id: "a1", body: "x", title: null, category_id: null, latitude: null, longitude: null }], error: null });
      categoriesResolve.mockResolvedValue({ data: [], error: null });
      generateEngagementSynthesis.mockImplementation(
        async (_items: unknown, options: { reserveUsage: (call: { model: string }) => Promise<void> }) => {
          await options.reserveUsage({ model: "SYNTHETIC-model" });
          modelCall();
          return aiSynthesis;
        }
      );
    });

    it("records the usage event with the engagement_synthesis keys before the call", async () => {
      const res = await draft();
      expect(res.status).toBe(200);
      expect(reserveAiUsageMock).toHaveBeenCalledTimes(1);
      expect(reserveAiUsageMock).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        bucketKey: "engagement_synthesis",
        eventKey: "engagement_closeloop_draft",
        sourceRoute: "/api/engagement/campaigns/[campaignId]/closeloop/draft",
        metadataJson: { model: "SYNTHETIC-model", analyzedItemCount: 1 },
      });
      expect(meter.insert).toHaveBeenCalledTimes(1);
      expect(meter.insert.mock.invocationCallOrder[0]).toBeLessThan(modelCall.mock.invocationCallOrder[0]);
    });

    it("429 without a model call when the workspace AI allowance is used up", async () => {
      meter.count.mockResolvedValue({ count: 20, error: null });
      const res = await draft();
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("300");
      expect(await res.json()).toEqual({ error: "Too many AI requests in a short window. Please wait a moment and try again." });
      expect(modelCall).not.toHaveBeenCalled();
      expect(meter.insert).not.toHaveBeenCalled();
    });

    it.each([
      ["the usage lookup", () => meter.count.mockResolvedValue({ count: null, error: { message: "SYNTHETIC count failure" } })],
      ["the usage record", () => meter.insert.mockResolvedValue({ error: { message: "SYNTHETIC insert failure" } })],
    ])("makes no call when %s fails and the deployment's shared key pays", async (_label, breakMeter) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      breakMeter();
      const res = await draft();
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain("SYNTHETIC");
      expect(modelCall).not.toHaveBeenCalled();
    });

    it("still calls the model on the workspace's own key when the usage meter fails", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      keySourceMock.mockReturnValue("workspace");
      meter.count.mockResolvedValue({ count: null, error: { message: "SYNTHETIC count failure" } });
      meter.insert.mockResolvedValue({ error: { message: "SYNTHETIC insert failure" } });
      const res = await draft();
      expect(res.status).toBe(200);
      expect(modelCall).toHaveBeenCalledTimes(1);
    });
  });

  it("draft route 403 without write access", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: { id: CAMPAIGN_ID }, membership: null, error: null, allowed: false });
    const res = await DRAFT_POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);
    expect(res.status).toBe(403);
  });
});
