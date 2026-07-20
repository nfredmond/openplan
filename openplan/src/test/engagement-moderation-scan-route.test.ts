import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignAccess = vi.fn();
const getUser = vi.fn();
const itemsLimit = vi.fn();
const updateEq = vi.fn();
const updateFn = vi.fn((_payload: Record<string, unknown>) => ({ eq: updateEq }));
const checkAiUsageRateLimit = vi.fn();

const fakeSupabase = {
  auth: { getUser },
  from: vi.fn((table: string) => {
    if (table !== "engagement_items") throw new Error(`unexpected table ${table}`);
    const select = () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: itemsLimit }) }) }) });
    return { select, update: updateFn };
  }),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fakeSupabase) }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: (...a: unknown[]) => loadCampaignAccess(...a) }));
vi.mock("@/lib/billing/ai-rate-limit", () => ({ checkAiUsageRateLimit: (...a: unknown[]) => checkAiUsageRateLimit(...a) }));

import { POST } from "@/app/api/engagement/campaigns/[campaignId]/moderation-scan/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };
const req = () => new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/moderation-scan`, { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY; // exercise the deterministic path (no external call)
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCampaignAccess.mockResolvedValue({ campaign: { workspace_id: "ws-1" }, error: null, allowed: true });
  checkAiUsageRateLimit.mockResolvedValue({ allowed: true });
  itemsLimit.mockResolvedValue({
    data: [
      { id: "i1", title: null, body: "contact me at jane@example.com about the crosswalk", metadata_json: { existing: 1 } },
      { id: "i2", title: null, body: "The bus stop needs a shelter.", metadata_json: null },
    ],
    error: null,
  });
  updateEq.mockResolvedValue({ error: null });
});

describe("POST /api/engagement/campaigns/[campaignId]/moderation-scan", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req(), ctx)).status).toBe(401);
  });

  it("404 when the campaign is not found", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: null, error: null });
    expect((await POST(req(), ctx)).status).toBe(404);
  });

  it("403 when the member lacks engagement.write", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: { workspace_id: "ws-1" }, error: null, allowed: false });
    expect((await POST(req(), ctx)).status).toBe(403);
  });

  it("429 when rate limited", async () => {
    checkAiUsageRateLimit.mockResolvedValue({ allowed: false, count: 99, retryAfterSeconds: 42 });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(429);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("scans the queue, flags PII, and merges the assessment into metadata_json (never overwriting)", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moderation.source).toBe("deterministic-fallback");
    expect(body.moderation.item_count).toBe(2);
    expect(body.moderation.flagged_count).toBe(1);

    // i1 (PII) update preserves the existing key + adds ai_moderation with pii
    const payloads = updateFn.mock.calls.map(
      (call) => call[0] as { metadata_json?: { ai_moderation?: { flags?: string[] }; existing?: number }; status?: unknown }
    );
    const i1Update = payloads.find((p) => p.metadata_json?.ai_moderation?.flags?.includes("pii"));
    expect(i1Update).toBeTruthy();
    expect(i1Update!.metadata_json!.existing).toBe(1);
    // both items get an assessment written; status is never touched
    expect(updateFn).toHaveBeenCalledTimes(2);
    for (const payload of payloads) {
      expect(payload.status).toBeUndefined();
    }
  });
});
