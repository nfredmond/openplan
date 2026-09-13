import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmSubscription,
  enqueueCampaignSubscriberEmails,
  enqueueEmail,
  markNotificationRead,
  recordOperatorNotification,
  subscribeParticipant,
  unsubscribeByToken,
} from "@/lib/notifications/engagement";

describe("engagement notifications lib", () => {
  const original = process.env.RESEND_API_KEY;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY; // transport unconfigured -> honest skip
  });
  afterEach(() => {
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
    vi.restoreAllMocks();
  });

  it("recordOperatorNotification inserts an inbox row and reports ok", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn(() => ({ insert })) } as never;
    const result = await recordOperatorNotification(client, { workspaceId: "w1", campaignId: "c1", type: "survey_response", title: "New response" });
    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "w1", campaign_id: "c1", type: "survey_response" }));
  });

  it("enqueueEmail writes the outbox row then marks it 'skipped' when no transport is configured", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "o1" }, error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: updateEq }));
    const client = { from: vi.fn(() => ({ insert: () => ({ select: () => ({ single }) }), update })) } as never;

    const result = await enqueueEmail(client, { campaignId: "c1", to: "a@example.com", subject: "s", text: "t" });
    expect(result.outboxId).toBe("o1");
    expect(result.status).toBe("skipped"); // honest: recorded but not delivered
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", transport: "none" }));
  });

  it.each([
    ["database error", { data: null, error: { message: "outbox unavailable" } }],
    ["error alongside a row", { data: { id: "o1" }, error: { message: "ambiguous write" } }],
    ["missing row", { data: null, error: null }],
    ["missing identity", { data: {}, error: null }],
    ["invalid identity", { data: { id: 42 }, error: null }],
    ["empty identity", { data: { id: " " }, error: null }],
  ])("does not attempt email delivery after %s", async (_label, reply) => {
    process.env.RESEND_API_KEY = "SYNTHETIC-LOCAL-TEST-NOT-A-KEY";
    const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const select = vi.fn(() => ({ single: vi.fn().mockResolvedValue(reply) }));
    const client = { from: vi.fn(() => ({ insert: () => ({ select }), update: () => ({ eq: async () => ({ error: null }) }) })) } as never;
    const outcome = await enqueueEmail(client, { campaignId: "c1", to: "synthetic@example.invalid", subject: "s", text: "t" });
    expect(select).toHaveBeenCalledWith("id");
    expect(transport).not.toHaveBeenCalled();
    expect(outcome).toEqual({ outboxId: null, status: "failed", transport: "resend" });
  });

  it("attempts configured delivery only after the outbox identity is saved", async () => {
    process.env.RESEND_API_KEY = "SYNTHETIC-LOCAL-TEST-NOT-A-KEY";
    const order: string[] = [];
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { order.push("transport"); return new Response("{}", { status: 200 }); });
    const select = vi.fn(() => ({ single: async () => { order.push("insert"); return { data: { id: "saved-outbox" }, error: null }; } }));
    const update = vi.fn(() => ({ eq: async () => { order.push("receipt"); return { error: null }; } }));
    const client = { from: vi.fn(() => ({ insert: () => ({ select }), update })) } as never;
    expect(await enqueueEmail(client, { campaignId: "c1", to: "synthetic@example.invalid", subject: "s", text: "t" })).toEqual({ outboxId: "saved-outbox", status: "sent", transport: "resend" });
    expect(order).toEqual(["insert", "transport", "receipt"]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("counts only saved emails as enqueued and separates unavailable outbox writes", async () => {
    const is = vi.fn().mockResolvedValue({ data: [{ email: "a@example.invalid", unsubscribe_token: "a" }, { email: "b@example.invalid", unsubscribe_token: "b" }], error: null });
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "refused" } }).mockResolvedValueOnce({ data: { id: "saved" }, error: null });
    const client = { from: vi.fn((table: string) => table === "engagement_subscriptions"
      ? { select: () => ({ eq: () => ({ eq: () => ({ is }) }) }) }
      : { insert: () => ({ select: () => ({ single }) }), update: () => ({ eq: async () => ({ error: null }) }) }) } as never;
    const outcome = await enqueueCampaignSubscriberEmails(client, "c1", { subject: "s", text: "t" }, { origin: "https://agency.example.invalid", shareToken: "share" });
    expect(outcome).toEqual({ enqueued: 1, unrecorded: 1, delivered: 0, skipped: 1, failed: 0, transport: "none" });
  });

  it("enqueueCampaignSubscriberEmails sends each subscriber their OWN unsubscribe link", async () => {
    const subscribers = [
      { email: "a@x.com", unsubscribe_token: "tok-a" },
      { email: "b@x.com", unsubscribe_token: "tok-b" },
    ];
    // subscriptions read: select -> eq -> eq -> is -> resolves
    const isFn = vi.fn().mockResolvedValue({ data: subscribers, error: null });
    const selectFn = vi.fn(() => ({ eq: () => ({ eq: () => ({ is: isFn }) }) }));
    const single = vi.fn().mockResolvedValue({ data: { id: "o" }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn((table: string) => {
        if (table === "engagement_subscriptions") return { select: selectFn };
        return { insert, update: () => ({ eq: updateEq }) };
      }),
    } as never;

    const result = await enqueueCampaignSubscriberEmails(
      client,
      "c1",
      { subject: "Update", text: "Body" },
      { origin: "https://agency.example", shareToken: "share123" }
    );
    expect(result.enqueued).toBe(2);

    // Projection assertion (house rule): the token must actually be SELECTED —
    // the pre-2026-08-04 defect was selecting only `email`, so every broadcast
    // went out with no opt-out link while this suite stayed green.
    expect(selectFn).toHaveBeenCalledWith("email, unsubscribe_token");

    // Each outbox body carries that recipient's own tokenized unsubscribe URL,
    // in the same URL shape the subscribe confirmation email uses.
    const bodies = (insert.mock.calls as unknown as Array<[{ to_email: string; body: string }]>).map(
      (call) => call[0]
    );
    expect(bodies).toHaveLength(2);
    const byEmail = Object.fromEntries(bodies.map((row) => [row.to_email, row.body]));
    expect(byEmail["a@x.com"]).toContain("https://agency.example/api/engage/share123/subscribe/unsubscribe?token=tok-a");
    expect(byEmail["b@x.com"]).toContain("https://agency.example/api/engage/share123/subscribe/unsubscribe?token=tok-b");
    expect(byEmail["a@x.com"]).not.toContain("tok-b");
  });

  it("subscribeParticipant leaves an already-confirmed active subscriber untouched", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "s1", confirmed: true, unsubscribed_at: null }, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }), upsert })) } as never;

    const result = await subscribeParticipant(client, { campaignId: "c1", email: "a@x.com", fingerprint: "f", userAgent: null, confirmToken: "ct", unsubscribeToken: "ut" });
    expect(result.alreadyConfirmed).toBe(true);
    expect(upsert).not.toHaveBeenCalled(); // no re-confirmation churn
  });

  it("subscribeParticipant upserts a fresh unconfirmed row when none is active", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }), upsert })) } as never;

    const result = await subscribeParticipant(client, { campaignId: "c1", email: "a@x.com", fingerprint: "f", userAgent: null, confirmToken: "ct", unsubscribeToken: "ut" });
    expect(result.alreadyConfirmed).toBe(false);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ confirmed: false, confirm_token: "ct" }), { onConflict: "campaign_id,email" });
  });

  it("markNotificationRead double-scopes by id AND campaign_id", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "n1" }, error: null });
    const eqCampaign = vi.fn(() => ({ select: () => ({ maybeSingle }) }));
    const eqId = vi.fn(() => ({ eq: eqCampaign }));
    const update = vi.fn(() => ({ eq: eqId }));
    const client = { from: vi.fn(() => ({ update })) } as never;

    const result = await markNotificationRead(client, { notificationId: "n1", campaignId: "c1" });
    expect(result.found).toBe(true);
    expect(result.ok).toBe(true);
    expect(eqId).toHaveBeenCalledWith("id", "n1");
    expect(eqCampaign).toHaveBeenCalledWith("campaign_id", "c1");
  });

  // The two ways a write can change nothing are not the same news, and the
  // callers answer them differently — a 404 or a stale-link page for "no row",
  // a 500 for "the database refused". So the return value has to keep them apart.
  it("markNotificationRead reports a matched-nothing write as ok-but-not-found", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      from: vi.fn(() => ({ update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) }) })),
    } as never;

    expect(await markNotificationRead(client, { notificationId: "n1", campaignId: "c1" })).toEqual({
      ok: true,
      found: false,
    });
  });

  it("markNotificationRead reports a genuine database failure as not-ok", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    const client = {
      from: vi.fn(() => ({ update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) }) })),
    } as never;

    expect(await markNotificationRead(client, { notificationId: "n1", campaignId: "c1" })).toEqual({
      ok: false,
      found: false,
    });
  });

  it("confirmSubscription separates an unrecognized token from a refused write", async () => {
    const subscriptionClient = (result: unknown) =>
      ({
        from: vi.fn(() => ({
          update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: vi.fn().mockResolvedValue(result) }) }) }) }),
        })),
      }) as never;

    expect(await confirmSubscription(subscriptionClient({ data: null, error: null }), { campaignId: "c1", token: "t" })).toEqual({
      ok: true,
      found: false,
    });
    expect(
      await confirmSubscription(subscriptionClient({ data: null, error: { code: "42501", message: "denied" } }), {
        campaignId: "c1",
        token: "t",
      })
    ).toEqual({ ok: false, found: false });
  });

  it("unsubscribeByToken separates a spent link from a refused write", async () => {
    const tokenClient = (result: unknown) =>
      ({
        from: vi.fn(() => ({
          update: () => ({ eq: () => ({ select: () => ({ maybeSingle: vi.fn().mockResolvedValue(result) }) }) }),
        })),
      }) as never;

    expect(await unsubscribeByToken(tokenClient({ data: null, error: null }), "t")).toEqual({ ok: true, found: false });
    // Still subscribed: the caller must not be told "already unsubscribed".
    expect(await unsubscribeByToken(tokenClient({ data: null, error: { code: "42501", message: "denied" } }), "t")).toEqual({
      ok: false,
      found: false,
    });
  });
});
