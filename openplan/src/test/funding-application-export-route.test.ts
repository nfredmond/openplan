import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE PROGRAM LINE ON A FUNDER-FACING COVER PAGE.
 *
 * The application export prints the program an opportunity belongs to on the
 * cover of a PDF that goes to the funder. The read that fetches the program's
 * title used to be treated as best-effort: on failure it left the title null,
 * and the cover renders null as "Not linked" — so a read failure printed the
 * opposite of the truth about an opportunity whose `program_id` is set, inside
 * the one artifact no reader can check against the database.
 *
 * A mocked Supabase client answers whatever it is asked, so this harness fails
 * the `programs` read BY NAME and leaves the section, attachment and export
 * reads working. It asserts both halves: the export refuses, and no PDF
 * carrying "Not linked" is ever rendered or stored.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const renderReportPdfMock = vi.fn();
const uploadMock = vi.fn();
const loadOpportunityPursuitContextMock = vi.fn();

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROGRAM_ID = "77777777-7777-4777-8777-777777777777";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const EXPORT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));

vi.mock("@/lib/reports/pdf", () => ({
  renderReportPdf: (...args: unknown[]) => renderReportPdfMock(...args),
}));

vi.mock("@/lib/grants/pursuit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/grants/pursuit")>("@/lib/grants/pursuit");
  return {
    ...actual,
    loadOpportunityPursuitContext: (...args: unknown[]) => loadOpportunityPursuitContextMock(...args),
  };
});

import { POST as exportApplication } from "@/app/api/funding-opportunities/[opportunityId]/application/export/route";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const CHAIN_METHODS = ["select", "eq", "in", "order", "limit", "insert", "update", "delete"];

function makeChain(resolve: () => QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolve());
  chain.single = vi.fn(async () => resolve());
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return chain;
}

/** The `programs` read — the one read each test varies. */
let programRead: QueryResult;

const finalSection = {
  id: SECTION_ID,
  workspace_id: WORKSPACE_ID,
  opportunity_id: OPPORTUNITY_ID,
  section_key: "project-narrative",
  title: "Project description and scope",
  guidance: null,
  sort_order: 0,
  source: "catalog",
  suggested_evidence: [],
  ai_drafting_enabled: true,
  status: "final",
  final_markdown: "Operator-approved text.",
  finalized_from_draft_id: null,
  finalized_by: USER_ID,
  finalized_at: "2026-07-27T02:00:00.000Z",
  updated_by: USER_ID,
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T02:00:00.000Z",
};

const exportRow = {
  id: EXPORT_ID,
  workspace_id: WORKSPACE_ID,
  opportunity_id: OPPORTUNITY_ID,
  storage_path: `${WORKSPACE_ID}/${OPPORTUNITY_ID}/${EXPORT_ID}.pdf`,
  pdf_engine: "builtin",
  page_count: 3,
  generated_by: USER_ID,
  generated_at: "2026-07-27T03:00:00.000Z",
};

function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "funding_opportunity_application_sections") {
        return makeChain(() => ({ data: [finalSection], error: null }));
      }
      if (table === "funding_opportunity_attachments") {
        return makeChain(() => ({ data: [], error: null }));
      }
      if (table === "programs") {
        return makeChain(() => programRead);
      }
      if (table === "funding_opportunity_application_exports") {
        return makeChain(() => ({ data: exportRow, error: null }));
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    storage: { from: vi.fn(() => ({ upload: uploadMock })) },
  });
}

function postRequest() {
  return new NextRequest(
    `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/application/export`,
    { method: "POST" }
  );
}

const routeContext = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };

/** The cover HTML the PDF was built from, or null when nothing was rendered. */
function renderedCoverHtml(): string | null {
  const call = renderReportPdfMock.mock.calls[0];
  return call ? (call[0] as string) : null;
}

describe("POST /api/funding-opportunities/[opportunityId]/application/export — the program line", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: {
        id: OPPORTUNITY_ID,
        workspace_id: WORKSPACE_ID,
        program_id: PROGRAM_ID,
        project_id: null,
        title: "Corridor safety package",
        opportunity_status: "open",
        decision_state: "pursue",
        agency_name: "State transportation commission",
        summary: "Corridor summary.",
        expected_award_amount: 500000,
        closes_at: "2026-09-30T00:00:00.000Z",
      },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });
    loadOpportunityPursuitContextMock.mockResolvedValue({
      context: {
        pursuitKind: "grant",
        solicitationNumber: null,
        submissionFormatNote: null,
        questionsDueAt: null,
        schemaPending: false,
      },
      error: null,
    });
    renderReportPdfMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      engine: "builtin",
      pageCount: 3,
      disclosure: "Typeset by OpenPlan's built-in PDF writer.",
    });
    uploadMock.mockResolvedValue({ error: null });
    programRead = { data: { id: PROGRAM_ID, title: "Active Transportation Program" }, error: null };
    installClient();
  });

  it("refuses the export rather than printing 'Not linked' over a program-linked opportunity", async () => {
    programRead = {
      data: null,
      error: { message: "permission denied for table programs", code: "42501" },
    };

    const response = await exportApplication(postRequest(), routeContext);
    const body = await response.json();

    // Nothing is typeset and nothing is stored: the funder never sees the
    // sentence the failed read would have produced.
    expect(renderReportPdfMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load the linked program");
    expect(body.hint).toContain("read failure, not an empty result");

    expect(mockAudit.error).toHaveBeenCalledWith(
      "application_export_program_load_failed",
      expect.objectContaining({
        programId: PROGRAM_ID,
        message: "permission denied for table programs",
      })
    );
  });

  it("answers 503 when the programs table is not migrated yet", async () => {
    programRead = {
      data: null,
      error: { message: "Could not find the table 'public.programs' in the schema cache" },
    };

    const response = await exportApplication(postRequest(), routeContext);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("The linked program schema is not available yet");
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("prints the program on the cover when the read succeeds", async () => {
    const response = await exportApplication(postRequest(), routeContext);

    expect(response.status).toBe(201);
    const html = renderedCoverHtml();
    expect(html).toContain("Active Transportation Program");
    expect(html).not.toContain("Not linked");
  });

  it("still prints 'Not linked' for an opportunity that carries no program at all", async () => {
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: {
        id: OPPORTUNITY_ID,
        workspace_id: WORKSPACE_ID,
        program_id: null,
        project_id: null,
        title: "Corridor safety package",
        opportunity_status: "open",
        decision_state: "pursue",
        agency_name: "State transportation commission",
        summary: "Corridor summary.",
        expected_award_amount: 500000,
        closes_at: "2026-09-30T00:00:00.000Z",
      },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    const response = await exportApplication(postRequest(), routeContext);

    expect(response.status).toBe(201);
    expect(renderedCoverHtml()).toContain("Not linked");
  });
});
