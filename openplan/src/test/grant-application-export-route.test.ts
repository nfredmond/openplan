import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const renderReportPdfMock = vi.fn();
const uploadMock = vi.fn();
const storageFromMock = vi.fn(() => ({ upload: uploadMock }));
const createSignedUrlMock = vi.fn();

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EXPORT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
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

const loadOpportunityPursuitContextMock = vi.fn();
vi.mock("@/lib/grants/pursuit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/grants/pursuit")>("@/lib/grants/pursuit");
  return {
    ...actual,
    loadOpportunityPursuitContext: (...args: unknown[]) => loadOpportunityPursuitContextMock(...args),
  };
});

import { POST as exportApplication } from "@/app/api/funding-opportunities/[opportunityId]/application/export/route";
import { GET as downloadExport } from "@/app/api/funding-opportunities/[opportunityId]/application/export/[exportId]/download/route";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };
type QueryChain = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => unknown;
};

function makeQuery(result: QueryResult): QueryChain {
  const chain = {} as QueryChain;
  for (const method of ["select", "eq", "neq", "in", "order", "limit", "insert", "update", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => result);
  chain.single = vi.fn(async () => result);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function installTables(handlers: Record<string, () => QueryChain>) {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      const handler = handlers[table];
      if (!handler) throw new Error(`Unexpected table: ${table}`);
      return handler();
    }),
    storage: { from: storageFromMock },
  });
}

const baseOpportunity = {
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
};

const finalOperatorSection = {
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
  updated_by: USER_ID,
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T02:00:00.000Z",
};

const requiredMissingAttachment = {
  id: "66666666-6666-4666-8666-666666666666",
  workspace_id: WORKSPACE_ID,
  opportunity_id: OPPORTUNITY_ID,
  attachment_key: "letters-of-support",
  title: "Letters of support",
  guidance: null,
  required: true,
  status: "missing",
  kb_document_id: null,
  report_artifact_id: null,
  note: null,
  sort_order: 0,
  updated_by: null,
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:00:00.000Z",
};

const flaggedGrounding = {
  mode: "annotated",
  facts: [{ fact_id: "fact_1", claim_text: "The award is documented." }],
  sentences: [
    {
      text: "The award is documented. [fact:fact_1]",
      cited_fact_ids: ["fact_1"],
      is_grounded: true,
      unknown_fact_ids: [],
      unfaithful_claims: [],
    },
    {
      text: "An uncited flourish about outcomes.",
      cited_fact_ids: [],
      is_grounded: false,
      unknown_fact_ids: [],
      unfaithful_claims: [],
    },
  ],
  dropped_sentences: [],
  cited_fact_ids: ["fact_1"],
  unknown_fact_ids: [],
  grounded_sentence_count: 1,
  total_sentence_count: 2,
  is_fully_grounded: false,
  faithfulness_checked: true,
};

const exportRowResult = {
  id: EXPORT_ID,
  workspace_id: WORKSPACE_ID,
  opportunity_id: OPPORTUNITY_ID,
  storage_path: `${WORKSPACE_ID}/${OPPORTUNITY_ID}/${EXPORT_ID}.pdf`,
  pdf_engine: "builtin",
  page_count: 3,
  generated_by: USER_ID,
  generated_at: "2026-07-27T03:00:00.000Z",
};

function postRequest() {
  return new NextRequest(
    `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/application/export`,
    { method: "POST" }
  );
}

const postContext = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  loadFundingOpportunityAccessMock.mockResolvedValue({
    supabase: null,
    opportunity: baseOpportunity,
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    error: null,
    allowed: true,
  });
  renderReportPdfMock.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    engine: "builtin",
    pageCount: 3,
    disclosure: "Typeset by OpenPlan's built-in PDF writer.",
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
  uploadMock.mockResolvedValue({ error: null });
  createSignedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://storage.example/signed?token=abc" },
    error: null,
  });
  createServiceRoleClientMock.mockReturnValue({
    storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
  });
});

