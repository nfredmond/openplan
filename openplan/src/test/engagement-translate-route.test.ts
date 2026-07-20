import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const campaignMaybeSingle = vi.fn();
const itemMaybeSingle = vi.fn();
const rpcMock = vi.fn();
const checkAiUsageRateLimit = vi.fn();
const recordUsageEventBestEffort = vi.fn();
const translateEngagementTextMock = vi.fn();

const fakeSupabase = {
  rpc: rpcMock,
  from: vi.fn((table: string) => {
    if (table === "engagement_campaigns") {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: campaignMaybeSingle }) }) }) };
    }
    if (table === "engagement_items") {
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: itemMaybeSingle }) }) }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => fakeSupabase,
  createClient: vi.fn(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/billing/ai-rate-limit", () => ({ checkAiUsageRateLimit: (...a: unknown[]) => checkAiUsageRateLimit(...a) }));
vi.mock("@/lib/billing/usage-recording", () => ({ recordUsageEventBestEffort: (...a: unknown[]) => recordUsageEventBestEffort(...a) }));
vi.mock("@/lib/engagement/translation", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, translateEngagementText: (...a: unknown[]) => translateEngagementTextMock(...a) };
});

import { POST } from "@/app/api/engage/[shareToken]/items/[itemId]/translate/route";

const SHARE = "test-share-token-12345";
const ITEM = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ shareToken: SHARE, itemId: ITEM }) };
const req = (language: unknown) =>
  new NextRequest(`http://localhost/api/engage/${SHARE}/items/${ITEM}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language }),
  });

const approvedItem = (metadata_json: Record<string, unknown> | null) => ({
  id: ITEM,
  title: null,
  body: "The crosswalk near Main Street needs a signal.",
  metadata_json,
});

beforeEach(() => {
  vi.clearAllMocks();
  campaignMaybeSingle.mockResolvedValue({ data: { id: "c1", workspace_id: "ws-1", status: "active" }, error: null });
  itemMaybeSingle.mockResolvedValue({ data: approvedItem(null), error: null });
  rpcMock.mockResolvedValue({ error: null });
  checkAiUsageRateLimit.mockResolvedValue({ allowed: true });
  recordUsageEventBestEffort.mockResolvedValue(undefined);
  translateEngagementTextMock.mockResolvedValue({ source: "ai", translated: "Necesita una señal.", model: "m", caveat: "c" });
});

describe("POST /api/engage/[shareToken]/items/[itemId]/translate", () => {
  it("400 for an unsupported language, before any lookup", async () => {
    const res = await POST(req("klingon"), ctx);
    expect(res.status).toBe(400);
    expect(fakeSupabase.from).not.toHaveBeenCalled();
  });

  it("404 when the campaign is not active / not found", async () => {
    campaignMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await POST(req("es"), ctx)).status).toBe(404);
  });

  it("404 when the item is not approved (same as missing — no enumeration)", async () => {
    itemMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await POST(req("es"), ctx);
    expect(res.status).toBe(404);
    expect(translateEngagementTextMock).not.toHaveBeenCalled();
    expect(checkAiUsageRateLimit).not.toHaveBeenCalled();
  });

  it("returns a cached translation without a model call or rate-limit charge", async () => {
    itemMaybeSingle.mockResolvedValue({ data: approvedItem({ ai_translations: { es: "cacheada" }, other: 1 }), error: null });
    const res = await POST(req("es"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ source: "cache", language: "es", translated: "cacheada" });
    expect(checkAiUsageRateLimit).not.toHaveBeenCalled();
    expect(translateEngagementTextMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("translates, caches via the atomic merge RPC, and records usage", async () => {
    const res = await POST(req("es"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ source: "ai", language: "es", translated: "Necesita una señal." });

    // Cache write is a single atomic jsonb-merge RPC (no client read-modify-write),
    // so concurrent per-language translations can't clobber each other.
    expect(rpcMock).toHaveBeenCalledWith("engagement_cache_item_translation", {
      p_item_id: ITEM,
      p_language: "es",
      p_translation: "Necesita una señal.",
    });
    expect(recordUsageEventBestEffort).toHaveBeenCalledTimes(1);
  });

  it("429 when the workspace AI rate limit is exhausted (no model call)", async () => {
    checkAiUsageRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const res = await POST(req("es"), ctx);
    expect(res.status).toBe(429);
    expect(translateEngagementTextMock).not.toHaveBeenCalled();
  });

  it("200 source:unavailable when AI is offline — original stays shown, nothing cached", async () => {
    translateEngagementTextMock.mockResolvedValue({ source: "unavailable", translated: null, model: null, caveat: "c" });
    const res = await POST(req("es"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ source: "unavailable", translated: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
