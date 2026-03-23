import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const workspaceMembersMaybeSingleMock = vi.fn();
const workspaceMembersEqUserMock = vi.fn(() => ({ maybeSingle: workspaceMembersMaybeSingleMock }));
const workspaceMembersEqWorkspaceMock = vi.fn(() => ({ eq: workspaceMembersEqUserMock }));
const workspaceMembersSelectMock = vi.fn(() => ({ eq: workspaceMembersEqWorkspaceMock }));

const projectsSingleMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ single: projectsSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const billingInvoicesSingleMock = vi.fn();
const billingInvoicesSelectMock = vi.fn(() => ({ single: billingInvoicesSingleMock }));
const billingInvoicesInsertMock = vi.fn(() => ({ select: billingInvoicesSelectMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: workspaceMembersSelectMock };
  }

  if (table === "projects") {
    return { select: projectsSelectMock };
  }

  if (table === "billing_invoice_records") {
    return { insert: billingInvoicesInsertMock };
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

import { POST as postInvoice } from "@/app/api/billing/invoices/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/billing/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/billing/invoices", () => {
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

    projectsSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      error: null,
    });

    billingInvoicesSingleMock.mockResolvedValue({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        invoice_number: "OP-2026-001",
        net_amount: 11400,
        status: "submitted",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-001",
        amount: 1000,
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 when the member role attempts to write invoice records", async () => {
    workspaceMembersMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "member",
      },
      error: null,
    });

    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-001",
        amount: 1000,
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Owner or admin role required for invoice writes" });
  });

  it("creates a billing invoice record with computed retention and net values", async () => {
    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        projectId: "11111111-1111-4111-8111-111111111111",
        invoiceNumber: "OP-2026-001",
        consultantName: "Nat Ford",
        billingBasis: "time_and_materials",
        status: "submitted",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-15",
        invoiceDate: "2026-03-15",
        dueDate: "2026-03-30",
        amount: 12000,
        retentionPercent: 5,
        supportingDocsStatus: "complete",
        submittedTo: "Caltrans D3 Local Assistance",
        caltransPosture: "deferred_exact_forms",
        notes: "Exact exhibit/form IDs still deferred in v0.1.",
      })
    );

    expect(response.status).toBe(201);
    expect(billingInvoicesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        project_id: "11111111-1111-4111-8111-111111111111",
        invoice_number: "OP-2026-001",
        consultant_name: "Nat Ford",
        amount: 12000,
        retention_percent: 5,
        retention_amount: 600,
        net_amount: 11400,
        supporting_docs_status: "complete",
      })
    );

    expect(await response.json()).toMatchObject({
      invoice: {
        id: "99999999-9999-4999-8999-999999999999",
        invoice_number: "OP-2026-001",
        net_amount: 11400,
      },
    });
  });
});
