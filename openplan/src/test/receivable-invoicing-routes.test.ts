import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

// workspace_members
const membersMaybeSingleMock = vi.fn();
const membersEqUserMock = vi.fn(() => ({ maybeSingle: membersMaybeSingleMock }));
const membersEqWorkspaceMock = vi.fn(() => ({ eq: membersEqUserMock }));
const membersSelectMock = vi.fn(() => ({ eq: membersEqWorkspaceMock }));

// invoicing_clients
const clientLookupSingleMock = vi.fn();
const clientLookupEqMock = vi.fn(() => ({ single: clientLookupSingleMock }));
const clientSelectMock = vi.fn(() => ({ eq: clientLookupEqMock }));
const clientInsertSingleMock = vi.fn();
const clientInsertSelectMock = vi.fn(() => ({ single: clientInsertSingleMock }));
const clientInsertMock = vi.fn(() => ({ select: clientInsertSelectMock }));
const clientUpdateSingleMock = vi.fn();
const clientUpdateSelectMock = vi.fn(() => ({ single: clientUpdateSingleMock }));
const clientUpdateEqMock = vi.fn(() => ({ select: clientUpdateSelectMock }));
const clientUpdateMock = vi.fn(() => ({ eq: clientUpdateEqMock }));

// invoicing_engagements
const engagementSingleMock = vi.fn();
const engagementEqMock = vi.fn(() => ({ single: engagementSingleMock }));
const engagementSelectMock = vi.fn(() => ({ eq: engagementEqMock }));
const engagementInsertSingleMock = vi.fn();
const engagementInsertSelectMock = vi.fn(() => ({ single: engagementInsertSingleMock }));
const engagementInsertMock = vi.fn(() => ({ select: engagementInsertSelectMock }));
const engagementUpdateSingleMock = vi.fn();
const engagementUpdateSelectMock = vi.fn(() => ({ single: engagementUpdateSingleMock }));
const engagementUpdateEqMock = vi.fn(() => ({ select: engagementUpdateSelectMock }));
const engagementUpdateMock = vi.fn(() => ({ eq: engagementUpdateEqMock }));

// projects
const projectSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ single: projectSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

// project_deliverables / project_milestones — select().in() lists
const deliverablesInMock = vi.fn();
const deliverablesSelectMock = vi.fn(() => ({ in: deliverablesInMock }));
const milestonesInMock = vi.fn();
const milestonesSelectMock = vi.fn(() => ({ in: milestonesInMock }));

// invoicing_time_entries — select().in() lookups plus update().in() writes.
// The void-unstamp path awaits update().in() directly (thenable); the stamp
// path chains .is("billed_line_item_id", null).select("id") and verifies the
// row count. Override timeEntryStampResult to simulate a lost race.
let timeEntryStampResult:
  | ((ids: string[]) => { data: Array<{ id: string }> | null; error: { message: string } | null })
  | null = null;
const timeEntrySelectInMock = vi.fn();
const timeEntrySelectMock = vi.fn(() => ({ in: timeEntrySelectInMock }));
const timeEntryUpdateInMock = vi.fn((_column: unknown, ids: unknown) => ({
  then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  is: vi.fn(() => ({
    select: vi.fn(async () =>
      timeEntryStampResult
        ? timeEntryStampResult(ids as string[])
        : { data: (ids as string[]).map((id) => ({ id })), error: null }
    ),
  })),
}));
const timeEntryUpdateMock = vi.fn(() => ({ in: timeEntryUpdateInMock }));

