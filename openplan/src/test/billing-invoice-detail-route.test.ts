import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
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

  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { PATCH as patchInvoice } from "@/app/api/billing/invoices/[invoiceId]/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/billing/invoices/invoice-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("PATCH /api/billing/invoices/[invoiceId]", () => {
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
