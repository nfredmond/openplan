import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueCampaignSubscriberEmails,
  enqueueEmail,
  markNotificationRead,
  recordOperatorNotification,
  subscribeParticipant,
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

  it("enqueueCampaignSubscriberEmails enqueues one message per confirmed subscriber", async () => {
    const subscribers = [{ email: "a@x.com" }, { email: "b@x.com" }];
    // subscriptions read: select -> eq -> eq -> is -> resolves
    const isFn = vi.fn().mockResolvedValue({ data: subscribers, error: null });
    const single = vi.fn().mockResolvedValue({ data: { id: "o" }, error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn((table: string) => {
        if (table === "engagement_subscriptions") return { select: () => ({ eq: () => ({ eq: () => ({ is: isFn }) }) }) };
        return { insert: () => ({ select: () => ({ single }) }), update: () => ({ eq: updateEq }) };
      }),
    } as never;

    const result = await enqueueCampaignSubscriberEmails(client, "c1", { subject: "Update", text: "Body" });
    expect(result.enqueued).toBe(2);
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
    expect(eqId).toHaveBeenCalledWith("id", "n1");
    expect(eqCampaign).toHaveBeenCalledWith("campaign_id", "c1");
  });
});