// client_invoices — detail single, awaited list (NTE read), GET list chain,
// insert, update. One self-returning chain serves every select shape.
const invoiceDetailSingleMock = vi.fn();
const invoiceListResultMock = vi.fn(() => ({ data: [] as unknown[], error: null as { message: string } | null }));
const invoiceLimitMock = vi.fn();
type InvoiceQueryChain = {
  eq: (...args: unknown[]) => InvoiceQueryChain;
  order: (...args: unknown[]) => { limit: typeof invoiceLimitMock };
  single: typeof invoiceDetailSingleMock;
  then: (resolve: (value: unknown) => void) => void;
};
const invoiceQueryChain: InvoiceQueryChain = {
  eq: () => invoiceQueryChain,
  order: () => ({ limit: invoiceLimitMock }),
  single: invoiceDetailSingleMock,
  then: (resolve) => resolve(invoiceListResultMock()),
};
const invoiceSelectMock = vi.fn(() => invoiceQueryChain);
const invoiceInsertSingleMock = vi.fn();
const invoiceInsertSelectMock = vi.fn(() => ({ single: invoiceInsertSingleMock }));
const invoiceInsertMock = vi.fn(() => ({ select: invoiceInsertSelectMock }));
const invoiceUpdateSingleMock = vi.fn();
const invoiceUpdateSelectMock = vi.fn(() => ({ single: invoiceUpdateSingleMock }));
const invoiceUpdateEqMock = vi.fn(() => ({ select: invoiceUpdateSelectMock }));
const invoiceUpdateMock = vi.fn(() => ({ eq: invoiceUpdateEqMock }));

// client_invoice_line_items — insert().select() for new sets, plain awaited
// insert for the compensating snapshot restore (thenable, like the rate-entries
// restore mock), select().eq() for the current set, delete().eq().
const lineInsertSelectMock = vi.fn();
const lineRestoreResultMock = vi.fn(() => ({ error: null as { message: string } | null }));
const lineInsertMock = vi.fn(() => ({
  select: lineInsertSelectMock,
  then: (resolve: (value: { error: { message: string } | null }) => void) => resolve(lineRestoreResultMock()),
}));
const lineSelectEqMock = vi.fn();
const lineSelectMock = vi.fn(() => ({ eq: lineSelectEqMock }));
const lineDeleteEqMock = vi.fn();
const lineDeleteMock = vi.fn(() => ({ eq: lineDeleteEqMock }));

