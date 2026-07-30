import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE RULES AN IMPORT MUST NOT BE ABLE TO TALK ITS WAY PAST.
 *
 * Bulk import is the right answer to a real gap — `source_type` has carried
 * `meeting` and `email` since the table was created and nothing offered a way in
 * — but it is also the first write path in this module where an operator hands
 * over a file of text that becomes participation records. Two things must hold
 * however the payload is shaped:
 *
 *   1. Imported comment is `pending`. A file is not a review.
 *   2. Imported comment cannot claim to be a public portal submission.
 *
 * These are driven through the real handler rather than the parser, because the
 * parser is not where either rule could be lost.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const categoryEqMock = vi.fn().mockResolvedValue({ data: [{ id: "cat-1", label: "Safety" }], error: null });
const categorySelectMock = vi.fn(() => ({ eq: categoryEqMock }));

const itemsInsertSelectMock = vi.fn();
// Typed parameter so `mock.calls[0][0]` is the inserted row array rather than
// an empty tuple — the assertions below read what was actually written.
const itemsInsertMock = vi.fn((_rows: unknown) => ({ select: itemsInsertSelectMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") return { select: campaignSelectMock };
  if (table === "workspace_members") return { select: membershipSelectMock };
  if (table === "engagement_categories") return { select: categorySelectMock };
  if (table === "engagement_items") return { insert: itemsInsertMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as importComments } from "@/app/api/engagement/campaigns/[campaignId]/items/import/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

const post = (body: unknown) =>
  importComments(
    new NextRequest("http://localhost/api/engagement/campaigns/x/items/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) }
  );

describe("an import cannot manufacture public support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } });
    campaignMaybeSingleMock.mockResolvedValue({
      data: { id: CAMPAIGN_ID, workspace_id: "33333333-3333-4333-8333-333333333333", project_id: null },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" },
      error: null,
    });
    categoryEqMock.mockResolvedValue({ data: [{ id: "cat-1", label: "Safety" }], error: null });
    itemsInsertSelectMock.mockResolvedValue({ data: [{ id: "item-1" }], error: null });
  });

  it("refuses to file imported comment as a public portal submission", async () => {
    const response = await post({
      csv: "comment\nWe support this project\n",
      sourceType: "public",
      commit: true,
    });

    // `public` means somebody submitted through the portal themselves, under a
    // rate limit, a honeypot and a share token. A spreadsheet row has none of
    // that. Allowing it would let operator access manufacture public support
    // that every downstream count treats as genuine unsolicited participation.
    expect(response.status).toBe(400);
    expect(itemsInsertMock).not.toHaveBeenCalled();
  });

  it("writes every imported comment as pending, whatever the payload says", async () => {
    await post({
      csv: "comment\nThe crossing at 5th is unsafe\n",
      sourceType: "meeting",
      commit: true,
      // Not in the schema. Present because a future caller WILL try it, and
      // because it pins the defence: zod strips unknown keys, so this never
      // reaches `parsed.data` at all. The literal below is the second line —
      // changing it to "approved" fails this test.
      status: "approved",
    });

    const rows = itemsInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].source_type).toBe("meeting");
  });

  it("strips a status field rather than carrying it toward the insert", async () => {
    // The first defence is the schema, and it is invisible: an unknown key is
    // dropped silently by zod, so nothing downstream ever sees it. Asserted
    // separately because a later edit adding `.passthrough()` would remove this
    // protection without touching any line the test above reads.
    await post({
      csv: "comment\nhello\n",
      sourceType: "meeting",
      commit: true,
      status: "approved",
    });

    const rows = itemsInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0])).not.toContain("approved");
    expect(rows[0].status).toBe("pending");
  });

  it("writes nothing on a dry run, however valid the file is", async () => {
    const response = await post({ csv: "comment\nA perfectly good comment\n", sourceType: "meeting" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.committed).toBe(false);
    expect(body.rowCount).toBe(1);
    expect(itemsInsertMock).not.toHaveBeenCalled();
  });

  it("imports nothing at all when any row is bad", async () => {
    const response = await post({
      // An empty comment CELL. A blank LINE is skipped as CSV noise, which is
      // right — a trailing newline is not a row somebody meant to write.
      csv: "comment,name\ngood comment,A. Rivera\n,B. Chen\nanother good one,C. Diaz\n",
      sourceType: "meeting",
      commit: true,
    });

    // One row of three is empty. Importing the good ones and reporting the rest
    // leaves a campaign in a state neither the operator nor the file describes,
    // and re-uploading the fixed file then duplicates what already worked.
    expect(response.status).toBe(400);
    expect(itemsInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a category this campaign does not have, rather than dropping it", async () => {
    const response = await post({
      csv: "comment,category\nSomething about parking,Parking\n",
      sourceType: "meeting",
      commit: true,
    });
    const body = await response.json();

    // A comment that lost its topic on the way in looks exactly like a
    // successful import.
    expect(response.status).toBe(400);
    expect(body.unmatchedCategories).toEqual(["Parking"]);
    expect(itemsInsertMock).not.toHaveBeenCalled();
  });

  it("matches a category by label whatever case the spreadsheet used", async () => {
    await post({
      csv: "comment,category\nSomething about crossings,safety\n",
      sourceType: "meeting",
      commit: true,
    });

    const rows = itemsInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].category_id).toBe("cat-1");
  });

  it("records where each row came from, so the appendix can cite it", async () => {
    await post({
      csv: "comment\nThe crossing at 5th is unsafe\n",
      sourceType: "meeting",
      fileName: "open-house-2026-03-12.csv",
      commit: true,
    });

    const rows = itemsInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    const provenance = (rows[0].metadata_json as { import: Record<string, unknown> }).import;
    expect(provenance.fileName).toBe("open-house-2026-03-12.csv");
    expect(provenance.rowNumber).toBe(2);
    expect(provenance.batchId).toEqual(expect.any(String));
  });

  it("refuses a caller who cannot write to this campaign", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { workspace_id: "w", role: "viewer" }, error: null });

    const response = await post({ csv: "comment\nhello\n", sourceType: "meeting", commit: true });

    expect(response.status).toBe(403);
    expect(itemsInsertMock).not.toHaveBeenCalled();
  });

  it("keeps the file out of the audit trail", async () => {
    await post({ csv: "comment\n\n", sourceType: "meeting", commit: true });

    // Resident comment routinely carries names, addresses and phone numbers.
    const logged = JSON.stringify([
      ...mockAudit.warn.mock.calls,
      ...mockAudit.error.mock.calls,
      ...mockAudit.info.mock.calls,
    ]);
    expect(logged).not.toContain("comment\\n");
  });

  it("reports a failed insert as nothing saved", async () => {
    itemsInsertSelectMock.mockResolvedValue({ data: null, error: { message: "deadlock detected" } });

    const response = await post({ csv: "comment\nhello\n", sourceType: "meeting", commit: true });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/Nothing was saved/i);
  });
});
