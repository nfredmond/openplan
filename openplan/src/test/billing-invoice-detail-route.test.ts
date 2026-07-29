import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const workspaceMembersMaybeSingleMock = vi.fn();
const workspaceMembersEqUserMock = vi.fn(() => ({ maybeSingle: workspaceMembersMaybeSingleMock }));
const workspaceMembersEqWorkspaceMock = vi.fn(() => ({ eq: workspaceMembersEqUserMock }));
const workspaceMembersSelectMock = vi.fn(() => ({ eq: workspaceMembersEqWorkspaceMock }));

const fundingAwardsSingleMock = vi.fn();
const fundingAwardsEqMock = vi.fn(() => ({ single: fundingAwardsSingleMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock }));

const billingInvoicesSingleMock = vi.fn();
const billingInvoicesEqMock = vi.fn(() => ({ single: billingInvoicesSingleMock }));
const billingInvoicesSelectMock = vi.fn(() => ({ eq: billingInvoicesEqMock }));

const billingInvoicesUpdateSingleMock = vi.fn();
const billingInvoicesUpdateSelectMock = vi.fn(() => ({ single: billingInvoicesUpdateSingleMock }));
const billingInvoicesUpdateEqMock = vi.fn(() => ({ select: billingInvoicesUpdateSelectMock }));
const billingInvoicesUpdateMock = vi.fn(() => ({ eq: billingInvoicesUpdateEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: workspaceMembersSelectMock };
  }

  if (table === "funding_awards") {
    return { select: fundingAwardsSelectMock };
  }

  if (table === "billing_invoice_records") {
    return { select: billingInvoicesSelectMock, update: billingInvoicesUpdateMock };
  }

  if (table === "assistant_action_executions") {
    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { PATCH as patchInvoice } from "@/app/api/invoicing/invoices/[invoiceId]/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/invoicing/invoices/invoice-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("PATCH /api/invoicing/invoices/[invoiceId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    workspaceMembersMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "owner",
      },
      error: null,
    });

    billingInvoicesSingleMock.mockResolvedValue({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        project_id: null,
        funding_award_id: null,
      },
      error: null,
    });

    fundingAwardsSingleMock.mockResolvedValue({
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        project_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });

    billingInvoicesUpdateSingleMock.mockResolvedValue({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        project_id: "11111111-1111-4111-8111-111111111111",
        funding_award_id: "77777777-7777-4777-8777-777777777777",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    createServiceRoleClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "assistant_action_executions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        throw new Error(`Unexpected service table: ${table}`);
      }),
    });
  });

  it("links an invoice to a funding award and inherits the award project when the invoice has none", async () => {
    const response = await patchInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        fundingAwardId: "77777777-7777-4777-8777-777777777777",
      }),
      { params: Promise.resolve({ invoiceId: "99999999-9999-4999-8999-999999999999" }) }
    );

    expect(response.status).toBe(200);
    expect(billingInvoicesUpdateMock).toHaveBeenCalledWith({
      project_id: "11111111-1111-4111-8111-111111111111",
      funding_award_id: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("reports a zero-row update as a refused write, not as an opaque failure", async () => {
    // `.maybeSingle()`-shaped news that nothing changed: no error, no row.
    billingInvoicesUpdateSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await patchInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "submitted",
      }),
      { params: Promise.resolve({ invoiceId: "99999999-9999-4999-8999-999999999999" }) }
    );

    // The invoice was already read back through the caller's own client and
    // cleared the workspace and role checks, so zero rows is the database
    // refusing a write the application allowed — a 500 that says which.
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("The invoice was not saved");
    expect(body.details).toContain("row-level security");
    expect(mockAudit.error).toHaveBeenCalledWith(
      "billing_invoice_update_matched_no_rows",
      expect.objectContaining({ invoiceId: "99999999-9999-4999-8999-999999999999" })
    );
    expect(mockAudit.error).not.toHaveBeenCalledWith("billing_invoice_update_failed", expect.anything());
  });

  it("reports a PGRST116 update the same way, without retrying against the legacy select", async () => {
    billingInvoicesUpdateSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });

    const response = await patchInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "submitted",
      }),
      { params: Promise.resolve({ invoiceId: "99999999-9999-4999-8999-999999999999" }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "The invoice was not saved" });
    // Zero rows is not the pending-profile-schema case, so the legacy-select
    // fallback must not fire a second update.
    expect(billingInvoicesUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("still answers 500 with the original wording when the update genuinely fails", async () => {
    billingInvoicesUpdateSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const response = await patchInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "submitted",
      }),
      { params: Promise.resolve({ invoiceId: "99999999-9999-4999-8999-999999999999" }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to update invoice record" });
    expect(mockAudit.error).toHaveBeenCalledWith("billing_invoice_update_failed", expect.anything());
  });

  it("reports a zero-row link the same way, and records the assistant action as failed", async () => {
    // The link path runs the update inside withAssistantActionAudit, so the
    // zero-row signal has to survive being thrown through that wrapper —
    // an action that saved nothing must not be audited as succeeded.
    const executionsInsertMock = vi.fn().mockResolvedValue({ error: null });
    createServiceRoleClientMock.mockReturnValueOnce({
      from: vi.fn((table: string) => {
        if (table === "assistant_action_executions") {
          return { insert: executionsInsertMock };
        }
        throw new Error(`Unexpected service table: ${table}`);
      }),
    });
    billingInvoicesUpdateSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await patchInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        fundingAwardId: "77777777-7777-4777-8777-777777777777",
      }),
      { params: Promise.resolve({ invoiceId: "99999999-9999-4999-8999-999999999999" }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "The invoice was not saved" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "billing_invoice_update_matched_no_rows",
      expect.objectContaining({ invoiceId: "99999999-9999-4999-8999-999999999999" })
    );
    expect(mockAudit.error).not.toHaveBeenCalledWith("billing_invoice_update_failed", expect.anything());
    expect(executionsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("rejects linking a funding award that does not match the invoice project", async () => {
    billingInvoicesSingleMock.mockResolvedValueOnce({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        project_id: "33333333-3333-4333-8333-333333333333",
        funding_award_id: null,
      },
      error: null,
    });

    const response = await patchInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        fundingAwardId: "77777777-7777-4777-8777-777777777777",
      }),
      { params: Promise.resolve({ invoiceId: "99999999-9999-4999-8999-999999999999" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Funding award must match the linked invoice project" });
  });
});