// service-role client: the compensating delete of a half-created invoice.
const serviceInvoiceDeleteEqMock = vi.fn();
const serviceInvoiceDeleteMock = vi.fn(() => ({ eq: serviceInvoiceDeleteEqMock }));
const serviceFromMock = vi.fn((table: string) => {
  if (table === "client_invoices") {
    return { delete: serviceInvoiceDeleteMock };
  }
  throw new Error(`Unexpected service table: ${table}`);
});

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membersSelectMock };
  }
  if (table === "invoicing_clients") {
    return { select: clientSelectMock, insert: clientInsertMock, update: clientUpdateMock };
  }
  if (table === "invoicing_engagements") {
    return { select: engagementSelectMock, insert: engagementInsertMock, update: engagementUpdateMock };
  }
  if (table === "projects") {
    return { select: projectSelectMock };
  }
  if (table === "project_deliverables") {
    return { select: deliverablesSelectMock };
  }
  if (table === "project_milestones") {
    return { select: milestonesSelectMock };
  }
  if (table === "invoicing_time_entries") {
    return { select: timeEntrySelectMock, update: timeEntryUpdateMock };
  }
  if (table === "client_invoices") {
    return { select: invoiceSelectMock, insert: invoiceInsertMock, update: invoiceUpdateMock };
  }
  if (table === "client_invoice_line_items") {
    return { select: lineSelectMock, insert: lineInsertMock, delete: lineDeleteMock };
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

import { POST as postClient } from "@/app/api/invoicing/clients/route";
import { PATCH as patchClient } from "@/app/api/invoicing/clients/[clientId]/route";
import { POST as postEngagement } from "@/app/api/invoicing/engagements/route";
import { PATCH as patchEngagement } from "@/app/api/invoicing/engagements/[engagementId]/route";
import {
  GET as listClientInvoices,
  POST as postClientInvoice,
} from "@/app/api/invoicing/client-invoices/route";
import { PATCH as patchClientInvoice } from "@/app/api/invoicing/client-invoices/[invoiceId]/route";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_WORKSPACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const ENGAGEMENT = "44444444-4444-4444-8444-444444444444";
const OTHER_ENGAGEMENT = "45454545-4545-4545-8454-454545454545";
const PROJECT = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT = "56565656-5656-4556-8565-565656565656";
const DELIVERABLE = "66666666-6666-4666-8666-666666666666";
const INVOICE = "77777777-7777-4777-8777-777777777777";
const LINE_ITEM_1 = "88888888-8888-4888-8888-888888888888";
const LINE_ITEM_2 = "89898989-8989-4889-8898-898989898989";
const OTHER_LINE_ITEM = "80808080-8080-4880-8808-808080808080";
const TIME_ENTRY = "99999999-9999-4999-8999-999999999999";

function jsonRequest(url: string, method: string, payload: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const invoicePayload = {
  workspaceId: WORKSPACE,
  clientId: CLIENT,
  engagementId: ENGAGEMENT,
  invoiceNumber: "INV-001",
  lineItems: [
    {
      description: "Corridor study, July",
      quantity: 10,
      unitAmount: 150,
      sourceTimeEntryIds: [TIME_ENTRY],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  createApiAuditLoggerMock.mockReturnValue(mockAudit);

  authGetUserMock.mockResolvedValue({ data: { user: { id: USER } } });

  membersMaybeSingleMock.mockResolvedValue({
    data: { workspace_id: WORKSPACE, role: "owner" },
    error: null,
  });

  clientLookupSingleMock.mockResolvedValue({
    data: { id: CLIENT, workspace_id: WORKSPACE },
    error: null,
  });
  clientInsertSingleMock.mockResolvedValue({
    data: { id: CLIENT, workspace_id: WORKSPACE, name: "River County RTPA" },
    error: null,
  });
  clientUpdateSingleMock.mockResolvedValue({
    data: { id: CLIENT, workspace_id: WORKSPACE, name: "River County RTPA" },
    error: null,
  });

  engagementSingleMock.mockResolvedValue({
    data: {
      id: ENGAGEMENT,
      workspace_id: WORKSPACE,
      client_id: CLIENT,
      project_id: null,
      not_to_exceed_amount: null,
    },
    error: null,
  });
  engagementInsertSingleMock.mockResolvedValue({
    data: { id: ENGAGEMENT, workspace_id: WORKSPACE, client_id: CLIENT, title: "On-call modeling" },
    error: null,
  });
  engagementUpdateSingleMock.mockResolvedValue({
    data: { id: ENGAGEMENT, workspace_id: WORKSPACE, client_id: CLIENT, title: "On-call modeling" },
    error: null,
  });

  projectSingleMock.mockResolvedValue({
    data: { id: PROJECT, workspace_id: WORKSPACE },
    error: null,
  });

  deliverablesInMock.mockResolvedValue({ data: [{ id: DELIVERABLE, project_id: PROJECT }], error: null });
  milestonesInMock.mockResolvedValue({ data: [], error: null });

  timeEntrySelectInMock.mockResolvedValue({
    data: [{ id: TIME_ENTRY, workspace_id: WORKSPACE, engagement_id: ENGAGEMENT, billed_line_item_id: null }],
    error: null,
  });
  timeEntryStampResult = null;

  invoiceDetailSingleMock.mockResolvedValue({
    data: {
      id: INVOICE,
      workspace_id: WORKSPACE,
      engagement_id: ENGAGEMENT,
      project_id: PROJECT,
      status: "draft",
      retention_percent: 0,
    },
    error: null,
  });
  invoiceListResultMock.mockReturnValue({ data: [], error: null });
  invoiceLimitMock.mockResolvedValue({ data: [], error: null });
  invoiceInsertSingleMock.mockResolvedValue({
    data: { id: INVOICE, workspace_id: WORKSPACE, invoice_number: "INV-001", status: "draft" },
    error: null,
  });
  invoiceUpdateSingleMock.mockResolvedValue({
    data: { id: INVOICE, workspace_id: WORKSPACE, invoice_number: "INV-001", status: "draft" },
    error: null,
  });

  lineInsertSelectMock.mockResolvedValue({
    data: [{ id: LINE_ITEM_1, invoice_id: INVOICE, position: 0, amount: 1500 }],
    error: null,
  });
  lineRestoreResultMock.mockReturnValue({ error: null });
  lineSelectEqMock.mockResolvedValue({
    data: [
      {
        id: LINE_ITEM_1,
        invoice_id: INVOICE,
        position: 0,
        description: "Old line",
        quantity: null,
        unit_label: null,
        unit_amount: null,
        amount: 100,
        deliverable_id: null,
        milestone_id: null,
      },
    ],
    error: null,
  });
  lineDeleteEqMock.mockResolvedValue({ error: null });

  serviceInvoiceDeleteEqMock.mockResolvedValue({ error: null });

  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: fromMock,
  });
  createServiceRoleClientMock.mockReturnValue({ from: serviceFromMock });
});

describe("POST /api/invoicing/clients", () => {
  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postClient(
      jsonRequest("http://localhost/api/invoicing/clients", "POST", { workspaceId: WORKSPACE, name: "River County RTPA" })
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 when a member-role user attempts a client write", async () => {
    membersMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: WORKSPACE, role: "member" },
      error: null,
    });

    const response = await postClient(
      jsonRequest("http://localhost/api/invoicing/clients", "POST", { workspaceId: WORKSPACE, name: "River County RTPA" })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Owner or admin role required for invoice writes" });
  });

  it("creates a client", async () => {
    const response = await postClient(
      jsonRequest("http://localhost/api/invoicing/clients", "POST", {
        workspaceId: WORKSPACE,
        name: "River County RTPA",
        clientKind: "public_agency",
        contactEmail: "billing@example.gov",
      })
    );

    expect(response.status).toBe(201);
    expect(clientInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE,
        name: "River County RTPA",
        client_kind: "public_agency",
        contact_email: "billing@example.gov",
        created_by: USER,
      })
    );
  });
});

