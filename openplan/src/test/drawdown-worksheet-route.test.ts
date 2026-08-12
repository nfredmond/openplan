import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE ROUTE THAT ASSEMBLES THE REIMBURSEMENT WORKSHEET.
 *
 * The pure builder is tested next door; what can only be tested HERE is what
 * the route does with reads that fail, and with a caller naming the wrong
 * workspace. One of those is a money-safety rule and the reason this file
 * exists:
 *
 *   A FAILED INVOICE READ MUST NOT PRODUCE A WORKSHEET. A packet reading
 *   "claimed to date $0.00" against a $250,000 award is not a degraded
 *   document — it is a database error wearing an actionable fact, and an
 *   agency would act on it. The route refuses.
 *
 * A cost-ledger failure is deliberately NOT symmetric: it is detail rather than
 * the award position, so the packet still leaves the building with the failure
 * printed on it. That asymmetry is the thing most likely to be "tidied up" by a
 * later edit, so both halves are asserted.
 *
 * A mocked Supabase client cannot catch a missing projection, so the select
 * strings are asserted directly (see `public-engagement-page.test.tsx` for the
 * same technique) — a worksheet that never asked for `paid_date` would render
 * every payment date as unrecorded and be green all the way down.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const renderReportPdfMock = vi.fn();
const buildWorksheetHtmlMock = vi.fn();
const authGetUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: createApiAuditLoggerMock }));
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: renderReportPdfMock }));

// The builder is spied, not replaced: the route must be shown to hand it the
// LEDGER's figures. The real implementation still produces the HTML.
vi.mock("@/lib/invoicing/reimbursement-worksheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoicing/reimbursement-worksheet")>();
  buildWorksheetHtmlMock.mockImplementation(actual.buildReimbursementWorksheetHtml);
  return { ...actual, buildReimbursementWorksheetHtml: buildWorksheetHtmlMock };
});

const { GET } = await import("@/app/api/funding-awards/[awardId]/drawdown-worksheet/route");

const AWARD_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

type TableResult = { data: unknown; error: { message: string } | null };

/** Every `.select()` string the route issued, by table. */
let selects: Record<string, string[]>;
/** Every filter the route applied, by table: `eq:column=value`, `gte:…`, `lte:…`. */
let filters: Record<string, string[]>;
let tableResults: Record<string, TableResult>;

/**
 * A chainable Supabase stand-in that RECORDS what it was asked for.
 *
 * A fake that records nothing proves nothing about a service-role read path —
 * the `.eq()` chain IS the access control here, so it is captured and asserted.
 */
function makeChain(table: string) {
  const record = (kind: string, column: string, value: unknown) => {
    (filters[table] ??= []).push(`${kind}:${column}=${String(value)}`);
  };
  const result = () => tableResults[table] ?? { data: [], error: null };

  const chain: Record<string, unknown> = {
    eq: (column: string, value: unknown) => (record("eq", column, value), chain),
    gte: (column: string, value: unknown) => (record("gte", column, value), chain),
    lte: (column: string, value: unknown) => (record("lte", column, value), chain),
    order: () => Promise.resolve(result()),
    maybeSingle: () => Promise.resolve(result()),
    single: () => Promise.resolve(result()),
    then: (resolve: (value: TableResult) => void) => resolve(result()),
  };
  return chain;
}

function setDefaults() {
  tableResults = {
    funding_awards: {
      data: {
        id: AWARD_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "Ridge Corridor Safety Improvements",
        awarded_amount: "250000.00",
        match_amount: "32362.50",
        match_posture: "secured",
      },
      error: null,
    },
    projects: {
      data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Ridge Corridor" },
      error: null,
    },
    workspace_members: { data: { workspace_id: WORKSPACE_ID, role: "viewer" }, error: null },
    billing_invoice_records: {
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          invoice_number: "RB-2026-001",
          status: "paid",
          amount: "80000.00",
          retention_percent: 5,
          retention_amount: 0,
          invoice_date: "2026-01-15",
          due_date: "2026-02-14",
          paid_date: "2026-02-10",
        },
      ],
      error: null,
    },
    project_spend_entries: {
      data: [
        { entry_date: "2026-01-08", description: "Traffic counts", vendor_label: "Sierra Counts", amount: "4210.75" },
      ],
      error: null,
    },
    workspaces: {
      data: {
        id: WORKSPACE_ID,
        name: "Sierra Regional Transportation Agency",
        // `home_geography_source` is what makes the row parse at all — a
        // workspace with codes but no source has not stated where it works.
        home_geography_source: "place_boundary",
        home_geography_kind: "county",
        home_geography_ref: "48453",
        home_country_code: "US",
        home_subdivision_code: "TX",
      },
      error: null,
    },
  };
}

