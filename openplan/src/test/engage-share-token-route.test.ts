import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/engage/[shareToken] — THE PUBLIC JSON READ OF A CONSULTATION.
 *
 * A READ THAT FAILED MAY NOT BE ANSWERED AS A READ THAT SUCCEEDED AND FOUND
 * NOTHING. This route destructured only `data` from its two list reads:
 *
 *     const [{ data: categories }, { data: approvedItems }] = await Promise.all([…]);
 *
 * and then answered **200** with `categories: []` and `approvedFeedback: []`.
 * To every consumer — an agency's own site embedding OpenPlan, a journalist, a
 * resident — that response is the agency stating that its consultation has no
 * topics and that nobody commented. A permission change, a dropped column or a
 * transient outage produced exactly the same bytes as a consultation nobody
 * participated in, and the 200 was the last place the difference existed.
 *
 * THE DOUBLE HAS TO BE ABLE TO FAIL A NAMED READ. A mocked Supabase client hands
 * back its fixture whatever the code asks for, which is precisely why this class
 * shipped undetected: the failure path was unreachable from any test. Each
 * terminal resolver below is separately settable, so a test can break the
 * comment read while the topic read still works, and vice versa.
 */

const campaignMaybeSingle = vi.fn();
const categoriesResolve = vi.fn();
const itemsResolve = vi.fn();

const auditError = vi.fn();

const fakeSupabase = {
  from: vi.fn((table: string) => {
    if (table === "engagement_campaigns") {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: campaignMaybeSingle }) }) }) };
    }
    if (table === "engagement_categories") {
      // select → eq(campaign_id) → order(sort_order) → order(created_at)
      return { select: () => ({ eq: () => ({ order: () => ({ order: categoriesResolve }) }) }) };
    }
    if (table === "engagement_items") {
      // select → eq(campaign_id) → eq(status) → order(created_at) → limit(100)
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: itemsResolve }) }) }) }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => fakeSupabase,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => auditError(...args) }),
}));

import { GET } from "@/app/api/engage/[shareToken]/route";

const SHARE_TOKEN = "share-token-12345";

const call = () =>
  GET(new NextRequest("http://localhost/api/engage/share-token-12345"), {
    params: Promise.resolve({ shareToken: SHARE_TOKEN }),
  });

describe("GET /api/engage/[shareToken] — a failed read is a status, never an empty answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    campaignMaybeSingle.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Downtown listening campaign",
        summary: "Help us identify the most urgent corridor issues.",
        public_description: null,
        status: "active",
        engagement_type: "map_feedback",
        allow_public_submissions: true,
        submissions_closed_at: null,
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-28T18:00:00.000Z",
      },
      error: null,
    });
    categoriesResolve.mockResolvedValue({ data: [], error: null });
    itemsResolve.mockResolvedValue({ data: [], error: null });
  });

  it("does not answer 200 with zero comments when the comment read failed", async () => {
    itemsResolve.mockResolvedValue({
      data: null,
      error: { message: "permission denied for relation engagement_items" },
    });

    const response = await call();
    const body = await response.json();

    // The claim that has to be gone: a successful-looking envelope carrying an
    // empty public record of participation.
    expect(response.status).not.toBe(200);
    expect(body).not.toHaveProperty("approvedFeedback");
    expect(body).not.toHaveProperty("campaign");

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/published feedback for this consultation/i);
    // Said in words, so a consumer cannot read the failure as "none".
    expect(body.hint).toBe("This is a read failure, not an empty result.");
  });

  it("does not answer 200 with zero topics when the topic read failed", async () => {
    // A permission failure, NOT a "column … does not exist" — that message
    // classifies as an unapplied migration and would be answered 503 by design.
    categoriesResolve.mockResolvedValue({
      data: null,
      error: { message: "permission denied for relation engagement_categories" },
    });

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).not.toHaveProperty("categories");
    expect(body.error).toMatch(/the topics for this consultation/i);
    expect(body.hint).toBe("This is a read failure, not an empty result.");
  });

  /**
   * A DEPLOY THAT RAN AHEAD OF ITS MIGRATION IS TRANSIENT, and telling a caller
   * to retry a permission failure forever would be its own small lie — so the
   * two failures get different statuses. `classifyRouteReadFailure` owns that
   * split; this asserts the route actually routes through it.
   */
  it("answers 503, not 500, when the failure is a migration this deployment has not applied", async () => {
    itemsResolve.mockResolvedValue({
      data: null,
      error: { message: 'relation "engagement_items" does not exist' },
    });

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.hint).toMatch(/Apply the latest Supabase migrations/i);
  });

  /**
   * WHICH FAILURE WINS WHEN BOTH BROKE, asserted because there is only one
   * status to give and the choice is a judgement, not an accident: the approved
   * comment list IS the public record of participation, and an empty topic list
   * mostly makes a form harder to file.
   */
  it("names the feedback read first when both reads failed", async () => {
    categoriesResolve.mockResolvedValue({ data: null, error: { message: "categories broke" } });
    itemsResolve.mockResolvedValue({ data: null, error: { message: "items broke" } });

    const body = await (await call()).json();

    expect(body.error).toMatch(/published feedback/i);
  });

  it("records the database's own words for the operator without putting them in the response", async () => {
    itemsResolve.mockResolvedValue({
      data: null,
      error: { message: "permission denied for relation engagement_items" },
    });

    const body = await (await call()).json();

    expect(auditError).toHaveBeenCalledWith(
      "engagement_public_feedback_read_failed",
      expect.objectContaining({ message: "permission denied for relation engagement_items" })
    );
    // Anyone with the share token can call this. Disclosing THAT a read failed
    // is the honesty requirement; disclosing HOW is an information leak.
    expect(JSON.stringify(body)).not.toMatch(/permission denied/i);
  });

  it("still answers a genuinely empty consultation as empty", async () => {
    const response = await call();
    const body = await response.json();

    // Past both checks, an empty array means what it says — and the ordinary
    // answer must not have been collateral damage of the fix.
    expect(response.status).toBe(200);
    expect(body.categories).toEqual([]);
    expect(body.approvedFeedback).toEqual([]);
    expect(body.campaign.title).toBe("Downtown listening campaign");
  });

  it("still answers 404 when no active campaign carries the token", async () => {
    campaignMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await call();

    // A read that SUCCEEDED and found nothing. This 404 is the truth and the
    // fix above must not have blurred it into a 500.
    expect(response.status).toBe(404);
  });
});