describe("PATCH /api/invoicing/clients/[clientId]", () => {
  const context = { params: Promise.resolve({ clientId: CLIENT }) };

  it("hides a client from another workspace as not found", async () => {
    clientLookupSingleMock.mockResolvedValueOnce({
      data: { id: CLIENT, workspace_id: OTHER_WORKSPACE },
      error: null,
    });

    const response = await patchClient(
      jsonRequest(`http://localhost/api/invoicing/clients/${CLIENT}`, "PATCH", {
        workspaceId: WORKSPACE,
        name: "Renamed",
      }),
      context
    );

    expect(response.status).toBe(404);
    expect(clientUpdateMock).not.toHaveBeenCalled();
  });

  it("updates a client", async () => {
    const response = await patchClient(
      jsonRequest(`http://localhost/api/invoicing/clients/${CLIENT}`, "PATCH", {
        workspaceId: WORKSPACE,
        name: "Renamed",
        notes: null,
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(clientUpdateMock).toHaveBeenCalledWith({ name: "Renamed", notes: null });
  });
});

describe("POST /api/invoicing/engagements", () => {
  it("rejects a client from another workspace", async () => {
    clientLookupSingleMock.mockResolvedValueOnce({
      data: { id: CLIENT, workspace_id: OTHER_WORKSPACE },
      error: null,
    });

    const response = await postEngagement(
      jsonRequest("http://localhost/api/invoicing/engagements", "POST", {
        workspaceId: WORKSPACE,
        clientId: CLIENT,
        title: "On-call modeling",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Client is not available in the requested workspace",
    });
    expect(engagementInsertMock).not.toHaveBeenCalled();
  });

  it("creates an engagement with a not-to-exceed ceiling", async () => {
    const response = await postEngagement(
      jsonRequest("http://localhost/api/invoicing/engagements", "POST", {
        workspaceId: WORKSPACE,
        clientId: CLIENT,
        projectId: PROJECT,
        title: "On-call modeling",
        billingBasis: "time_and_materials",
        notToExceedAmount: 50000,
      })
    );

    expect(response.status).toBe(201);
    expect(engagementInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE,
        client_id: CLIENT,
        project_id: PROJECT,
        title: "On-call modeling",
        billing_basis: "time_and_materials",
        not_to_exceed_amount: 50000,
        created_by: USER,
      })
    );
  });
});

describe("PATCH /api/invoicing/engagements/[engagementId]", () => {
  const context = { params: Promise.resolve({ engagementId: ENGAGEMENT }) };

  it("hides an engagement from another workspace as not found", async () => {
    engagementSingleMock.mockResolvedValueOnce({
      data: { id: ENGAGEMENT, workspace_id: OTHER_WORKSPACE },
      error: null,
    });

    const response = await patchEngagement(
      jsonRequest(`http://localhost/api/invoicing/engagements/${ENGAGEMENT}`, "PATCH", {
        workspaceId: WORKSPACE,
        status: "closed",
      }),
      context
    );

    expect(response.status).toBe(404);
    expect(engagementUpdateMock).not.toHaveBeenCalled();
  });

  it("updates engagement status and clears the ceiling", async () => {
    const response = await patchEngagement(
      jsonRequest(`http://localhost/api/invoicing/engagements/${ENGAGEMENT}`, "PATCH", {
        workspaceId: WORKSPACE,
        status: "closed",
        notToExceedAmount: null,
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(engagementUpdateMock).toHaveBeenCalledWith({ status: "closed", not_to_exceed_amount: null });
  });
});

describe("POST /api/invoicing/client-invoices", () => {
  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(401);
  });

  it("rejects a client from another workspace", async () => {
    clientLookupSingleMock.mockResolvedValueOnce({
      data: { id: CLIENT, workspace_id: OTHER_WORKSPACE },
      error: null,
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(400);
    expect(invoiceInsertMock).not.toHaveBeenCalled();
  });

  it("rejects an engagement that does not belong to the selected client", async () => {
    engagementSingleMock.mockResolvedValueOnce({
      data: {
        id: ENGAGEMENT,
        workspace_id: WORKSPACE,
        client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        project_id: null,
        not_to_exceed_amount: null,
      },
      error: null,
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Engagement does not belong to the selected client",
    });
    expect(invoiceInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a line deliverable outside the invoice's project", async () => {
    deliverablesInMock.mockResolvedValueOnce({
      data: [{ id: DELIVERABLE, project_id: OTHER_PROJECT }],
      error: null,
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", {
        ...invoicePayload,
        projectId: PROJECT,
        lineItems: [{ description: "Task 1 deliverable", amount: 5000, deliverableId: DELIVERABLE }],
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Line item deliverable does not belong to the invoice's project",
    });
    expect(invoiceInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a time entry from another engagement", async () => {
    timeEntrySelectInMock.mockResolvedValueOnce({
      data: [{ id: TIME_ENTRY, workspace_id: WORKSPACE, engagement_id: OTHER_ENGAGEMENT, billed_line_item_id: null }],
      error: null,
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Time entry does not belong to the invoice's engagement",
    });
    expect(invoiceInsertMock).not.toHaveBeenCalled();
  });

  it("answers 409 when a source time entry is already billed", async () => {
    timeEntrySelectInMock.mockResolvedValueOnce({
      data: [
        { id: TIME_ENTRY, workspace_id: WORKSPACE, engagement_id: ENGAGEMENT, billed_line_item_id: OTHER_LINE_ITEM },
      ],
      error: null,
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("already billed") });
    expect(invoiceInsertMock).not.toHaveBeenCalled();
  });

  it("creates the invoice, computes line amounts server-side, and stamps source time entries", async () => {
    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(201);
    // 10 h × 150 = 1500 — the server's unit math, not a client-sent amount.
    expect(invoiceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE,
        client_id: CLIENT,
        engagement_id: ENGAGEMENT,
        invoice_number: "INV-001",
        status: "draft",
        subtotal_amount: 1500,
        total_amount: 1500,
        created_by: USER,
      })
    );
    expect(lineInsertMock).toHaveBeenCalledWith([
      expect.objectContaining({ invoice_id: INVOICE, position: 0, amount: 1500 }),
    ]);
    expect(timeEntryUpdateMock).toHaveBeenCalledWith({ billed_line_item_id: LINE_ITEM_1 });
    expect(timeEntryUpdateInMock).toHaveBeenCalledWith("id", [TIME_ENTRY]);

    const body = await response.json();
    expect(body.invoice).toMatchObject({ id: INVOICE });
    expect(body.lineItems).toHaveLength(1);
    expect(body.nteWarning).toBeUndefined();
  });

  it("409s and rolls back when a concurrent invoice wins the stamp race", async () => {
    // The pre-insert unbilled read passed, but by stamp time another invoice
    // claimed the hours: the conditional update matches zero rows.
    timeEntryStampResult = () => ({ data: [], error: null });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("concurrent invoice"),
    });
    // The whole create is undone — no half-billed invoice survives the race.
    expect(serviceInvoiceDeleteMock).toHaveBeenCalled();
    expect(serviceInvoiceDeleteEqMock).toHaveBeenCalledWith("id", INVOICE);
  });

  it("deletes the invoice (compensating, via the service role) when the line insert fails", async () => {
    lineInsertSelectMock.mockResolvedValueOnce({
      data: null,
      error: { message: "numeric field overflow", code: "22003" },
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("rolled back"),
    });
    expect(serviceInvoiceDeleteMock).toHaveBeenCalled();
    expect(serviceInvoiceDeleteEqMock).toHaveBeenCalledWith("id", INVOICE);
    // The stamp never ran: the invoice was gone before any time entry was touched.
    expect(timeEntryUpdateMock).not.toHaveBeenCalled();
  });

  it("maps a duplicate invoice number to an honest 409", async () => {
    invoiceInsertSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "uq_client_invoices_workspace_invoice_number"', code: "23505" },
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", invoicePayload)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("already used in this workspace"),
    });
    expect(lineInsertMock).not.toHaveBeenCalled();
  });

  it("warns — and does not block — when the invoice pushes the engagement over its not-to-exceed", async () => {
    engagementSingleMock.mockResolvedValueOnce({
      data: {
        id: ENGAGEMENT,
        workspace_id: WORKSPACE,
        client_id: CLIENT,
        project_id: null,
        not_to_exceed_amount: 10000,
      },
      error: null,
    });
    invoiceListResultMock.mockReturnValueOnce({
      data: [
        {
          id: "prior",
          status: "sent",
          engagement_id: ENGAGEMENT,
          subtotal_amount: 8000,
          retention_percent: 0,
          retention_amount: 0,
          total_amount: 8000,
        },
      ],
      error: null,
    });

    const response = await postClientInvoice(
      jsonRequest("http://localhost/api/invoicing/client-invoices", "POST", {
        ...invoicePayload,
        lineItems: [{ description: "Model calibration", quantity: 10, unitAmount: 500 }],
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    // 8000 billed + 5000 this invoice = 13000 against a 10000 ceiling.
    expect(body.nteWarning).toEqual({ billedToDate: 8000, notToExceed: 10000, overBy: 3000 });
    expect(body.invoice).toMatchObject({ id: INVOICE });
  });
});

describe("GET /api/invoicing/client-invoices", () => {
  it("lists invoices with the client and engagement joined, disclosing truncation", async () => {
    invoiceLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: INVOICE,
          invoice_number: "INV-001",
          invoicing_clients: { name: "River County RTPA" },
          invoicing_engagements: { title: "On-call modeling" },
        },
      ],
      error: null,
    });

    const response = await listClientInvoices(
      new NextRequest(`http://localhost/api/invoicing/client-invoices?workspaceId=${WORKSPACE}&status=draft`)
    );

    expect(response.status).toBe(200);
    expect(invoiceSelectMock).toHaveBeenCalledWith(
      expect.stringContaining("invoicing_clients(name), invoicing_engagements(title)")
    );
    const body = await response.json();
    expect(body.invoices).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it("reports hasMore: true when the page sits exactly at the 500-row cap", async () => {
    invoiceLimitMock.mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, index) => ({ id: `invoice-${index}` })),
      error: null,
    });

    const response = await listClientInvoices(
      new NextRequest(`http://localhost/api/invoicing/client-invoices?workspaceId=${WORKSPACE}`)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasMore).toBe(true);
  });
});

