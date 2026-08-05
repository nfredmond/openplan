import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FAILED READ MAY NOT SEND A SECOND ROUND OF EMAILS TO RESIDENTS.
 *
 * `PATCH .../closeloop/[entryId]` broadcasts a "You said / We did" update to
 * every subscriber exactly once, and the only thing standing between a
 * re-publish and a second mailing is one read of the entry's PRIOR status.
 * `const { data: prior } = await …` bound no error, so a failed read left
 * `priorStatus` null — indistinguishable from "was still a draft" — and an
 * already-published entry re-saved would notify the operator inbox again and
 * enqueue the whole subscriber list again. The recipients are members of the
 * public, and nobody can unsend it.
 *
 * So the refusal happens BEFORE the write: an edit the operator can retry is
 * recoverable, a duplicate mailing is not.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const loadCampaignAccessMock = vi.fn();
const validateCampaignCategoryAccessMock = vi.fn();

const priorStatusMaybeSingle = vi.fn();
const entryUpdateMaybeSingle = vi.fn();
const entryUpdateMock = vi.fn(() => ({
  eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: entryUpdateMaybeSingle }) }) }),
}));

const recordOperatorNotificationMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const enqueueCampaignSubscriberEmailsMock = vi.hoisted(() => vi.fn(async () => ({ enqueued: 3 })));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fakeSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444" } } }) },
  from: vi.fn((table: string) => {
    if (table === "engagement_closeloop_entries") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: priorStatusMaybeSingle }) }) }),
        update: entryUpdateMock,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccessMock(...args),
  validateCampaignCategoryAccess: (...args: unknown[]) => validateCampaignCategoryAccessMock(...args),
}));
vi.mock("@/lib/notifications/engagement", () => ({
  recordOperatorNotification: recordOperatorNotificationMock,
  enqueueCampaignSubscriberEmails: enqueueCampaignSubscriberEmailsMock,
}));

import { PATCH } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/[entryId]/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID, entryId: ENTRY_ID }) };

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/closeloop/${ENTRY_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function publishRequest() {
  return patchRequest({ status: "published" });
}

beforeEach(() => {
  vi.clearAllMocks();

  createClientMock.mockResolvedValue(fakeSupabase);
  createServiceRoleClientMock.mockReturnValue(fakeSupabase);

  loadCampaignAccessMock.mockResolvedValue({
    campaign: { id: CAMPAIGN_ID, workspace_id: "ws-1", title: "Downtown listening", share_token: "share-abc" },
    membership: { role: "editor" },
    error: null,
    allowed: true,
  });

  validateCampaignCategoryAccessMock.mockResolvedValue({ category: { id: CATEGORY_ID }, error: null });
  priorStatusMaybeSingle.mockResolvedValue({ data: { status: "draft" }, error: null });
  entryUpdateMaybeSingle.mockResolvedValue({
    data: { id: ENTRY_ID, status: "published", theme_title: "Crossings", you_said: "…", we_did: "…" },
    error: null,
  });
});

describe("PATCH .../closeloop/[entryId] — publishing once", () => {
  it("broadcasts on a genuine draft -> published transition", async () => {
    const response = await PATCH(publishRequest(), ctx);

    expect(response.status).toBe(200);
    expect(recordOperatorNotificationMock).toHaveBeenCalledTimes(1);
    expect(enqueueCampaignSubscriberEmailsMock).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast again when the read shows it was already published", async () => {
    priorStatusMaybeSingle.mockResolvedValue({ data: { status: "published" }, error: null });

    const response = await PATCH(publishRequest(), ctx);

    expect(response.status).toBe(200);
    expect(enqueueCampaignSubscriberEmailsMock).not.toHaveBeenCalled();
  });

  it("refuses the publish rather than re-emailing residents when the prior status is unreadable", async () => {
    priorStatusMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_closeloop_entries", code: "42501" },
    });

    const response = await PATCH(publishRequest(), ctx);
    const body = await response.json();

    // The side effects the failed read used to unlock, asserted FIRST: this is
    // the consequence the fix exists for, and it must be what fails if the fix
    // is removed.
    expect(enqueueCampaignSubscriberEmailsMock).not.toHaveBeenCalled();
    expect(recordOperatorNotificationMock).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load close-loop entry");
    expect(body.hint).toContain("read failure");
    // And the write is refused too, so the operator can retry the whole edit.
    expect(entryUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "entry_prior_status_read_failed",
      expect.objectContaining({ entryId: ENTRY_ID })
    );
  });

  it("answers 503 when the close-loop table has not been migrated on this deployment", async () => {
    priorStatusMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'relation "engagement_closeloop_entries" does not exist' },
    });

    const response = await PATCH(publishRequest(), ctx);

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Close-loop entry schema is not available yet");
    expect(enqueueCampaignSubscriberEmailsMock).not.toHaveBeenCalled();
    expect(entryUpdateMock).not.toHaveBeenCalled();
  });
});

/**
 * THE SAME DEFECT, TWENTY LINES ABOVE THE FIX, and it survived the first pass.
 *
 * `if (categoryAccess.error || !categoryAccess.category)` answered 400 "Category
 * does not belong to this campaign" for a lookup that FAILED — a claim about the
 * agency's own categories built out of a query with no answer. The operator is
 * looking at the theme they just picked from this campaign's own list, so the
 * sentence is not merely unhelpful, it is false and unfalsifiable from the UI.
 * The 400 is now reserved for a read that ran and found nothing.
 */
describe("PATCH .../closeloop/[entryId] — tagging an entry with a theme", () => {
  it("still refuses a category the read looked for and did not find", async () => {
    validateCampaignCategoryAccessMock.mockResolvedValue({ category: null, error: null });

    const response = await PATCH(patchRequest({ categoryId: CATEGORY_ID }), ctx);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Category does not belong to this campaign");
    expect(entryUpdateMock).not.toHaveBeenCalled();
  });

  it("reports a failed category read instead of calling the agency's own theme foreign", async () => {
    validateCampaignCategoryAccessMock.mockResolvedValue({
      category: null,
      error: { message: "permission denied for table engagement_categories", code: "42501" },
    });

    const response = await PATCH(patchRequest({ categoryId: CATEGORY_ID }), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load the selected category");
    expect(body.hint).toContain("read failure");
    // The false claim is GONE, not merely accompanied by a truer one.
    expect(JSON.stringify(body)).not.toContain("does not belong");
    expect(entryUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "entry_category_read_failed",
      expect.objectContaining({ categoryId: CATEGORY_ID })
    );
  });

  it("answers 503 when the categories table is not migrated on this deployment", async () => {
    validateCampaignCategoryAccessMock.mockResolvedValue({
      category: null,
      error: { message: 'relation "engagement_categories" does not exist' },
    });

    const response = await PATCH(patchRequest({ categoryId: CATEGORY_ID }), ctx);

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("The selected category schema is not available yet");
    expect(entryUpdateMock).not.toHaveBeenCalled();
  });
});
