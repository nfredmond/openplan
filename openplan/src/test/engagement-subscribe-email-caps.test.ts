import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePublicInputDatabase, type FakePublicInputDatabase } from "@/test/helpers/fake-public-input-tables";

/**
 * KI-2026-10-12-013 and relaunch review L-3: THE SUBSCRIBE FORM'S EMAIL.
 *
 * The form sends an email to any address typed into it, out of a daily email
 * quota shared with account confirmation and password reset. These tests run
 * the route and the real notifications library against a fake database that
 * evaluates the outbox filters, with only the email transport replaced.
 *
 * They also hold the route to one answer whether or not the address was
 * already subscribed: it used to say "You're already subscribed".
 */

let db: FakePublicInputDatabase;
const sendEmail = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => db.client }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/notifications/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  emailTransportName: () => "resend",
  isEmailTransportConfigured: () => true,
}));

import { POST } from "@/app/api/engage/[shareToken]/subscribe/route";
import {
  SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY,
  SUBSCRIBE_EMAILS_PER_CAMPAIGN_PER_DAY,
} from "@/lib/notifications/engagement";
import { buildPublicSubmissionClientFingerprint, PUBLIC_SUBMISSION_MAX_PER_WINDOW } from "@/lib/engagement/public-submit";

const CAMPAIGN_A = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_B = "33333333-3333-4333-8333-333333333333";

