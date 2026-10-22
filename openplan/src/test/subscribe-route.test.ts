import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const campaignMaybeSingle = vi.fn();
const subscribeParticipant = vi.fn();
const enqueueEmail = vi.fn();
const isEmailTransportConfigured = vi.fn();
const countRecentSubscribeEmails = vi.fn();

const fakeSupabase = {
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: campaignMaybeSingle }) }) }) })),
};

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => fakeSupabase }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/notifications/engagement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/engagement")>();
  return {
    subscribeParticipant: (...a: unknown[]) => subscribeParticipant(...a),
    enqueueEmail: (...a: unknown[]) => enqueueEmail(...a),
    countRecentSubscribeEmails: (...a: unknown[]) => countRecentSubscribeEmails(...a),
    // The daily limits are arithmetic; engagement-subscribe-email-caps.test.ts covers them against data.
    subscribeEmailRefusal: actual.subscribeEmailRefusal,
  };
});
vi.mock("@/lib/notifications/email", () => ({ isEmailTransportConfigured: () => isEmailTransportConfigured() }));

import { POST } from "@/app/api/engage/[shareToken]/subscribe/route";
import { PUBLIC_SUBMISSION_MAX_PER_WINDOW } from "@/lib/engagement/public-submit";

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
  subscribeParticipant.mockResolvedValue({ ok: true, alreadyConfirmed: false, existingUnsubscribeToken: null });
  countRecentSubscribeEmails.mockResolvedValue({ fromConnection: 0, toAddress: 0, forCampaign: 0 });
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

  it("promises a confirmation email only after the transport accepts it", async () => {
    isEmailTransportConfigured.mockReturnValue(true);
    enqueueEmail.mockResolvedValue({ outboxId: "o1", status: "sent", transport: "resend" });
    const res = await POST(req({ email: "a@example.com" }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transportConfigured).toBe(true);
    expect(body.message).toMatch(/check your email/i);
    expect(enqueueEmail).toHaveBeenCalled();
  });

  it.each([
    ["outbox unavailable", { outboxId: null, status: "failed", transport: "resend" }, /could not be prepared/],
    ["transport refusal", { outboxId: "o1", status: "failed", transport: "resend" }, /could not be sent/],
    ["transport skipped", { outboxId: "o1", status: "skipped", transport: "none" }, /no confirmation email/],
  ])("does not promise confirmation after %s", async (_label, outcome, expected) => {
    isEmailTransportConfigured.mockReturnValue(true);
    enqueueEmail.mockResolvedValue(outcome);
    const res = await POST(req({ email: "a@example.invalid" }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.confirmationNeedsRetry).toBe(outcome.status === "failed");
    expect(body.message).toMatch(expected);
    expect(body.message).not.toMatch(/check your email/i);
  });

  it("answers an already confirmed address exactly as a new one, and tells the address by email", async () => {
    isEmailTransportConfigured.mockReturnValue(true);
    enqueueEmail.mockResolvedValue({ outboxId: "o1", status: "sent", transport: "resend" });
    const fresh = await (await POST(req({ email: "a@example.invalid" }), ctx)).json();
    subscribeParticipant.mockResolvedValue({ ok: true, alreadyConfirmed: true, existingUnsubscribeToken: "ut-1" });
    const subscribed = await (await POST(req({ email: "a@example.invalid" }), ctx)).json();

    expect(subscribed).toEqual(fresh);
    expect(subscribed).not.toHaveProperty("alreadyConfirmed");
    expect(subscribed.message).not.toMatch(/already/i);
    expect(enqueueEmail).toHaveBeenLastCalledWith(
      fakeSupabase,
      expect.objectContaining({ template: "subscribe_already", text: expect.stringContaining("token=ut-1") }),
      expect.objectContaining({ admit: expect.any(Function) })
    );
  });

  it("refuses before writing anything when the day's sign-up emails are used up", async () => {
    countRecentSubscribeEmails.mockResolvedValue({ fromConnection: 0, toAddress: 3, forCampaign: 0 });
    expect((await POST(req({ email: "a@example.com" }), ctx)).status).toBe(429);
    countRecentSubscribeEmails.mockResolvedValue({ fromConnection: 0, toAddress: 0, forCampaign: 30 });
    expect((await POST(req({ email: "a@example.com" }), ctx)).status).toBe(429);
    countRecentSubscribeEmails.mockResolvedValue(null);
    expect((await POST(req({ email: "a@example.com" }), ctx)).status).toBe(500);
    expect(subscribeParticipant).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it("answers 429 when the recount after recording refuses the email, and 500 when it cannot be read", async () => {
    enqueueEmail.mockImplementation(async (_client: unknown, _message: unknown, options: { admit: () => Promise<boolean> }) => {
      const admitted = await options.admit();
      return { outboxId: "o1", status: admitted ? "sent" : "skipped", transport: "resend", limited: !admitted };
    });
    countRecentSubscribeEmails
      .mockResolvedValueOnce({ fromConnection: 0, toAddress: 2, forCampaign: 0 })
      .mockResolvedValueOnce({ fromConnection: 0, toAddress: 4, forCampaign: 0 });
    const refused = await POST(req({ email: "a@example.com" }), ctx);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toMatch(/today/);

    countRecentSubscribeEmails
      .mockResolvedValueOnce({ fromConnection: 0, toAddress: 0, forCampaign: 0 })
      .mockResolvedValueOnce(null);
    expect((await POST(req({ email: "a@example.com" }), ctx)).status).toBe(500);
  });

  /**
   * L-3 of the hosted review: the reply used to say "You're already subscribed",
   * so anyone could test an address against a public campaign. A confirmed
   * address must get byte-for-byte the reply a new address gets, with the
   * transport on and off.
   */
  it.each([
    ["transport on", true, { outboxId: "o1", status: "sent", transport: "resend" }],
    ["transport off", false, { outboxId: "o1", status: "skipped", transport: "none" }],
  ])("does not reveal whether an address already subscribes (%s)", async (_label, configured, outcome) => {
    isEmailTransportConfigured.mockReturnValue(configured);
    enqueueEmail.mockResolvedValue(outcome);
    subscribeParticipant.mockResolvedValue({ ok: true, alreadyConfirmed: false });
    const fresh = await POST(req({ email: "new@example.invalid" }), ctx);
    subscribeParticipant.mockResolvedValue({ ok: true, alreadyConfirmed: true });
    const existing = await POST(req({ email: "old@example.invalid" }), ctx);
    expect(existing.status).toBe(fresh.status);
    expect(await existing.text()).toBe(await fresh.text());
  });

  it("429 when the per-connection rate limit is exceeded, and not one sign-up before", async () => {
    // The comment limit, shared: a meeting room on one Wi-Fi may sign up too.
    expect(PUBLIC_SUBMISSION_MAX_PER_WINDOW).toBe(12);
    const counts = (fromConnection: number) => ({ fromConnection, toAddress: 0, forCampaign: 0 });
    countRecentSubscribeEmails.mockResolvedValue(counts(PUBLIC_SUBMISSION_MAX_PER_WINDOW - 1));
    expect((await POST(req({ email: "a@example.com" }), ctx)).status).toBe(201);
    countRecentSubscribeEmails.mockResolvedValue(counts(PUBLIC_SUBMISSION_MAX_PER_WINDOW));
    const refused = await POST(req({ email: "a@example.com" }), ctx);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toMatch(/this connection/);
  });
});