describe("POST /api/funding-opportunities/[opportunityId]/application/export", () => {
  it("refuses when a section was finalized UNEDITED from a non-exportable draft, listing the offenders", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({
          data: [
            {
              ...finalOperatorSection,
              final_markdown: "Mixed draft text.",
              finalized_from_draft_id: DRAFT_ID,
            },
          ],
          error: null,
        }),
      funding_opportunity_attachments: () => makeQuery({ data: [], error: null }),
      funding_opportunity_section_drafts: () =>
        makeQuery({
          data: [
            {
              id: DRAFT_ID,
              section_id: SECTION_ID,
              draft_markdown: "Mixed draft text.",
              model: "claude-opus-4-8",
              grounding_json: flaggedGrounding,
            },
          ],
          error: null,
        }),
    });

    const response = await exportApplication(postRequest(), postContext);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.offendingSections).toHaveLength(1);
    expect(body.offendingSections[0]).toMatchObject({
      sectionKey: "project-narrative",
      title: "Project description and scope",
    });
    expect(body.offendingSections[0].flaggedSentences[0]).toMatchObject({
      text: "An uncited flourish about outcomes.",
      reason: "missing_citation",
    });
    // Nothing is rendered or stored on a refusal.
    expect(renderReportPdfMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("lets an operator-EDITED final through even when its source draft was flagged", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({
          data: [
            {
              ...finalOperatorSection,
              final_markdown: "The operator rewrote this text after review.",
              finalized_from_draft_id: DRAFT_ID,
            },
          ],
          error: null,
        }),
      funding_opportunity_attachments: () => makeQuery({ data: [], error: null }),
      funding_opportunity_section_drafts: () =>
        makeQuery({
          data: [
            {
              id: DRAFT_ID,
              section_id: SECTION_ID,
              draft_markdown: "Mixed draft text.",
              model: "claude-opus-4-8",
              grounding_json: flaggedGrounding,
            },
          ],
          error: null,
        }),
      funding_opportunity_application_exports: () =>
        makeQuery({ data: exportRowResult, error: null }),
    });

    const response = await exportApplication(postRequest(), postContext);

    expect(response.status).toBe(201);
    // The provenance appendix discloses the edit.
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain("AI draft, operator-edited");
  });

  it("stamps the document DRAFT for outstanding required attachments without blocking", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [finalOperatorSection], error: null }),
      funding_opportunity_attachments: () =>
        makeQuery({ data: [requiredMissingAttachment], error: null }),
      funding_opportunity_application_exports: () =>
        makeQuery({ data: exportRowResult, error: null }),
    });

    const response = await exportApplication(postRequest(), postContext);

    expect(response.status).toBe(201);
    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain("DRAFT — 1 required attachment(s) outstanding");
    const body = await response.json();
    expect(body.isDraftStamped).toBe(true);
    expect(body.outstandingRequiredCount).toBe(1);
  });

  it("stores the PDF under the opportunity's own prefix and registers the export row", async () => {
    const insertChain = makeQuery({ data: exportRowResult, error: null });
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [finalOperatorSection], error: null }),
      funding_opportunity_attachments: () => makeQuery({ data: [], error: null }),
      funding_opportunity_application_exports: () => insertChain,
    });

    const response = await exportApplication(postRequest(), postContext);
    expect(response.status).toBe(201);

    expect(storageFromMock).toHaveBeenCalledWith("grant-application-exports");
    const [storagePath, bytes, options] = uploadMock.mock.calls[0];
    expect(storagePath).toMatch(
      new RegExp(`^${WORKSPACE_ID}/${OPPORTUNITY_ID}/[0-9a-f-]{36}\\.pdf$`)
    );
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(options).toMatchObject({ contentType: "application/pdf", upsert: false });

    const inserted = insertChain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      workspace_id: WORKSPACE_ID,
      opportunity_id: OPPORTUNITY_ID,
      storage_path: storagePath,
      pdf_engine: "builtin",
      page_count: 3,
      generated_by: USER_ID,
    });
    expect(inserted.id).toBe((storagePath as string).split("/")[2].replace(".pdf", ""));

    const body = await response.json();
    expect(body.export).toMatchObject({ id: EXPORT_ID, pdf_engine: "builtin" });
    expect(body.engineDisclosure).toContain("built-in PDF writer");
  });

  it("keys the cover on the pursuit kind: a proposal packet leads with the solicitation", async () => {
    loadOpportunityPursuitContextMock.mockResolvedValue({
      context: {
        pursuitKind: "proposal",
        solicitationNumber: "RFP-2026-014",
        submissionFormatNote: null,
        questionsDueAt: null,
        schemaPending: false,
      },
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [finalOperatorSection], error: null }),
      funding_opportunity_attachments: () => makeQuery({ data: [], error: null }),
      funding_opportunity_application_exports: () =>
        makeQuery({ data: exportRowResult, error: null }),
    });

    const response = await exportApplication(postRequest(), postContext);
    expect(response.status).toBe(201);

    const html = renderReportPdfMock.mock.calls[0][0] as string;
    expect(html).toContain("Proposal packet");
    expect(html).toContain("RFP-2026-014");
    expect(html).toContain("Issuing agency");
    expect(html).toContain("Proposals due");
    expect(html).not.toContain("Expected award");

    const pdfOptions = renderReportPdfMock.mock.calls[0][1] as { title: string };
    expect(pdfOptions.title).toBe("Corridor safety package — Proposal packet");
  });

  it("refuses an uninitialized application rather than exporting an empty shell", async () => {
    installTables({
      funding_opportunity_application_sections: () => makeQuery({ data: [], error: null }),
      funding_opportunity_attachments: () => makeQuery({ data: [], error: null }),
    });

    const response = await exportApplication(postRequest(), postContext);
    expect(response.status).toBe(422);
    expect(renderReportPdfMock).not.toHaveBeenCalled();
  });

  it("answers 503 with the migration to apply when the schema is pending", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({
          data: null,
          error: {
            message:
              "Could not find the table 'public.funding_opportunity_application_sections' in the schema cache",
          },
        }),
      funding_opportunity_attachments: () => makeQuery({ data: [], error: null }),
    });

    const response = await exportApplication(postRequest(), postContext);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("20260727000014_grant_application_assembly");
  });
});