function request(query = `workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost/api/funding-awards/${AWARD_ID}/drawdown-worksheet?${query}`);
}

function context() {
  return { params: Promise.resolve({ awardId: AWARD_ID }) };
}

/** The HTML the route actually handed the renderer. */
function renderedHtml(): string {
  expect(renderReportPdfMock).toHaveBeenCalled();
  return renderReportPdfMock.mock.calls[0][0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  selects = {};
  filters = {};
  setDefaults();

  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: (table: string) => ({
      select: (columns: string) => {
        (selects[table] ??= []).push(columns);
        return makeChain(table);
      },
    }),
  });
  createApiAuditLoggerMock.mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  renderReportPdfMock.mockResolvedValue({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    engine: "chrome",
    pageCount: null,
    disclosure: null,
  });
});

describe("GET the reimbursement worksheet", () => {
  it("returns the packet as a PDF attachment", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      "reimbursement-worksheet-ridge-corridor-safety-improvements.pdf"
    );
    expect(renderReportPdfMock.mock.calls[0][1]).toMatchObject({
      title: "Reimbursement worksheet — Ridge Corridor Safety Improvements",
    });
  });

  /**
   * The per-page footer is the ONLY disclaimer that reaches every page of the
   * built-in tier — the HTML's `position: fixed` page-footer is a Chrome-only
   * mechanism, so a Chrome-less self-hosted deployment printed middle pages of
   * claim figures with nothing saying who produced them. The route must hand
   * the renderer the DISCLAIMER, not the document title.
   */
  it("feeds the renderer the disclaimer as its per-page footer, not the document title", async () => {
    await GET(request(), context());

    // Imported here, not at the top: this module is mocked by a factory above,
    // and a static import would evaluate it before the mock exists.
    const { WORKSHEET_DOCUMENT_TITLE, WORKSHEET_FOOTER_NOTE } = await import(
      "@/lib/invoicing/reimbursement-worksheet"
    );

    const options = renderReportPdfMock.mock.calls[0][1] as { footerLabel?: string };
    expect(options.footerLabel).toBe(WORKSHEET_FOOTER_NOTE);
    expect(options.footerLabel).not.toBe(WORKSHEET_DOCUMENT_TITLE);
    expect(options.footerLabel).toMatch(/not a funder's form/i);
  });

  it("asks the database for every column the ledger needs, including the payment date", async () => {
    await GET(request(), context());

    const invoiceSelect = selects.billing_invoice_records?.[0] ?? "";
    for (const column of ["amount", "retention_percent", "retention_amount", "status", "paid_date"]) {
      expect(invoiceSelect, `the invoice read never asked for ${column}`).toContain(column);
    }
    // Scoped to THIS award, not to the workspace's whole register.
    expect(filters.billing_invoice_records).toContain(`eq:funding_award_id=${AWARD_ID}`);
  });

  it("hands the builder the ledger's own figures", async () => {
    await GET(request(), context());

    const data = buildWorksheetHtmlMock.mock.calls[0][0];
    // 80,000 gross at 5% -> 4,000 retention, 76,000 net, and it is paid.
    expect(data.ledger.claimedGrossToDate).toBe(80000);
    expect(data.ledger.paidToDate).toBe(76000);
    expect(data.ledger.retentionHeld).toBe(4000);
    expect(data.ledger.authorizedAmount).toBe(250000);
    expect(data.ledger.remainingAuthorized).toBe(170000);
    expect(renderedHtml()).toContain("$170,000.00");
  });

  it("scopes the project cost ledger to the requested period", async () => {
    await GET(request(`workspaceId=${WORKSPACE_ID}&periodStart=2026-01-01&periodEnd=2026-02-28`), context());

    expect(filters.project_spend_entries).toEqual(
      expect.arrayContaining([
        `eq:project_id=${PROJECT_ID}`,
        "gte:entry_date=2026-01-01",
        "lte:entry_date=2026-02-28",
      ])
    );
  });

  it("binds the reimbursement process from the workspace's own geography", async () => {
    await GET(request(), context());
    const data = buildWorksheetHtmlMock.mock.calls[0][0];
    // A Texas workspace is COVERED by the nationwide tier — a real match, so
    // nothing is disclosed as assumed.
    expect(data.profile.selection).toBe("jurisdiction_matched");
    expect(renderedHtml()).not.toContain("This process was not chosen for this workspace.");
  });

  it("discloses the interim default when the workspace has not said where it works", async () => {
    tableResults.workspaces = {
      data: { id: WORKSPACE_ID, name: "Sierra Regional Transportation Agency" },
      error: null,
    };

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(buildWorksheetHtmlMock.mock.calls[0][0].profile.selection).toBe("interim_unconfigured_default");
    expect(renderedHtml()).toContain("This process was not chosen for this workspace.");
  });

  it("says so on the packet when the workspace row itself could not be read", async () => {
    tableResults.workspaces = { data: null, error: { message: "connection reset by peer" } };

    const response = await GET(request(), context());

    // A packet without the workspace's name is degraded, not wrong — but the
    // degradation is disclosed rather than silently shown as the default.
    expect(response.status).toBe(200);
    expect(renderedHtml()).toContain("could not be read, so the reimbursement process shown is the interim default");
  });
});