describe("PATCH /api/invoicing/client-invoices/[invoiceId]", () => {
  const context = { params: Promise.resolve({ invoiceId: INVOICE }) };

  it("hides an invoice from another workspace as not found", async () => {
    invoiceDetailSingleMock.mockResolvedValueOnce({
      data: { id: INVOICE, workspace_id: OTHER_WORKSPACE, status: "draft" },
      error: null,
    });

    const response = await patchClientInvoice(
      jsonRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}`, "PATCH", {
        workspaceId: WORKSPACE,
        status: "sent",
      }),
      context
    );

    expect(response.status).toBe(404);
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses to replace line items once the invoice has been sent", async () => {
    invoiceDetailSingleMock.mockResolvedValueOnce({
      data: {
        id: INVOICE,
        workspace_id: WORKSPACE,
        engagement_id: ENGAGEMENT,
        project_id: PROJECT,
        status: "sent",
        retention_percent: 0,
      },
      error: null,
    });

    const response = await patchClientInvoice(
      jsonRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}`, "PATCH", {
        workspaceId: WORKSPACE,
        lineItems: [{ description: "Replacement line", amount: 100 }],
      }),
      context
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("void it and reissue"),
    });
    expect(lineDeleteMock).not.toHaveBeenCalled();
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
  });

  it("stamps sent_date on draft → sent", async () => {
    const response = await patchClientInvoice(
      jsonRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}`, "PATCH", {
        workspaceId: WORKSPACE,
        status: "sent",
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(invoiceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", sent_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    );
  });

  it("refuses to mark a draft invoice paid", async () => {
    const response = await patchClientInvoice(
      jsonRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}`, "PATCH", {
        workspaceId: WORKSPACE,
        status: "paid",
      }),
      context
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Only a sent invoice can be marked paid" });
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
  });

  it("voiding releases every time entry stamped to the invoice's lines", async () => {
    invoiceDetailSingleMock.mockResolvedValueOnce({
      data: {
        id: INVOICE,
        workspace_id: WORKSPACE,
        engagement_id: ENGAGEMENT,
        project_id: PROJECT,
        status: "sent",
        retention_percent: 0,
      },
      error: null,
    });
    lineSelectEqMock.mockResolvedValueOnce({
      data: [
        { id: LINE_ITEM_1, invoice_id: INVOICE, position: 0, description: "A", amount: 100 },
        { id: LINE_ITEM_2, invoice_id: INVOICE, position: 1, description: "B", amount: 200 },
      ],
      error: null,
    });

    const response = await patchClientInvoice(
      jsonRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}`, "PATCH", {
        workspaceId: WORKSPACE,
        status: "void",
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(invoiceUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "void" }));
    // The unstamp: billed_line_item_id cleared on every entry pointing at the lines.
    expect(timeEntryUpdateMock).toHaveBeenCalledWith({ billed_line_item_id: null });
    expect(timeEntryUpdateInMock).toHaveBeenCalledWith("billed_line_item_id", [LINE_ITEM_1, LINE_ITEM_2]);
  });

  it("replaces a draft invoice's line set and recomputes the stored totals", async () => {
    const response = await patchClientInvoice(
      jsonRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}`, "PATCH", {
        workspaceId: WORKSPACE,
        lineItems: [{ description: "Revised scope", amount: 250 }],
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(lineDeleteEqMock).toHaveBeenCalledWith("invoice_id", INVOICE);
    expect(lineInsertMock).toHaveBeenCalledWith([
      expect.objectContaining({ invoice_id: INVOICE, description: "Revised scope", amount: 250 }),
    ]);
    expect(invoiceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal_amount: 250, retention_amount: 0, total_amount: 250 })
    );
  });

  it("restores the previous line set when the replacement insert fails", async () => {
    // The stamp snapshot: one time entry was billed on the old line.
    timeEntrySelectInMock.mockResolvedValueOnce({
      data: [{ id: TIME_ENTRY, billed_line_item_id: LINE_ITEM_1 }],
      error: null,
    });
    lineInsertSelectMock.mockResolvedValueOnce({
      data: null,
      error: { message: "numeric field overflow", code: "22003" },
    });

    const response = await patchClientInvoice(
      jsonRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}`, "PATCH", {
        workspaceId: WORKSPACE,
        lineItems: [{ description: "Revised scope", amount: 250 }],
      }),
      context
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("previous line items were restored"),
    });
    // Snapshot → delete → failed insert of the new set → compensating
    // re-insert of the snapshot, original ids preserved.
    expect(lineInsertMock).toHaveBeenCalledTimes(2);
    expect(lineInsertMock).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: LINE_ITEM_1, description: "Old line", amount: 100 }),
    ]);
    // The billed time entry is re-stamped to the restored line: the delete's
    // ON DELETE SET NULL cleared it, and leaving it looking unbilled would
    // invite double-billing.
    expect(timeEntryUpdateMock).toHaveBeenCalledWith({ billed_line_item_id: LINE_ITEM_1 });
    expect(timeEntryUpdateInMock).toHaveBeenCalledWith("id", [TIME_ENTRY]);
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
  });
});