describe("GET .../application/export/[exportId]/download", () => {
  function getRequest() {
    return new NextRequest(
      `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/application/export/${EXPORT_ID}/download`,
      { method: "GET" }
    );
  }
  const getContext = {
    params: Promise.resolve({ opportunityId: OPPORTUNITY_ID, exportId: EXPORT_ID }),
  };

  function installExportRow(storagePath: string | null) {
    installTables({
      funding_opportunity_application_exports: () =>
        makeQuery({
          data: storagePath
            ? {
                id: EXPORT_ID,
                opportunity_id: OPPORTUNITY_ID,
                storage_path: storagePath,
                generated_at: "2026-07-27T03:00:00.000Z",
              }
            : null,
          error: null,
        }),
    });
  }

  it("redirects to a short-lived signed URL with a recognisable filename", async () => {
    installExportRow(`${WORKSPACE_ID}/${OPPORTUNITY_ID}/${EXPORT_ID}.pdf`);

    const response = await downloadExport(getRequest(), getContext);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://storage.example/signed?token=abc");
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      `${WORKSPACE_ID}/${OPPORTUNITY_ID}/${EXPORT_ID}.pdf`,
      900,
      { download: "corridor-safety-package-2026-07-27.pdf" }
    );
  });

  it("refuses to sign a stored path outside this opportunity's own prefix", async () => {
    installExportRow(`${WORKSPACE_ID}/99999999-9999-4999-8999-999999999999/${EXPORT_ID}.pdf`);

    const response = await downloadExport(getRequest(), getContext);

    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an export row that does not exist", async () => {
    installExportRow(null);
    expect((await downloadExport(getRequest(), getContext)).status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});