let requestCount = 0;
function subscribe(email: string, token = "share-token-a", ip?: string) {
  requestCount += 1;
  return POST(
    new NextRequest(`http://localhost/api/engage/${token}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `198.51.100.${requestCount % 250}` },
      body: JSON.stringify({ email }),
    }),
    { params: Promise.resolve({ shareToken: token }) }
  );
}

const outbox = () => db.table("engagement_email_outbox");

beforeEach(() => {
  requestCount = 0;
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ delivered: true, transport: "resend" });
  db = createFakePublicInputDatabase(
    {
      engagement_campaigns: [
        { id: CAMPAIGN_A, title: "Main Street", status: "active", share_token: "share-token-a" },
        { id: CAMPAIGN_B, title: "Harbor Road", status: "active", share_token: "share-token-b" },
      ],
      engagement_subscriptions: [
        {
          id: "existing",
          campaign_id: CAMPAIGN_A,
          email: "subscribed@example.org",
          confirmed: true,
          unsubscribed_at: null,
          confirm_token: "old-confirm",
          unsubscribe_token: "existing-unsubscribe-token",
          created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    },
    { unique: { engagement_subscriptions: [["campaign_id", "email"]] } }
  );
});

describe("emails to one address", () => {
  it("stop after the daily limit, counted across campaigns", async () => {
    const statuses: number[] = [];
    for (const token of ["share-token-a", "share-token-b", "share-token-a", "share-token-b"]) {
      statuses.push((await subscribe("Someone@Example.org", token)).status);
    }

    expect(SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY).toBe(3);
    expect(statuses).toEqual([201, 201, 201, 429]);
    expect(sendEmail).toHaveBeenCalledTimes(SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY);
    expect(outbox().filter((row) => row.to_email === "someone@example.org")).toHaveLength(SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY);
  });

  it("count only the last day", async () => {
    outbox().push(
      ...Array.from({ length: SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY }, (_, index) => ({
        id: `old-${index}`,
        campaign_id: CAMPAIGN_A,
        to_email: "someone@example.org",
        template: "subscribe_confirm",
        status: "sent",
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      }))
    );
    expect((await subscribe("someone@example.org")).status).toBe(201);
  });
});

describe("emails for one campaign", () => {
  it("stop after the daily limit, whoever asks", async () => {
    for (let index = 0; index < SUBSCRIBE_EMAILS_PER_CAMPAIGN_PER_DAY; index += 1) {
      expect((await subscribe(`person${index}@example.org`)).status).toBe(201);
    }
    const refused = await subscribe("one-more@example.org");

    expect(refused.status).toBe(429);
    expect(sendEmail).toHaveBeenCalledTimes(SUBSCRIBE_EMAILS_PER_CAMPAIGN_PER_DAY);
    // Another campaign still has its own allowance.
    expect((await subscribe("one-more@example.org", "share-token-b")).status).toBe(201);
  });

  it("are not passed by a burst of parallel sign-ups", async () => {
    const responses = await Promise.all(
      Array.from({ length: SUBSCRIBE_EMAILS_PER_CAMPAIGN_PER_DAY + 15 }, (_, index) => subscribe(`burst${index}@example.org`))
    );

    expect(sendEmail.mock.calls.length).toBeLessThanOrEqual(SUBSCRIBE_EMAILS_PER_CAMPAIGN_PER_DAY);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(sendEmail.mock.calls.length);
    // Every refused message is on record as not sent.
    expect(outbox().filter((row) => row.status === "sent")).toHaveLength(sendEmail.mock.calls.length);
  });

  it("are counted from the outbox with exactly the filters the limits need", async () => {
    await subscribe("someone@example.org");
    const counts = db.queriesFor("engagement_email_outbox").filter((query) => query.action === "select");
    const byAddress = counts.filter((query) => query.ops.some((op) => op.verb === "eq" && op.args[0] === "to_email"));
    const byCampaign = counts.filter((query) => query.ops.some((op) => op.verb === "eq" && op.args[0] === "campaign_id"));

    const byConnection = byCampaign.filter((query) =>
      query.ops.some((op) => op.verb === "eq" && op.args[0] === "payload_json->>source_fingerprint")
    );
    const campaignDay = byCampaign.filter((query) => !byConnection.includes(query));
    const windowOf = (query: (typeof counts)[number]) =>
      Date.now() - Date.parse(query.ops.find((op) => op.verb === "gte" && op.args[0] === "created_at")?.args[1] as string);

    // Once before anything is written and once after the message is recorded.
    expect(byAddress).toHaveLength(2);
    expect(campaignDay).toHaveLength(2);
    expect(byConnection).toHaveLength(2);
    for (const query of [...byAddress, ...campaignDay, ...byConnection]) {
      expect(query.countMode).toBe("exact");
      expect(query.head).toBe(true);
      expect(query.ops).toContainEqual({ verb: "in", args: ["template", ["subscribe_confirm", "subscribe_already"]] });
    }
    for (const query of [...byAddress, ...campaignDay]) {
      expect(Math.abs(windowOf(query) - 24 * 60 * 60 * 1000)).toBeLessThan(60 * 1000);
    }
    for (const query of byConnection) {
      expect(Math.abs(windowOf(query) - 10 * 60 * 1000)).toBeLessThan(60 * 1000);
      expect(query.ops).toContainEqual({ verb: "eq", args: ["campaign_id", CAMPAIGN_A] });
    }
    expect(byAddress[0].ops).toContainEqual({ verb: "eq", args: ["to_email", "someone@example.org"] });
    expect(byAddress[0].ops.some((op) => op.args[0] === "campaign_id")).toBe(false);
    expect(campaignDay[0].ops).toContainEqual({ verb: "eq", args: ["campaign_id", CAMPAIGN_A] });
  });
});

describe("emails from one connection", () => {
  it("count an already-subscribed address like any other, and a repeat request too", async () => {
    const room = "203.0.113.50";
    const addresses = [
      "subscribed@example.org",
      "repeat@example.org",
      "repeat@example.org",
      ...Array.from({ length: PUBLIC_SUBMISSION_MAX_PER_WINDOW - 3 }, (_, index) => `neighbour${index}@example.org`),
    ];
    for (const address of addresses) expect((await subscribe(address, "share-token-a", room)).status).toBe(201);

    const refused = await subscribe("one-more@example.org", "share-token-a", room);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toMatch(/this connection/);
    // The connection is kept with each email so the limit can count it.
    const fingerprint = buildPublicSubmissionClientFingerprint(
      new NextRequest("http://localhost/", { headers: { "x-forwarded-for": room } })
    );
    expect(outbox().filter((row) => (row.payload_json as { source_fingerprint?: string }).source_fingerprint === fingerprint)).toHaveLength(
      PUBLIC_SUBMISSION_MAX_PER_WINDOW
    );
  });
});

describe("an address that is already subscribed", () => {
  it("gets the same answer as one that is not", async () => {
    const subscribed = await subscribe("subscribed@example.org");
    const fresh = await subscribe("fresh@example.org");

    expect(subscribed.status).toBe(fresh.status);
    expect(await subscribed.json()).toEqual(await fresh.json());
  });

  it("gets the same answer when the email fails, too", async () => {
    sendEmail.mockResolvedValue({ delivered: false, transport: "resend", error: "refused" });
    const subscribed = await subscribe("subscribed@example.org");
    const fresh = await subscribe("fresh@example.org");

    expect(subscribed.status).toBe(fresh.status);
    expect(await subscribed.json()).toEqual(await fresh.json());
  });

  it("reaches the daily limit at the same point", async () => {
    const statuses = async (email: string) => {
      const result: number[] = [];
      for (let index = 0; index <= SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY; index += 1) result.push((await subscribe(email)).status);
      return result;
    };
    expect(await statuses("subscribed@example.org")).toEqual(await statuses("fresh@example.org"));
  });

  it("is told by email that it is already subscribed, with its own stop link and no new confirmation", async () => {
    await subscribe("subscribed@example.org");
    const [message] = sendEmail.mock.calls[0] as [{ to: string; subject: string; text: string }];

    expect(message.to).toBe("subscribed@example.org");
    expect(message.subject).toMatch(/already get updates/);
    expect(message.text).toContain("subscribe/unsubscribe?token=existing-unsubscribe-token");
    expect(message.text).not.toContain("subscribe/confirm");
    // The confirmed subscription is left as it was.
    expect(db.table("engagement_subscriptions").find((row) => row.id === "existing")).toMatchObject({
      confirmed: true,
      confirm_token: "old-confirm",
    });
    const lookup = db
      .queriesFor("engagement_subscriptions")
      .find((query) => query.ops.some((op) => op.verb === "maybeSingle"));
    expect(lookup?.projection).toContain("unsubscribe_token");
  });
});
