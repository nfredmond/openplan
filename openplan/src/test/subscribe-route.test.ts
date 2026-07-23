import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const campaignMaybeSingle = vi.fn();
const subscribeParticipant = vi.fn();
const loadRecentSubscriptionsByFingerprint = vi.fn();
const enqueueEmail = vi.fn();
const isEmailTransportConfigured = vi.fn();

const fakeSupabase = {
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: campaignMaybeSingle }) }) }) })),
};

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => fakeSupabase }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/notifications/engagement", () => ({
  subscribeParticipant: (...a: unknown[]) => subscribeParticipant(...a),
  loadRecentSubscriptionsByFingerprint: (...a: unknown[]) => loadRecentSubscriptionsByFingerprint(...a),
  enqueueEmail: (...a: unknown[]) => enqueueEmail(...a),
}));
vi.mock("@/lib/notifications/email", () => ({ isEmailTransportConfigured: () => isEmailTransportConfigured() }));

import { POST } from "@/app/api/engage/[shareToken]/subscribe/route";

const TOKEN = "share-token-123456";
const ctx = { params: Promise.resolve({ shareToken: TOKEN }) };

function req(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/engage/${TOKEN}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  campaignMaybeSingle.mockResolvedValue({ data: { id: "c1", title: "Downtown", status: "active" }, error: null });
  loadRecentSubscriptionsByFingerprint.mockResolvedValue([]);
  subscribeParticipant.mockResolvedValue({ ok: true, alreadyConfirmed: false });
  enqueueEmail.mockResolvedValue({ outboxId: "o1", status: "skipped", transport: "none" });
  isEmailTransportConfigured.mockReturnValue(false);
});

describe("POST /api/engage/[shareToken]/subscribe", () => {
  it("silently accepts + discards honeypot hits without recording a subscription", async () => {
    const res = await POST(req({ email: "a@example.com", website: "http://spam" }), ctx);
    expect(res.status).toBe(201);
    expect(subscribeParticipant).not.toHaveBeenCalled();
  });

  it("400 on an invalid email", async () => {
    const res = await POST(req({ email: "not-an-email" }), ctx);
    expect(res.status).toBe(400);
  });

  it("404 when the campaign is not active/public", async () => {
    campaignMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await POST(req({ email: "a@example.com" }), ctx);
    expect(res.status).toBe(404);
  });

  it("is HONEST when no email transport is configured — no promise of email", async () => {
    const res = await POST(req({ email: "a@example.com" }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transportConfigured).toBe(false);
    expect(body.message).toMatch(/not enabled|no confirmation email/i);
    expect(body.message).not.toMatch(/check your email/i);
  });

  it("promises a confirmation email only when transport is configured", async () => {
    isEmailTransportConfigured.mockReturnValue(true);
    const res = await POST(req({ email: "a@example.com" }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transportConfigured).toBe(true);
    expect(body.message).toMatch(/check your email/i);
    expect(enqueueEmail).toHaveBeenCalled();
  });

  it("429 when the per-connection rate limit is exceeded", async () => {
    const now = new Date().toISOString();
    loadRecentSubscriptionsByFingerprint.mockResolvedValue([{ created_at: now }, { created_at: now }, { created_at: now }]);
    const res = await POST(req({ email: "a@example.com" }), ctx);
    expect(res.status).toBe(429);
  });
});