describe("a failed read never becomes a zero", () => {
  it("REFUSES rather than rendering a worksheet of zeros when the invoice read fails", async () => {
    tableResults.billing_invoice_records = { data: null, error: { message: "connection reset by peer" } };

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("no worksheet can be produced"),
    });
  });

  it("calls an unapplied migration a setup gap (503), not a fault (500)", async () => {
    tableResults.billing_invoice_records = {
      data: null,
      error: { message: 'column billing_invoice_records.funding_award_id does not exist' },
    };

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("retries WITHOUT paid_date when that column is not deployed yet, and discloses the loss", async () => {
    // The deploy/migrate window: the column is new, so an older database
    // answers PostgREST's "does not exist". A setup gap is not a fault.
    let call = 0;
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: (table: string) => ({
        select: (columns: string) => {
          (selects[table] ??= []).push(columns);
          if (table === "billing_invoice_records") {
            call += 1;
            if (call === 1) {
              tableResults.billing_invoice_records = {
                data: null,
                error: { message: 'column billing_invoice_records.paid_date does not exist' },
              };
            } else {
              tableResults.billing_invoice_records = { data: [], error: null };
            }
          }
          return makeChain(table);
        },
      }),
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(selects.billing_invoice_records?.[0]).toContain("paid_date");
    expect(selects.billing_invoice_records?.[1]).not.toContain("paid_date");
    expect(renderedHtml()).toContain("Payment dates are not available on this deployment yet");
  });

  it("does NOT retry a permission failure as if it were a pending migration", async () => {
    tableResults.billing_invoice_records = {
      data: null,
      error: { message: "permission denied for table billing_invoice_records" },
    };

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
    // One read, not two: a refusal must not be papered over by a narrower retry.
    expect(selects.billing_invoice_records).toHaveLength(1);
  });

  it("still produces the packet when the COST ledger fails, with the failure printed on it", async () => {
    tableResults.project_spend_entries = { data: null, error: { message: "connection reset by peer" } };

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    const html = renderedHtml();
    expect(html).toContain("could not be read");
    expect(html).toContain("This is not a statement that no costs were recorded.");
    expect(html).not.toContain("No cost entries recorded for this period.");
  });
});

describe("who may read a worksheet", () => {
  it("rejects an unauthenticated caller", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await GET(request(), context());
    expect(response.status).toBe(401);
  });

  it("answers 'not found' when the caller names a different workspace", async () => {
    // Which awards exist elsewhere is not this caller's business, so the answer
    // is 404 rather than a 403 that confirms the award exists.
    const response = await GET(request("workspaceId=99999999-9999-4999-8999-999999999999"), context());
    expect(response.status).toBe(404);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("refuses a non-member", async () => {
    tableResults.workspace_members = { data: null, error: null };
    const response = await GET(request(), context());
    expect(response.status).toBe(403);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("lets a viewer read one — a worksheet is a read, not a write", async () => {
    tableResults.workspace_members = { data: { workspace_id: WORKSPACE_ID, role: "viewer" }, error: null };
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
  });

  it("rejects a malformed period instead of guessing at one", async () => {
    const response = await GET(request(`workspaceId=${WORKSPACE_ID}&periodStart=January`), context());
    expect(response.status).toBe(400);
  });

  it("rejects a period whose start falls after its end", async () => {
    const response = await GET(
      request(`workspaceId=${WORKSPACE_ID}&periodStart=2026-06-01&periodEnd=2026-01-01`),
      context()
    );
    expect(response.status).toBe(400);
  });

  it("requires the workspace to be named at all", async () => {
    const response = await GET(request(""), context());
    expect(response.status).toBe(400);
  });
});
