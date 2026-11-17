import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * KI-2026-11-16-131: nothing refused or warned when claims passed the award.
 * The status route now refuses a move that newly counts a request as claimed
 * on an award when the award's claimed gross would pass its ceiling, unless
 * the planner gives a note, which is saved to the request's notes.
 *
 * The award: $100,000.00 ceiling. Its other requests, by hand:
 *   A paid       60,000  claimed
 *   B submitted  30,000  claimed
 *   C draft      50,000  not claimed
 *   D rejected   20,000  not claimed
 *   claimed before the move = 90,000
 */
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AWARD_ID = "77777777-7777-4777-8777-777777777777";
const INVOICE_ID = "99999999-9999-4999-8999-999999999999";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let invoiceRow: Record<string, unknown>;
let awardRow: Record<string, unknown>;
let awardInvoices: { data: unknown[] | null; error: unknown; count: number | null };
const updateMock = vi.fn();
const awardInvoicesSelectMock = vi.fn();

function from(table: string) {
  if (table === "workspace_members") {
    return {
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { workspace_id: WORKSPACE_ID, role: "owner" }, error: null }) }) }),
      }),
    };
  }
  if (table === "funding_awards") {
    return { select: () => ({ eq: () => ({ single: async () => ({ data: awardRow, error: null }) }) }) };
  }
  if (table === "billing_invoice_records") {
    return {
      select: (columns: string, options?: { count?: string }) => ({
        eq: (column: string) => ({
          single: async () => ({ data: invoiceRow, error: null }),
          limit: async () => {
            awardInvoicesSelectMock(columns, options, column);
            return awardInvoices;
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updateMock(payload);
        return {
          eq: () => ({
            select: () => ({ single: async () => ({ data: { ...invoiceRow, ...payload }, error: null }) }),
          }),
        };
      },
    };
  }
  throw new Error(`Unexpected table: ${table}`);
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { PATCH } from "@/app/api/invoicing/invoices/[invoiceId]/route";

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest(`http://localhost/api/invoicing/invoices/${INVOICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, ...body }),
    }),
    { params: Promise.resolve({ invoiceId: INVOICE_ID }) }
  );
}

const others = [
  { id: "a", status: "paid", amount: 60000 },
  { id: "b", status: "submitted", amount: 30000 },
  { id: "c", status: "draft", amount: 50000 },
  { id: "d", status: "rejected", amount: 20000 },
];

describe("a claim above the award ceiling needs a note (KI-2026-11-16-131)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } }) },
      from,
    });
    invoiceRow = {
      id: INVOICE_ID,
      workspace_id: WORKSPACE_ID,
      project_id: null,
      funding_award_id: AWARD_ID,
      status: "draft",
      amount: 15000,
      notes: "Phase 2 design",
    };
    awardRow = { id: AWARD_ID, workspace_id: WORKSPACE_ID, project_id: null, awarded_amount: 100000, latest_handoff_revision_id: null };
    awardInvoices = { data: [...others, { id: INVOICE_ID, status: "draft", amount: 15000 }], error: null, count: 5 };
  });

  it("refuses a move into review that passes the ceiling, says why, and saves nothing", async () => {
    const response = await patch({ status: "internal_review" });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("over_award_ceiling");
    expect(body.error).toBe(
      "This would bring claims on the award to $105,000.00, $5,000.00 above its $100,000.00 ceiling. Add a note saying why to claim above the award."
    );
    expect(body.overCeiling).toEqual({ ceiling: 100000, claimedBefore: 90000, claimedAfter: 105000, excess: 5000 });
    expect(updateMock).not.toHaveBeenCalled();
    expect(awardInvoicesSelectMock).toHaveBeenCalledWith("id, status, amount", { count: "exact" }, "funding_award_id");
  });

  it("allows a move that lands exactly on the ceiling (drafts and rejected requests count in none of it)", async () => {
    invoiceRow.amount = 10000;
    const response = await patch({ status: "internal_review" });

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).not.toHaveProperty("notes");
  });

  it("saves the move with the planner's note added to the request's notes", async () => {
    const response = await patch({ status: "internal_review", overCeilingNote: "Change order 3 raised the agreement." });

    expect(response.status).toBe(200);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      status: "internal_review",
      notes: "Phase 2 design\n\nClaimed $5,000.00 above the $100,000.00 award ceiling: Change order 3 raised the agreement.",
    });
  });

  it("does not re-check a request that was already claimed", async () => {
    invoiceRow.status = "submitted";
    invoiceRow.amount = 50000;
    const response = await patch({ status: "approved_for_payment" });

    expect(response.status).toBe(200);
    expect(awardInvoicesSelectMock).not.toHaveBeenCalled();
  });

  it("refuses to check against a short read rather than sum part of the award", async () => {
    awardInvoices = { ...awardInvoices, count: 6 };
    const response = await patch({ status: "internal_review" });

    expect(response.status).toBe(503);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses a note with neither a status change nor an award link", async () => {
    const response = await patch({ overCeilingNote: "No move here." });
    expect(response.status).toBe(400);
  });

  it("checks a claimed request relinked to another award, and saves the relink with a note (review 95)", async () => {
    invoiceRow.status = "submitted";
    invoiceRow.funding_award_id = "66666666-6666-4666-8666-666666666666";
    const refused = await patch({ fundingAwardId: AWARD_ID });
    expect(refused.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();

    const saved = await patch({ fundingAwardId: AWARD_ID, overCeilingNote: "Moved to the award that funds this phase." });
    expect(saved.status).toBe(200);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      funding_award_id: AWARD_ID,
      notes: "Phase 2 design\n\nClaimed $5,000.00 above the $100,000.00 award ceiling: Moved to the award that funds this phase.",
    });
  });
});
