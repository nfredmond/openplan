import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildClientInvoiceHtml } from "@/lib/invoicing/invoice-pdf";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const renderReportPdfMock = vi.fn();
const summaryRpcMock = vi.fn();

// workspace_members
const membersMaybeSingleMock = vi.fn();
const membersEqUserMock = vi.fn(() => ({ maybeSingle: membersMaybeSingleMock }));
const membersEqWorkspaceMock = vi.fn(() => ({ eq: membersEqUserMock }));
const membersSelectMock = vi.fn(() => ({ eq: membersEqWorkspaceMock }));

// client_invoices — detail single plus the awaited engagement-invoices list.
const invoiceDetailSingleMock = vi.fn();
const invoiceListResultMock = vi.fn(() => ({ data: [] as unknown[], error: null as { message: string } | null }));
type InvoiceQueryChain = {
  eq: (...args: unknown[]) => InvoiceQueryChain;
  single: typeof invoiceDetailSingleMock;
  then: (resolve: (value: unknown) => void) => void;
};
const invoiceQueryChain: InvoiceQueryChain = {
  eq: vi.fn(() => invoiceQueryChain),
  single: invoiceDetailSingleMock,
  then: (resolve) => resolve(invoiceListResultMock()),
};
const invoiceSelectMock = vi.fn(() => invoiceQueryChain);

// workspaces
const workspaceSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ single: workspaceSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

// invoicing_clients
const clientSingleMock = vi.fn();
const clientEqMock = vi.fn(() => ({ single: clientSingleMock }));
const clientSelectMock = vi.fn(() => ({ eq: clientEqMock }));

// invoicing_engagements
const engagementSingleMock = vi.fn();
const engagementWorkspaceEqMock = vi.fn(() => ({ single: engagementSingleMock }));
const engagementEqMock = vi.fn(() => ({ eq: engagementWorkspaceEqMock, single: engagementSingleMock }));
const engagementSelectMock = vi.fn(() => ({ eq: engagementEqMock }));

