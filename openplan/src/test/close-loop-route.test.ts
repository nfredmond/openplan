import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignAccess = vi.fn();
const validateCampaignCategoryAccess = vi.fn();
const getUser = vi.fn();
const generateEngagementSynthesis = vi.fn();

// Terminal resolvers for the engagement_closeloop_entries chains.
const entryInsertSingle = vi.fn();
const entryUpdateMaybeSingle = vi.fn();
const entryDelete = vi.fn();
const entryListResolve = vi.fn();
// Draft route reads.
const itemsResolve = vi.fn();
const categoriesResolve = vi.fn();

const fakeSupabase = {
  auth: { getUser },
  from: vi.fn((table: string) => {
    if (table === "engagement_closeloop_entries") {
      return {
        insert: () => ({ select: () => ({ single: entryInsertSingle }) }),
        update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: entryUpdateMaybeSingle }) }) }) }),
        delete: () => ({ eq: () => ({ eq: () => entryDelete() }) }),
        select: () => ({ eq: () => ({ order: () => ({ order: entryListResolve }) }) }),
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

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fakeSupabase) }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccess(...args),
  validateCampaignCategoryAccess: (...args: unknown[]) => validateCampaignCategoryAccess(...args),
}));
vi.mock("@/lib/engagement/ai-synthesis", () => ({
  generateEngagementSynthesis: (...args: unknown[]) => generateEngagementSynthesis(...args),
  SYNTHESIS_MAX_ITEMS: 300,
}));

import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/route";
import { PATCH, DELETE } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/[entryId]/route";
import { POST as DRAFT_POST } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/draft/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";

function jsonRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/closeloop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const listCtx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };
const entryCtx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCampaignAccess.mockResolvedValue({
    campaign: { id: CAMPAIGN_ID, workspace_id: "ws-1" },
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
    entryListResolve.mockResolvedValue({ data: [{ id: ENTRY_ID, theme_title: "T" }], error: null });
    const res = await GET(new NextRequest(`http://localhost/x`), listCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(1);
  });

  it("POST creates a draft entry (201)", async () => {
    entryInsertSingle.mockResolvedValue({ data: { id: ENTRY_ID, theme_title: "Crossings", status: "draft" }, error: null });
    const res = await POST(jsonRequest({ themeTitle: "Crossings", youSaid: "safer" }), listCtx);
    expect(res.status).toBe(201);
    expect((await res.json()).entryId).toBe(ENTRY_ID);
  });

  it("POST 400 when themeTitle is missing", async () => {
    const res = await POST(jsonRequest({ youSaid: "no title" }), listCtx);
    expect(res.status).toBe(400);
  });

  it("PATCH double-scopes by id AND campaign_id and 404s a foreign entry", async () => {
    entryUpdateMaybeSingle.mockResolvedValue({ data: null, error: null }); // no row matched both scopes
    const req = new NextRequest("http://localhost/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "published" }),
    });
    const res = await PATCH(req, entryCtx);
    expect(res.status).toBe(404);
  });

  it("PATCH publishes and returns the updated row", async () => {
    entryUpdateMaybeSingle.mockResolvedValue({ data: { id: ENTRY_ID, status: "published" }, error: null });
    const req = new NextRequest("http://localhost/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "published" }),
    });
    const res = await PATCH(req, entryCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).entry.status).toBe("published");
  });

  it("DELETE removes the entry (ok:true)", async () => {
    entryDelete.mockResolvedValue({ error: null });
    const res = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), entryCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
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
  });

  it("draft route 403 without write access", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: { id: CAMPAIGN_ID }, membership: null, error: null, allowed: false });
    const res = await DRAFT_POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);
    expect(res.status).toBe(403);
  });
});
