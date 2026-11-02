import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiUsageMeterFake, reserveThroughFakeMeter } from "./helpers/ai-usage-meter-fake";

const loadCampaignAccess = vi.fn();
const getUser = vi.fn();
const itemsLimit = vi.fn();
const updateEq = vi.fn();
const updateFn = vi.fn((_payload: Record<string, unknown>) => ({ eq: updateEq }));
const generateTextMock = vi.fn();
const reserveAiUsageMock = vi.fn();
const keySourceMock = vi.fn();
const meter = createAiUsageMeterFake();

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
vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => generateTextMock(...a),
  wrapLanguageModel: ({ model }: { model: unknown }) => model,
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model", createAnthropic: () => () => "mock-model" }));
// The real limiter module, with its reservation routed through the fake meter.
vi.mock("@/lib/runtime/ai-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime/ai-rate-limit")>()),
  reserveAiUsage: (...a: unknown[]) => reserveAiUsageMock(...a),
}));
// Who pays for the call, as the AI limiter sees it.
vi.mock("@/lib/integrations/anthropic-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/anthropic-access")>()),
  anthropicKeySource: () => keySourceMock(),
}));

import { POST } from "@/app/api/engagement/campaigns/[campaignId]/moderation-scan/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };
const req = () => new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/moderation-scan`, { method: "POST" });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  delete process.env.ANTHROPIC_API_KEY; // exercise the deterministic path (no external call)
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCampaignAccess.mockResolvedValue({ campaign: { workspace_id: "ws-1" }, error: null, allowed: true });
  keySourceMock.mockReturnValue("env");
  meter.count.mockResolvedValue({ count: 0, error: null });
  meter.insert.mockResolvedValue({ error: null });
  reserveAiUsageMock.mockImplementation(await reserveThroughFakeMeter(meter));
  itemsLimit.mockResolvedValue({
    data: [
      { id: "i1", title: null, body: "contact me at jane@example.com about the crosswalk", metadata_json: { existing: 1 } },
      { id: "i2", title: null, body: "The bus stop needs a shelter.", metadata_json: null },
    ],
    error: null,
  });
  updateEq.mockResolvedValue({ error: null });
  generateTextMock.mockResolvedValue({
    text: JSON.stringify({
      items: [
        { item_id: "i1", flags: ["pii"], severity: "medium", rationale: "Contains an email address." },
        { item_id: "i2", flags: [], severity: "none", rationale: "On topic." },
      ],
    }),
  });
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

    // The deterministic fallback made no model call, so nothing is counted
    // against the workspace's AI allowance.
    expect(reserveAiUsageMock).not.toHaveBeenCalled();
    expect(meter.insert).not.toHaveBeenCalled();
  });
});

describe("the moderation scan counts its model call before making it (KI-2026-10-12-014)", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  });

  it("records the usage event before the model call, with the moderation bucket and event keys", async () => {
    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect((await res.json()).moderation.source).toBe("ai");
    expect(reserveAiUsageMock).toHaveBeenCalledTimes(1);
    expect(reserveAiUsageMock).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      bucketKey: "engagement_moderation",
      eventKey: "engagement_moderation_scan",
      sourceRoute: "/api/engagement/campaigns/[campaignId]/moderation-scan",
      metadataJson: { model: expect.any(String), itemCount: 2 },
    });
    expect(meter.insert).toHaveBeenCalledTimes(1);
    expect(meter.insert.mock.invocationCallOrder[0]).toBeLessThan(generateTextMock.mock.invocationCallOrder[0]);
  });

  it("429 with no model call and no assessment written when the allowance is used up", async () => {
    meter.count.mockResolvedValue({ count: 20, error: null });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    expect(await res.json()).toEqual({ error: "Too many AI requests in a short window. Please wait a moment and try again." });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(meter.insert).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it.each([
    ["the usage lookup", () => meter.count.mockResolvedValue({ count: null, error: { message: "SYNTHETIC count failure" } })],
    ["the usage record", () => meter.insert.mockResolvedValue({ error: { message: "SYNTHETIC insert failure" } })],
  ])("makes no call when %s fails and the deployment's shared key pays", async (_label, breakMeter) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    breakMeter();

    const res = await POST(req(), ctx);

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("SYNTHETIC");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("still calls the model on the workspace's own key when the usage meter fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    keySourceMock.mockReturnValue("workspace");
    meter.count.mockResolvedValue({ count: null, error: { message: "SYNTHETIC count failure" } });
    meter.insert.mockResolvedValue({ error: { message: "SYNTHETIC insert failure" } });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the reservation when the model call fails", async () => {
    generateTextMock.mockRejectedValue(new Error("model unavailable"));

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect((await res.json()).moderation.fallback_reason).toBe("generation_error");
    expect(meter.insert).toHaveBeenCalledTimes(1);
  });
});