// client_invoice_line_items — select().eq().order() resolves the ordered list
const lineOrderMock = vi.fn();
const lineEqMock = vi.fn(() => ({ order: lineOrderMock }));
const lineSelectMock = vi.fn(() => ({ eq: lineEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membersSelectMock };
  }
  if (table === "client_invoices") {
    return { select: invoiceSelectMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "invoicing_clients") {
    return { select: clientSelectMock };
  }
  if (table === "invoicing_engagements") {
    return { select: engagementSelectMock };
  }
  if (table === "client_invoice_line_items") {
    return { select: lineSelectMock };
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

vi.mock("@/lib/reports/pdf", () => ({
  renderReportPdf: (...args: unknown[]) => renderReportPdfMock(...args),
}));

import { GET as getInvoicePdf } from "@/app/api/invoicing/client-invoices/[invoiceId]/pdf/route";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const ENGAGEMENT = "44444444-4444-4444-8444-444444444444";
const INVOICE = "77777777-7777-4777-8777-777777777777";

function summarySnapshot(ceiling: string | null = null, billed = "0", draft = "0", missing = "0") {
  return { data: { version: 1, workspace_id: WORKSPACE, engagement_id: ENGAGEMENT, exclude_invoice_id: null, complete: true, error: null,
    data: [{ engagement_id: ENGAGEMENT, not_to_exceed_amount: ceiling, billed: { amount: billed, missing, invalid: "0" }, draft: { amount: draft, missing: "0", invalid: "0" } }] }, error: null };
}

const baseHtmlData = {
  workspace: { name: "Sierra Planning Collective" },
  client: {
    name: "River County RTPA",
    billing_address: "101 Main Street\nRiverton",
    contact_name: "A. Accounts",
    contact_email: "ap@example.gov",
  },
  invoice: {
    invoice_number: "INV-042",
    status: "sent",
    invoice_date: "2026-07-15",
    period_start: "2026-06-01",
    period_end: "2026-06-30",
    due_date: "2026-08-15",
    subtotal_amount: 5000,
    retention_percent: 0,
    retention_amount: 0,
    total_amount: 5000,
    payment_terms: "Net 30 from receipt",
    currency_code: "USD",
    notes: "June progress billing",
  },
  lineItems: [
    { description: "Corridor model calibration", quantity: 20, unit_label: "hour", unit_amount: 150, amount: 3000 },
    { description: "Public workshop synthesis", quantity: null, unit_label: null, unit_amount: null, amount: 2000 },
  ],
  engagement: null,
  engagementBilled: null,
};

describe("buildClientInvoiceHtml", () => {
  it("carries the issuer, the bill-to block, and every line item", () => {
    const html = buildClientInvoiceHtml(baseHtmlData);

    expect(html).toContain("Sierra Planning Collective");
    expect(html).toContain("River County RTPA");
    expect(html).toContain("101 Main Street");
    expect(html).toContain("A. Accounts");
    expect(html).toContain("ap@example.gov");
    expect(html).toContain("INV-042");
    expect(html).toContain("Corridor model calibration");
    expect(html).toContain("Public workshop synthesis");
    expect(html).toContain("Net 30 from receipt");
    expect(html).toContain("June progress billing");
    expect(html).toContain("$5,000.00");
  });

  it("shows the retention row only when a retention percentage is withheld", () => {
    const withoutRetention = buildClientInvoiceHtml(baseHtmlData);
    expect(withoutRetention).not.toContain("Retention withheld");

    const withRetention = buildClientInvoiceHtml({
      ...baseHtmlData,
      invoice: {
        ...baseHtmlData.invoice,
        retention_percent: 10,
        retention_amount: 500,
        total_amount: 4500,
      },
    });
    expect(withRetention).toContain("Retention withheld (10%)");
    expect(withRetention).toContain("$500.00");
    expect(withRetention).toContain("$4,500.00");
  });

  it("adds the engagement reference and not-to-exceed context when linked", () => {
    const html = buildClientInvoiceHtml({
      ...baseHtmlData,
      engagement: {
        title: "On-call modeling",
        reference_code: "TO-7",
        not_to_exceed_amount: 50000,
      },
      engagementBilled: {
        billedToDate: 18000,
        draftedUnbilled: 0,
        notToExceed: 50000,
        remaining: 32000,
        isOverNte: false,
      },
    });

    expect(html).toContain("Engagement: On-call modeling (Ref TO-7)");
    expect(html).toContain("Not-to-exceed 50000.00 (currency unassessed)");
    expect(html).toContain("billed to date 18000.00 (currency unassessed)");
    expect(html).toContain("remaining 32000.00 (currency unassessed)");
  });

  it.each([
    ["EUR", "€5,000.00", "€3,000.00"],
    ["JPY", "¥5,000", "¥3,000"],
  ])("keeps %s invoice amounts separate from exact unassessed PDF context", (currencyCode, invoiceTotal, lineAmount) => {
    const html = buildClientInvoiceHtml({
      ...baseHtmlData,
      invoice: { ...baseHtmlData.invoice, currency_code: currencyCode },
      engagement: { title: "Legacy context", not_to_exceed_amount: "50000.01" },
      engagementBilled: { billedToDate: "90999999999999.09", draftedUnbilled: "91999999999999.08", notToExceed: "50000.01", remaining: "-90999999949999.08", isOverNte: true },
    });
    const context = html.match(/<div class="engagement-context">([\s\S]*?)<\/div>/)![1];
    expect(context).toContain("Not-to-exceed 50000.01 (currency unassessed)");
    expect(context).toContain("billed to date 90999999999999.09 (currency unassessed) gross before retention");
    expect(context).toContain("remaining -90999999949999.08 (currency unassessed)");
    expect(context).toContain("gross draft 91999999999999.08 (currency unassessed)");
    expect(context).toContain("Aggregate currency, legacy ceiling currency and currency agreement across invoices are unassessed.");
    expect(context).toContain("This is a numerical comparison only; agreement terms are unassessed.");
    expect(context).not.toMatch(/[€¥$]/);
    expect(html).toContain(invoiceTotal);
    expect(html).toContain(lineAmount);
  });

  it("escapes every user-entered string — markup in a description arrives as text", () => {
    const html = buildClientInvoiceHtml({
      ...baseHtmlData,
      workspace: { name: 'Acme & Sons <Planning>' },
      client: { ...baseHtmlData.client, name: '"River" & Co' },
      invoice: {
        ...baseHtmlData.invoice,
        notes: "<img src=x onerror=alert(1)>",
        payment_terms: "Net 30 & no <b>bold</b> claims",
      },
      lineItems: [{ description: '<script>alert("boom")</script>', amount: 100 }],
      engagement: { title: "<script>steal()</script>", reference_code: null, not_to_exceed_amount: null },
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;boom&quot;)&lt;/script&gt;");
    expect(html).toContain("Acme &amp; Sons &lt;Planning&gt;");
    expect(html).toContain("&quot;River&quot; &amp; Co");
  });

  it("does not invent dollars for a legacy invoice without a currency",()=>{
    const html=buildClientInvoiceHtml({...baseHtmlData,invoice:{...baseHtmlData.invoice,currency_code:null}});
    expect(html).toContain("5000.00 (currency unassessed)");
    expect(html).not.toContain("$5,000.00");
  });

  it("formats amounts in the invoice's own currency code when one is recorded", () => {
    const html = buildClientInvoiceHtml({
      ...baseHtmlData,
      invoice: { ...baseHtmlData.invoice, currency_code: "EUR" },
    });

    expect(html).toContain("€5,000.00");
    expect(html).not.toContain("$5,000.00");
  });
});

describe("GET /api/invoicing/client-invoices/[invoiceId]/pdf", () => {
  const context = { params: Promise.resolve({ invoiceId: INVOICE }) };

  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    summaryRpcMock.mockReset().mockResolvedValue(summarySnapshot());

    authGetUserMock.mockResolvedValue({ data: { user: { id: USER } } });
    membersMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE, role: "member" },
      error: null,
    });

    invoiceDetailSingleMock.mockResolvedValue({
      data: {
        id: INVOICE,
        workspace_id: WORKSPACE,
        client_id: CLIENT,
        engagement_id: ENGAGEMENT,
        invoice_number: "INV 042/July",
        status: "sent",
        invoice_date: "2026-07-15",
        subtotal_amount: 5000,
        retention_percent: 0,
        retention_amount: 0,
        total_amount: 5000,
        currency_code: null,
      },
      error: null,
    });
    invoiceListResultMock.mockReturnValue({ data: [], error: null });

    workspaceSingleMock.mockResolvedValue({
      data: { id: WORKSPACE, name: "Sierra Planning Collective" },
      error: null,
    });
    clientSingleMock.mockResolvedValue({
      data: { name: "River County RTPA", billing_address: null, contact_name: null, contact_email: null },
      error: null,
    });
    engagementSingleMock.mockResolvedValue({
      data: { id: ENGAGEMENT, title: "On-call modeling", reference_code: "TO-7", not_to_exceed_amount: null },
      error: null,
    });
    lineOrderMock.mockResolvedValue({
      data: [{ description: "Corridor model calibration", quantity: 20, unit_label: "hour", unit_amount: 150, amount: 3000, position: 0 }],
      error: null,
    });

    renderReportPdfMock.mockResolvedValue({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      engine: "chrome",
      pageCount: null,
      disclosure: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
      rpc: summaryRpcMock,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getInvoicePdf(
      new NextRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}/pdf`),
      context
    );

    expect(response.status).toBe(401);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("answers 404 when the invoice is not visible to the caller", async () => {
    invoiceDetailSingleMock.mockResolvedValueOnce({ data: null, error: { message: "0 rows" } });

    const response = await getInvoicePdf(
      new NextRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}/pdf`),
      context
    );

    expect(response.status).toBe(404);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("refuses when the caller has no membership in the invoice's workspace", async () => {
    membersMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await getInvoicePdf(
      new NextRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}/pdf`),
      context
    );

    expect(response.status).toBe(403);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("retains exact aggregate cents through artifact assembly and HTML", async () => {
    engagementSingleMock.mockResolvedValueOnce({ data: { id: ENGAGEMENT, title: "Precision fixture", not_to_exceed_amount: "999999999999.99" }, error: null });
    summaryRpcMock.mockResolvedValueOnce(summarySnapshot("999999999999.99", "44999999999999.55"));
    const response = await getInvoicePdf(new NextRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}/pdf`), context);
    expect(response.status).toBe(200);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain("billed to date 44999999999999.55 (currency unassessed) gross before retention");
    expect(html).toContain("remaining -43999999999999.56 (currency unassessed)");
    expect(summaryRpcMock).toHaveBeenCalledWith("engagement_billed_summaries_v1", { p_workspace_id: WORKSPACE, p_engagement_id: ENGAGEMENT, p_exclude_invoice_id: null });
    expect(invoiceSelectMock).not.toHaveBeenCalledWith("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount");
    expect(engagementSelectMock).toHaveBeenCalledWith("id, title, reference_code, not_to_exceed_amount");
  });

  it("keeps an invoice artifact usable with an unavailable billed bucket", async () => {
    engagementSingleMock.mockResolvedValueOnce({ data: { id: ENGAGEMENT, title: "Missing fixture", not_to_exceed_amount: "bad" }, error: null });
    summaryRpcMock.mockResolvedValueOnce(summarySnapshot("bad", "0", "2", "1"));
    const response = await getInvoicePdf(new NextRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}/pdf`), context);
    expect(response.status).toBe(200);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain("Gross billed calculation unavailable (missing amount)");
    expect(html).toContain("Legacy ceiling calculation unavailable (invalid amount)");
    expect(html).toContain("gross draft 2.00 (currency unassessed)");
  });

  it.each(["pending", "unavailable"])("ESComplete discloses %s snapshot without suppressing the invoice PDF", async (state) => {
    summaryRpcMock.mockResolvedValueOnce({ data: null, error: state === "pending" ? {
      code: "PGRST202", message: "Could not find the function public.engagement_billed_summaries_v1(p_engagement_id, p_exclude_invoice_id, p_workspace_id) in the schema cache",
    } : { code: "42501", message: "permission denied for table client_invoices" } });
    const response = await getInvoicePdf(new NextRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}/pdf`), context);
    expect(response.status).toBe(200);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain(state === "pending" ? "pending schema upgrade" : "source unavailable");
    expect(html).toContain("Gross billed, remaining and draft positions are unknown.");
    expect(html).not.toContain("billed to date 0.00");
    expect(summaryRpcMock).toHaveBeenCalledWith("engagement_billed_summaries_v1", { p_workspace_id: WORKSPACE, p_engagement_id: ENGAGEMENT, p_exclude_invoice_id: null });
    expect(engagementEqMock).toHaveBeenCalledWith("id", ENGAGEMENT);
    expect(engagementWorkspaceEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE);
  });

  it("renders through renderReportPdf and streams application/pdf as an attachment named for the invoice", async () => {
    const response = await getInvoicePdf(
      new NextRequest(`http://localhost/api/invoicing/client-invoices/${INVOICE}/pdf`),
      context
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="invoice-inv-042-july.pdf"');
    expect(response.headers.get("x-openplan-pdf-engine")).toBe("chrome");

    // THE one PDF pipeline: the invoice document goes through renderReportPdf,
    // fed by the HTML builder — no separate rendering path.
    expect(renderReportPdfMock).toHaveBeenCalledTimes(1);
    const [html, options] = renderReportPdfMock.mock.calls[0] as [string, { title: string }];
    expect(html).toContain("INV 042/July");
    expect(html).toContain("Sierra Planning Collective");
    expect(html).toContain("River County RTPA");
    expect(html).toContain("Corridor model calibration");
    expect(options.title).toBe("Invoice INV 042/July");

    const body = new Uint8Array(await response.arrayBuffer());
    expect([...body]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});
