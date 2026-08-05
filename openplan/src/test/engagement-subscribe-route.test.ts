import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/engage/[shareToken]/subscribe/confirm — the page a member of the
 * public lands on from a confirmation email.
 *
 * THE DEFECT THIS FILE EXISTS FOR: the campaign lookup bound only `{ data }`, so
 * a read that FAILED and a read that found no campaign produced the same `null`
 * — and the visitor was told "Confirmation link expired". Their link was fine.
 * They would have thrown it away and stayed unsubscribed over a fault on this
 * side, which is the read-error-as-absence class on a surface the public sees.
 *
 * The sibling `subscribe-route.test.ts` covers POST /subscribe (signing up);
 * this file covers only the confirmation landing.
 */

const campaignMaybeSingle = vi.fn();
const confirmSubscription = vi.fn();

const fakeSupabase = {
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: campaignMaybeSingle }) }) })),
};

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => fakeSupabase }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/notifications/engagement", () => ({
  confirmSubscription: (...args: unknown[]) => confirmSubscription(...args),
}));

import { GET } from "@/app/api/engage/[shareToken]/subscribe/confirm/route";

const TOKEN = "share-token-123456";
const CONFIRM_TOKEN = "confirm-token-abcdef";
const ctx = { params: Promise.resolve({ shareToken: TOKEN }) };

function confirmRequest(confirmToken = CONFIRM_TOKEN) {
  return new NextRequest(
    `http://localhost/api/engage/${TOKEN}/subscribe/confirm?token=${confirmToken}`,
    { method: "GET" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  campaignMaybeSingle.mockResolvedValue({ data: { id: "c1", title: "Downtown" }, error: null });
  confirmSubscription.mockResolvedValue({ ok: true, found: true });
});

describe("GET /api/engage/[shareToken]/subscribe/confirm", () => {
  it("confirms the subscription and names the campaign", async () => {
    const response = await GET(confirmRequest(), ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("You're subscribed");
    expect(confirmSubscription).toHaveBeenCalledWith(
      fakeSupabase,
      expect.objectContaining({ campaignId: "c1", token: CONFIRM_TOKEN })
    );
  });

  it("says the link expired only when the read SUCCEEDED and found no campaign", async () => {
    campaignMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await GET(confirmRequest(), ctx);

    expect(await response.text()).toContain("Confirmation link expired");
    expect(confirmSubscription).not.toHaveBeenCalled();
  });

  it("does not blame the visitor's link when the campaign read FAILED", async () => {
    campaignMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_campaigns" },
    });

    const response = await GET(confirmRequest(), ctx);
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).not.toContain("Confirmation link expired");
    expect(html).not.toMatch(/may have expired/i);
    expect(html).toContain("We couldn't confirm you just now");
    // Fail closed: nothing is written on the strength of a campaign we could not read.
    expect(confirmSubscription).not.toHaveBeenCalled();
  });

  it("answers 503 when the campaign read failed because the schema is not applied yet", async () => {
    campaignMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'relation "public.engagement_campaigns" does not exist' },
    });

    const response = await GET(confirmRequest(), ctx);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).not.toContain("Confirmation link expired");
    expect(confirmSubscription).not.toHaveBeenCalled();
  });

  it("keeps the honest wording when the confirmation WRITE fails", async () => {
    confirmSubscription.mockResolvedValue({ ok: false, found: false });

    const response = await GET(confirmRequest(), ctx);
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("We couldn't confirm you just now");
    expect(html).not.toMatch(/already have been used/i);
  });

  it("reports an unrecognized confirm token without claiming a failure", async () => {
    confirmSubscription.mockResolvedValue({ ok: true, found: false });

    const response = await GET(confirmRequest(), ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Confirmation link not recognized");
  });

  it("refuses a malformed link before reading anything", async () => {
    const response = await GET(confirmRequest(""), ctx);

    expect(await response.text()).toContain("Invalid confirmation link");
    expect(fakeSupabase.from).not.toHaveBeenCalled();
  });
});
