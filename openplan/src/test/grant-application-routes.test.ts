import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const loadOpportunityPursuitContextMock = vi.fn();

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const ATTACHMENT_ID = "66666666-6666-4666-8666-666666666666";
const KB_DOCUMENT_ID = "77777777-7777-4777-8777-777777777777";
const REPORT_ARTIFACT_ID = "88888888-8888-4888-8888-888888888888";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));

vi.mock("@/lib/grants/pursuit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/grants/pursuit")>("@/lib/grants/pursuit");
  return {
    ...actual,
    loadOpportunityPursuitContext: (...args: unknown[]) => loadOpportunityPursuitContextMock(...args),
  };
});

import { GET as getApplication, PATCH as reorderApplication, POST as initApplication } from "@/app/api/funding-opportunities/[opportunityId]/application/route";
import { POST as createSection } from "@/app/api/funding-opportunities/[opportunityId]/sections/route";
import {
  DELETE as deleteSection,
  PATCH as patchSection,
} from "@/app/api/funding-opportunities/[opportunityId]/sections/[sectionId]/route";
import { POST as createAttachment } from "@/app/api/funding-opportunities/[opportunityId]/attachments/route";
import { PATCH as patchAttachment } from "@/app/api/funding-opportunities/[opportunityId]/attachments/[attachmentId]/route";

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

/** Return successive chains per from() call on the same table. */
function tableSequence(...chains: QueryChain[]): () => QueryChain {
  let index = 0;
  return () => chains[Math.min(index++, chains.length - 1)];
}

function installTables(handlers: Record<string, () => QueryChain>) {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      const handler = handlers[table];
      if (!handler) throw new Error(`Unexpected table: ${table}`);
      return handler();
    }),
  });
}

function jsonRequest(url: string, method: string, payload: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
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
};

const baseSectionRow = {
  id: SECTION_ID,
  workspace_id: WORKSPACE_ID,
  opportunity_id: OPPORTUNITY_ID,
  section_key: "community-engagement",
  title: "Community engagement",
  guidance: "Describe engagement. Verify the current call.",
  sort_order: 2,
  source: "catalog",
  suggested_evidence: ["engagement", "kb"],
  ai_drafting_enabled: true,
  status: "not_started",
  final_markdown: null,
  finalized_from_draft_id: null,
  updated_by: null,
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:00:00.000Z",
};

const baseAttachmentRow = {
  id: ATTACHMENT_ID,
  workspace_id: WORKSPACE_ID,
  opportunity_id: OPPORTUNITY_ID,
  attachment_key: "letters-of-support",
  title: "Letters of support",
  guidance: "Verify limits in the current call.",
  required: false,
  status: "missing",
  kb_document_id: null,
  report_artifact_id: null,
  note: null,
  sort_order: 0,
  updated_by: null,
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:00:00.000Z",
};

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
});

function usePursuitKind(kind: "grant" | "proposal") {
  loadOpportunityPursuitContextMock.mockResolvedValue({
    context: {
      pursuitKind: kind,
      solicitationNumber: kind === "proposal" ? "RFP-2026-014" : null,
      submissionFormatNote: null,
      questionsDueAt: null,
      schemaPending: false,
    },
    error: null,
  });
}

describe("POST /api/funding-opportunities/[opportunityId]/application", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/application`;
  const context = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };

  it("returns 401 when unauthenticated", async () => {
    installTables({});
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await initApplication(jsonRequest(url, "POST", {}), context);
    expect(response.status).toBe(401);
  });

  it("returns 404 when the opportunity is invisible to the member", async () => {
    installTables({});
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: null,
      membership: null,
      error: null,
    });

    const response = await initApplication(jsonRequest(url, "POST", {}), context);
    expect(response.status).toBe(404);
  });

  it("returns 403 without write access", async () => {
    installTables({});
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: baseOpportunity,
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });

    const response = await initApplication(jsonRequest(url, "POST", {}), context);
    expect(response.status).toBe(403);
  });

  it("rejects an unknown catalog key with 422 — templates never match by inference", async () => {
    const sectionsChain = makeQuery({ data: [], error: null });
    installTables({ funding_opportunity_application_sections: () => sectionsChain });

    const response = await initApplication(
      jsonRequest(url, "POST", { catalogKey: "Active Transportation Program (ATP)" }),
      context
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("Unknown catalog key");
    expect(sectionsChain.insert).not.toHaveBeenCalled();
  });

  it("returns 409 only when the application is FULLY initialized (sections and catalog attachments)", async () => {
    const atp = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
    const attachmentsChain = makeQuery({
      data: atp.requiredAttachments!.map((template) => ({ attachment_key: template.key })),
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [{ id: SECTION_ID }], error: null }),
      funding_opportunity_attachments: () => attachmentsChain,
    });

    const response = await initApplication(jsonRequest(url, "POST", { catalogKey: "atp" }), context);
    expect(response.status).toBe(409);
    expect(attachmentsChain.insert).not.toHaveBeenCalled();
  });

  it("returns 409 without touching attachments when re-initialized with no catalog key", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [{ id: SECTION_ID }], error: null }),
    });

    const response = await initApplication(jsonRequest(url, "POST", {}), context);
    expect(response.status).toBe(409);
  });

  it("completes an interrupted init: sections exist, catalog attachments missing → seeds them and 200s", async () => {
    // The wedge scenario: a first init seeded sections, then the attachment
    // insert failed. The retry must COMPLETE the init (seed exactly the
    // missing catalog attachments), never answer a permanent 409.
    const atp = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
    const alreadySeededKey = atp.requiredAttachments![0].key;

    const existingSectionsChain = makeQuery({ data: [{ id: SECTION_ID }], error: null });
    const sectionsReloadChain = makeQuery({ data: [baseSectionRow], error: null });
    const attachmentKeysChain = makeQuery({
      data: [{ attachment_key: alreadySeededKey }],
      error: null,
    });
    const attachmentInsertChain = makeQuery({ data: null, error: null });
    const attachmentsReloadChain = makeQuery({ data: [baseAttachmentRow], error: null });

    installTables({
      funding_opportunity_application_sections: tableSequence(existingSectionsChain, sectionsReloadChain),
      funding_opportunity_attachments: tableSequence(
        attachmentKeysChain,
        attachmentInsertChain,
        attachmentsReloadChain
      ),
    });

    const response = await initApplication(jsonRequest(url, "POST", { catalogKey: "atp" }), context);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { sections: unknown[]; attachments: unknown[] };
    expect(body.sections).toHaveLength(1);
    expect(body.attachments).toHaveLength(1);

    // Exactly the MISSING attachments were seeded — the one already present
    // was not duplicated, and every seeded row starts as missing.
    const inserted = attachmentInsertChain.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(atp.requiredAttachments!.length - 1);
    expect(inserted.some((row) => row.attachment_key === alreadySeededKey)).toBe(false);
    inserted.forEach((row) => {
      expect(row.workspace_id).toBe(WORKSPACE_ID);
      expect(row.opportunity_id).toBe(OPPORTUNITY_ID);
      expect(row.status).toBe("missing");
    });
    // No section rows were re-inserted.
    expect(existingSectionsChain.insert).not.toHaveBeenCalled();
    expect(sectionsReloadChain.insert).not.toHaveBeenCalled();
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
    });

    const response = await initApplication(jsonRequest(url, "POST", { catalogKey: "atp" }), context);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("20260727000014_grant_application_assembly");
  });

  it("seeds the full catalog template by explicit key", async () => {
    const atp = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
    const existingChain = makeQuery({ data: [], error: null });
    const sectionInsertChain = makeQuery({ data: [{ id: SECTION_ID }], error: null });
    const attachmentInsertChain = makeQuery({ data: [{ id: ATTACHMENT_ID }], error: null });

    installTables({
      funding_opportunity_application_sections: tableSequence(existingChain, sectionInsertChain),
      funding_opportunity_attachments: () => attachmentInsertChain,
    });

    const response = await initApplication(jsonRequest(url, "POST", { catalogKey: "atp" }), context);
    expect(response.status).toBe(201);

    const insertedSections = sectionInsertChain.insert.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(insertedSections).toHaveLength(atp.applicationSections!.length);
    insertedSections.forEach((row, index) => {
      expect(row.workspace_id).toBe(WORKSPACE_ID);
      expect(row.opportunity_id).toBe(OPPORTUNITY_ID);
      expect(row.source).toBe("catalog");
      expect(row.status).toBe("not_started");
      expect(row.sort_order).toBe(index);
      expect(row.section_key).toBe(atp.applicationSections![index].key);
    });
    // The budget section seeds as never-AI-draftable.
    const budgetRow = insertedSections.find((row) => row.section_key === "budget-narrative");
    expect(budgetRow?.ai_drafting_enabled).toBe(false);

    const insertedAttachments = attachmentInsertChain.insert.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(insertedAttachments).toHaveLength(atp.requiredAttachments!.length);
    expect(insertedAttachments.every((row) => row.status === "missing")).toBe(true);
  });

  it("initializes an empty custom scaffold when no catalog key is given", async () => {
    const existingChain = makeQuery({ data: [], error: null });
    installTables({ funding_opportunity_application_sections: () => existingChain });

    const response = await initApplication(jsonRequest(url, "POST", {}), context);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sections: [], attachments: [] });
    expect(existingChain.insert).not.toHaveBeenCalled();
  });

  it("seeds a proposal pursuit from the proposal response template", async () => {
    usePursuitKind("proposal");
    const existingChain = makeQuery({ data: [], error: null });
    const sectionInsertChain = makeQuery({ data: [{ id: SECTION_ID }], error: null });
    installTables({
      funding_opportunity_application_sections: tableSequence(existingChain, sectionInsertChain),
    });

    const response = await initApplication(jsonRequest(url, "POST", {}), context);
    expect(response.status).toBe(201);

    const inserted = sectionInsertChain.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(inserted.map((row) => row.section_key)).toEqual([
      "approach",
      "team_qualifications",
      "past_performance",
      "schedule",
      "fee_placeholder",
    ]);
    // The fee section seeds never-AI-draftable; team qualifications ground on
    // uploaded documents only — credentials never come from model memory.
    const feeRow = inserted.find((row) => row.section_key === "fee_placeholder");
    expect(feeRow?.ai_drafting_enabled).toBe(false);
    const teamRow = inserted.find((row) => row.section_key === "team_qualifications");
    expect(teamRow?.suggested_evidence).toEqual(["kb"]);
    inserted.forEach((row) => {
      expect(row.source).toBe("catalog");
      expect(row.status).toBe("not_started");
    });
  });

  it("refuses a catalog key on a proposal pursuit — proposals seed from the proposal template", async () => {
    usePursuitKind("proposal");
    installTables({});

    const response = await initApplication(jsonRequest(url, "POST", { catalogKey: "atp" }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("proposal");
  });
});

describe("GET /api/funding-opportunities/[opportunityId]/application", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/application`;
  const context = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };

  it("discloses a pending schema instead of presenting an empty application", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({
          data: null,
          error: { message: 'relation "funding_opportunity_application_sections" does not exist' },
        }),
      funding_opportunity_attachments: () =>
        makeQuery({
          data: null,
          error: { message: 'relation "funding_opportunity_application_sections" does not exist' },
        }),
    });

    const response = await getApplication(new NextRequest(url), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schemaPending).toBe(true);
    expect(body.error).toContain("20260727000014_grant_application_assembly");
  });

  it("returns sections, attachments, latest drafts, and attach-picker sources", async () => {
    const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const OLDER_DRAFT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const draftsChain = makeQuery({
      // Newest-first: the FIRST row per section wins as the working draft.
      data: [
        { id: DRAFT_ID, section_id: SECTION_ID, draft_markdown: "Newest.", created_at: "2026-07-27T02:00:00.000Z" },
        { id: OLDER_DRAFT_ID, section_id: SECTION_ID, draft_markdown: "Older.", created_at: "2026-07-27T01:00:00.000Z" },
      ],
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [baseSectionRow], error: null }),
      funding_opportunity_attachments: () => makeQuery({ data: [baseAttachmentRow], error: null }),
      funding_opportunity_section_drafts: () => draftsChain,
      kb_documents: () =>
        makeQuery({ data: [{ id: KB_DOCUMENT_ID, title: "Adopted ATP plan" }], error: null }),
      reports: () => makeQuery({ data: [{ id: "report-1", title: "Corridor packet" }], error: null }),
      report_artifacts: () =>
        makeQuery({
          data: [
            {
              id: REPORT_ARTIFACT_ID,
              report_id: "report-1",
              artifact_kind: "pdf",
              generated_at: "2026-07-20T00:00:00.000Z",
            },
          ],
          error: null,
        }),
    });

    const response = await getApplication(new NextRequest(url), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sections).toHaveLength(1);
    expect(body.attachments).toHaveLength(1);
    expect(body.schemaPending).toBe(false);
    expect(body.latestDraftsBySectionId[SECTION_ID]).toMatchObject({ id: DRAFT_ID });
    expect(body.latestDraftsUnavailable).toBe(false);
    expect(body.draftsWindowTruncated).toBe(false);
    // The window is SCOPED to the returned sections' ids with a generous
    // limit — a flat newest-across-the-opportunity window could hide a
    // section's latest draft behind other sections' churn.
    expect(draftsChain.in).toHaveBeenCalledWith("section_id", [SECTION_ID]);
    expect(draftsChain.limit).toHaveBeenCalledWith(1000);
    expect(body.kbDocumentOptions).toEqual([{ id: KB_DOCUMENT_ID, title: "Adopted ATP plan" }]);
    expect(body.reportArtifactOptions).toEqual([
      {
        id: REPORT_ARTIFACT_ID,
        reportTitle: "Corridor packet",
        artifactKind: "pdf",
        generatedAt: "2026-07-20T00:00:00.000Z",
      },
    ]);
    expect(body.attachSourcesDegraded).toBe(false);
  });

  it("discloses a filled drafts window as truncated instead of presenting it as complete", async () => {
    // Exactly the window limit came back: a section's latest draft could lie
    // beyond it, so the response says so rather than presenting the map as
    // authoritative.
    const windowFull = Array.from({ length: 1000 }, (_, index) => ({
      id: `draft-${index}`,
      section_id: SECTION_ID,
      draft_markdown: `Draft ${index}.`,
      created_at: new Date(Date.UTC(2026, 6, 27, 0, 0, index)).toISOString(),
    }));
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [baseSectionRow], error: null }),
      funding_opportunity_attachments: () => makeQuery({ data: [baseAttachmentRow], error: null }),
      funding_opportunity_section_drafts: () => makeQuery({ data: windowFull, error: null }),
      kb_documents: () => makeQuery({ data: [], error: null }),
      reports: () => makeQuery({ data: [], error: null }),
    });

    const response = await getApplication(new NextRequest(url), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.draftsWindowTruncated).toBe(true);
    expect(body.latestDraftsUnavailable).toBe(false);
    expect(body.latestDraftsBySectionId[SECTION_ID]).toMatchObject({ id: "draft-0" });
  });

  it("discloses degraded attach sources and unavailable draft history instead of faking emptiness", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [baseSectionRow], error: null }),
      funding_opportunity_attachments: () => makeQuery({ data: [baseAttachmentRow], error: null }),
      funding_opportunity_section_drafts: () =>
        makeQuery({ data: null, error: { message: "draft read failed" } }),
      kb_documents: () => makeQuery({ data: null, error: { message: "kb read failed" } }),
      reports: () => makeQuery({ data: [], error: null }),
    });

    const response = await getApplication(new NextRequest(url), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.latestDraftsUnavailable).toBe(true);
    expect(body.latestDraftsBySectionId).toEqual({});
    expect(body.attachSourcesDegraded).toBe(true);
    expect(body.kbDocumentOptions).toEqual([]);
  });
});

describe("PATCH /api/funding-opportunities/[opportunityId]/application (reorder)", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/application`;
  const context = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };
  const SECOND_SECTION_ID = "44444444-4444-4444-8444-444444444444";

  it("rejects a partial order with 422", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: [{ id: SECTION_ID }, { id: SECOND_SECTION_ID }], error: null }),
    });

    const response = await reorderApplication(
      jsonRequest(url, "PATCH", { sectionOrder: [SECTION_ID] }),
      context
    );
    expect(response.status).toBe(422);
  });

  it("writes sequential sort orders for a complete permutation", async () => {
    const listChain = makeQuery({
      data: [{ id: SECTION_ID }, { id: SECOND_SECTION_ID }],
      error: null,
    });
    const updateFirst = makeQuery({ data: null, error: null });
    const updateSecond = makeQuery({ data: null, error: null });
    const reloadChain = makeQuery({ data: [baseSectionRow], error: null });

    installTables({
      funding_opportunity_application_sections: tableSequence(
        listChain,
        updateFirst,
        updateSecond,
        reloadChain
      ),
    });

    const response = await reorderApplication(
      jsonRequest(url, "PATCH", { sectionOrder: [SECOND_SECTION_ID, SECTION_ID] }),
      context
    );

    expect(response.status).toBe(200);
    expect(updateFirst.update.mock.calls[0][0]).toMatchObject({ sort_order: 0, updated_by: USER_ID });
    expect(updateFirst.eq).toHaveBeenCalledWith("id", SECOND_SECTION_ID);
    expect(updateSecond.update.mock.calls[0][0]).toMatchObject({ sort_order: 1 });
    expect(updateSecond.eq).toHaveBeenCalledWith("id", SECTION_ID);

    // A reorder is a TOUCH, never a finalization: it stamps updated_* on
    // every row, so it must not write the finalizer-event columns (or the
    // approved text) — that is exactly how exports once misattributed the
    // finalizer.
    for (const chain of [updateFirst, updateSecond]) {
      const payload = chain.update.mock.calls[0][0] as Record<string, unknown>;
      expect("finalized_by" in payload).toBe(false);
      expect("finalized_at" in payload).toBe(false);
      expect("final_markdown" in payload).toBe(false);
    }
  });
});

describe("POST /api/funding-opportunities/[opportunityId]/sections", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/sections`;
  const context = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };

  it("creates a custom section appended after the last, with a slugged key", async () => {
    const lastChain = makeQuery({ data: [{ sort_order: 4 }], error: null });
    const insertChain = makeQuery({
      data: { ...baseSectionRow, source: "custom", section_key: "local-match-story" },
      error: null,
    });

    installTables({
      funding_opportunity_application_sections: tableSequence(lastChain, insertChain),
    });

    const response = await createSection(
      jsonRequest(url, "POST", { title: "Local Match Story!" }),
      context
    );

    expect(response.status).toBe(201);
    const inserted = insertChain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      workspace_id: WORKSPACE_ID,
      opportunity_id: OPPORTUNITY_ID,
      section_key: "local-match-story",
      source: "custom",
      status: "not_started",
      sort_order: 5,
      ai_drafting_enabled: true,
      suggested_evidence: [],
    });
  });

  it("answers 409 when the section key is already taken", async () => {
    const lastChain = makeQuery({ data: [], error: null });
    const insertChain = makeQuery({
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(lastChain, insertChain),
    });

    const response = await createSection(
      jsonRequest(url, "POST", { title: "Need", sectionKey: "need-and-safety" }),
      context
    );
    expect(response.status).toBe(409);
  });
});

describe("PATCH /api/funding-opportunities/[opportunityId]/sections/[sectionId]", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/sections/${SECTION_ID}`;
  const context = {
    params: Promise.resolve({ opportunityId: OPPORTUNITY_ID, sectionId: SECTION_ID }),
  };

  it("refuses a status regression the machine forbids", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: { ...baseSectionRow, status: "drafting" }, error: null }),
    });

    const response = await patchSection(jsonRequest(url, "PATCH", { status: "not_started" }), context);
    expect(response.status).toBe(422);
  });

  it("never lets a catalog never-AI section become draftable again", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({
          data: {
            ...baseSectionRow,
            section_key: "budget-narrative",
            ai_drafting_enabled: false,
          },
          error: null,
        }),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { aiDraftingEnabled: true }),
      context
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("never AI-drafted");
  });

  it("updates title and walks drafting → operator_review", async () => {
    const loadChain = makeQuery({ data: { ...baseSectionRow, status: "drafting" }, error: null });
    const updateChain = makeQuery({
      data: { ...baseSectionRow, status: "operator_review", title: "Engagement summary" },
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { title: "Engagement summary", status: "operator_review" }),
      context
    );

    expect(response.status).toBe(200);
    expect(updateChain.update.mock.calls[0][0]).toMatchObject({
      title: "Engagement summary",
      status: "operator_review",
      updated_by: USER_ID,
    });
  });

  it("reports an update that matched no rows as a refused write, not a broken one", async () => {
    // The section row was read through the caller's own client a moment
    // earlier, so an UPDATE that touches nothing is the database refusing what
    // the application allowed — PGRST116 must not read as "Failed to update".
    const loadChain = makeQuery({ data: { ...baseSectionRow, status: "drafting" }, error: null });
    const updateChain = makeQuery({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { title: "Engagement summary" }),
      context
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toBe("The section was not saved");
    expect(payload.details).toContain("row-level security");
    expect(mockAudit.error).toHaveBeenCalledWith(
      "section_update_matched_no_rows",
      expect.objectContaining({ sectionId: SECTION_ID, opportunityId: OPPORTUNITY_ID })
    );
    expect(mockAudit.error).not.toHaveBeenCalledWith("section_update_failed", expect.anything());
  });
});

describe("DELETE /api/funding-opportunities/[opportunityId]/sections/[sectionId]", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/sections/${SECTION_ID}`;
  const context = {
    params: Promise.resolve({ opportunityId: OPPORTUNITY_ID, sectionId: SECTION_ID }),
  };

  it("refuses to delete a catalog-seeded section", async () => {
    installTables({
      funding_opportunity_application_sections: () => makeQuery({ data: baseSectionRow, error: null }),
    });

    const response = await deleteSection(new NextRequest(url, { method: "DELETE" }), context);
    expect(response.status).toBe(422);
  });

  it("deletes a custom section", async () => {
    const loadChain = makeQuery({ data: { ...baseSectionRow, source: "custom" }, error: null });
    const deleteChain = makeQuery({ data: null, error: null });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, deleteChain),
    });

    const response = await deleteSection(new NextRequest(url, { method: "DELETE" }), context);
    expect(response.status).toBe(200);
    expect(deleteChain.delete).toHaveBeenCalled();
  });
});

describe("POST /api/funding-opportunities/[opportunityId]/attachments", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/attachments`;
  const context = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };

  it("creates a custom checklist item", async () => {
    const lastChain = makeQuery({ data: [], error: null });
    const insertChain = makeQuery({ data: baseAttachmentRow, error: null });
    installTables({
      funding_opportunity_attachments: tableSequence(lastChain, insertChain),
    });

    const response = await createAttachment(
      jsonRequest(url, "POST", { title: "Site plan sketch", required: true }),
      context
    );

    expect(response.status).toBe(201);
    expect(insertChain.insert.mock.calls[0][0]).toMatchObject({
      attachment_key: "site-plan-sketch",
      required: true,
      status: "missing",
      sort_order: 0,
    });
  });
});

describe("PATCH /api/funding-opportunities/[opportunityId]/attachments/[attachmentId]", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/attachments/${ATTACHMENT_ID}`;
  const context = {
    params: Promise.resolve({ opportunityId: OPPORTUNITY_ID, attachmentId: ATTACHMENT_ID }),
  };

  it("moves the checklist status", async () => {
    const loadChain = makeQuery({ data: baseAttachmentRow, error: null });
    const updateChain = makeQuery({
      data: { ...baseAttachmentRow, status: "in_progress" },
      error: null,
    });
    installTables({
      funding_opportunity_attachments: tableSequence(loadChain, updateChain),
    });

    const response = await patchAttachment(jsonRequest(url, "PATCH", { status: "in_progress" }), context);
    expect(response.status).toBe(200);
    expect(updateChain.update.mock.calls[0][0]).toMatchObject({ status: "in_progress" });
  });

  it("attaches a workspace Knowledge Base document and auto-marks it attached", async () => {
    const loadChain = makeQuery({ data: baseAttachmentRow, error: null });
    const updateChain = makeQuery({
      data: { ...baseAttachmentRow, status: "attached", kb_document_id: KB_DOCUMENT_ID },
      error: null,
    });
    installTables({
      funding_opportunity_attachments: tableSequence(loadChain, updateChain),
      kb_documents: () =>
        makeQuery({ data: { id: KB_DOCUMENT_ID, workspace_id: WORKSPACE_ID }, error: null }),
    });

    const response = await patchAttachment(
      jsonRequest(url, "PATCH", { kbDocumentId: KB_DOCUMENT_ID }),
      context
    );

    expect(response.status).toBe(200);
    expect(updateChain.update.mock.calls[0][0]).toMatchObject({
      kb_document_id: KB_DOCUMENT_ID,
      status: "attached",
    });
  });

  it("rejects a Knowledge Base document from another workspace", async () => {
    const loadChain = makeQuery({ data: baseAttachmentRow, error: null });
    const updateChain = makeQuery({ data: baseAttachmentRow, error: null });
    installTables({
      funding_opportunity_attachments: tableSequence(loadChain, updateChain),
      kb_documents: () =>
        makeQuery({ data: { id: KB_DOCUMENT_ID, workspace_id: OTHER_WORKSPACE_ID }, error: null }),
    });

    const response = await patchAttachment(
      jsonRequest(url, "PATCH", { kbDocumentId: KB_DOCUMENT_ID }),
      context
    );

    expect(response.status).toBe(422);
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it("reports an update that matched no rows as a refused write, not a broken one", async () => {
    // The checklist item was read through the caller's own client a moment
    // earlier, so an UPDATE that touches nothing is the database refusing what
    // the application allowed — PGRST116 must not read as "Failed to update".
    const loadChain = makeQuery({ data: baseAttachmentRow, error: null });
    const updateChain = makeQuery({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });
    installTables({
      funding_opportunity_attachments: tableSequence(loadChain, updateChain),
    });

    const response = await patchAttachment(jsonRequest(url, "PATCH", { status: "in_progress" }), context);

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toBe("The attachment was not saved");
    expect(payload.details).toContain("row-level security");
    expect(mockAudit.error).toHaveBeenCalledWith(
      "attachment_update_matched_no_rows",
      expect.objectContaining({ attachmentId: ATTACHMENT_ID, opportunityId: OPPORTUNITY_ID })
    );
    expect(mockAudit.error).not.toHaveBeenCalledWith("attachment_update_failed", expect.anything());
  });

  it("attaches a report artifact after walking artifact → report → workspace", async () => {
    const loadChain = makeQuery({ data: baseAttachmentRow, error: null });
    const updateChain = makeQuery({
      data: { ...baseAttachmentRow, status: "attached", report_artifact_id: REPORT_ARTIFACT_ID },
      error: null,
    });
    installTables({
      funding_opportunity_attachments: tableSequence(loadChain, updateChain),
      report_artifacts: () =>
        makeQuery({ data: { id: REPORT_ARTIFACT_ID, report_id: "report-1" }, error: null }),
      reports: () => makeQuery({ data: { id: "report-1", workspace_id: WORKSPACE_ID }, error: null }),
    });

    const response = await patchAttachment(
      jsonRequest(url, "PATCH", { reportArtifactId: REPORT_ARTIFACT_ID }),
      context
    );

    expect(response.status).toBe(200);
    expect(updateChain.update.mock.calls[0][0]).toMatchObject({
      report_artifact_id: REPORT_ARTIFACT_ID,
      status: "attached",
    });
  });

  it("rejects a report artifact whose report lives in another workspace", async () => {
    const loadChain = makeQuery({ data: baseAttachmentRow, error: null });
    const updateChain = makeQuery({ data: baseAttachmentRow, error: null });
    installTables({
      funding_opportunity_attachments: tableSequence(loadChain, updateChain),
      report_artifacts: () =>
        makeQuery({ data: { id: REPORT_ARTIFACT_ID, report_id: "report-1" }, error: null }),
      reports: () =>
        makeQuery({ data: { id: "report-1", workspace_id: OTHER_WORKSPACE_ID }, error: null }),
    });

    const response = await patchAttachment(
      jsonRequest(url, "PATCH", { reportArtifactId: REPORT_ARTIFACT_ID }),
      context
    );

    expect(response.status).toBe(422);
    expect(updateChain.update).not.toHaveBeenCalled();
  });
});

describe("PATCH sections/[sectionId] — finalization gates", () => {
  const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/sections/${SECTION_ID}`;
  const context = {
    params: Promise.resolve({ opportunityId: OPPORTUNITY_ID, sectionId: SECTION_ID }),
  };
  const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  const exportableGrounding = {
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
    ],
    dropped_sentences: [],
    cited_fact_ids: ["fact_1"],
    unknown_fact_ids: [],
    grounded_sentence_count: 1,
    total_sentence_count: 1,
    is_fully_grounded: true,
    faithfulness_checked: true,
  };

  const flaggedGrounding = {
    ...exportableGrounding,
    sentences: [
      ...exportableGrounding.sentences,
      {
        text: "An uncited flourish about outcomes.",
        cited_fact_ids: [],
        is_grounded: false,
        unknown_fact_ids: [],
        unfaithful_claims: [],
      },
    ],
    grounded_sentence_count: 1,
    total_sentence_count: 2,
    is_fully_grounded: false,
  };

  it("commits an UNEDITED draft only when its stored grounding is exportable", async () => {
    const loadChain = makeQuery({ data: { ...baseSectionRow, status: "operator_review" }, error: null });
    const updateChain = makeQuery({
      data: { ...baseSectionRow, status: "final" },
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
      funding_opportunity_section_drafts: () =>
        makeQuery({
          data: {
            id: DRAFT_ID,
            section_id: SECTION_ID,
            draft_markdown: "The award is documented. [fact:fact_1]",
            grounding_json: exportableGrounding,
          },
          error: null,
        }),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { status: "final", finalizedFromDraftId: DRAFT_ID }),
      context
    );

    expect(response.status).toBe(200);
    expect(updateChain.update.mock.calls[0][0]).toMatchObject({
      status: "final",
      final_markdown: "The award is documented. [fact:fact_1]",
      finalized_from_draft_id: DRAFT_ID,
      // The finalization EVENT is stamped in its own columns — updated_* is
      // touch-latest and cannot carry it.
      finalized_by: USER_ID,
    });
    const payload = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.finalized_at).toBe(payload.updated_at);
  });

  it("refuses an unedited draft with flagged sentences and returns them for review", async () => {
    const loadChain = makeQuery({ data: { ...baseSectionRow, status: "operator_review" }, error: null });
    const updateChain = makeQuery({ data: baseSectionRow, error: null });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
      funding_opportunity_section_drafts: () =>
        makeQuery({
          data: {
            id: DRAFT_ID,
            section_id: SECTION_ID,
            draft_markdown: "Mixed draft.",
            grounding_json: flaggedGrounding,
          },
          error: null,
        }),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { status: "final", finalizedFromDraftId: DRAFT_ID }),
      context
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.flaggedSentences).toHaveLength(1);
    expect(body.flaggedSentences[0]).toMatchObject({
      text: "An uncited flourish about outcomes.",
      reason: "missing_citation",
    });
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it("refuses a legacy citation-only draft (faithfulness never checked) unedited", async () => {
    const loadChain = makeQuery({ data: { ...baseSectionRow, status: "operator_review" }, error: null });
    const updateChain = makeQuery({ data: baseSectionRow, error: null });
    const legacyGrounding = { ...exportableGrounding, faithfulness_checked: undefined };
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
      funding_opportunity_section_drafts: () =>
        makeQuery({
          data: {
            id: DRAFT_ID,
            section_id: SECTION_ID,
            draft_markdown: "Legacy draft.",
            grounding_json: legacyGrounding,
          },
          error: null,
        }),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { status: "final", finalizedFromDraftId: DRAFT_ID }),
      context
    );

    expect(response.status).toBe(422);
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it("accepts operator-edited final text without consulting any stored draft", async () => {
    const loadChain = makeQuery({ data: { ...baseSectionRow, status: "drafting" }, error: null });
    const updateChain = makeQuery({ data: { ...baseSectionRow, status: "final" }, error: null });
    // No drafts handler installed: touching the drafts table would throw,
    // proving the operator's own text needs no stored-draft verdict.
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { status: "final", finalMarkdown: "My reviewed and edited text." }),
      context
    );

    expect(response.status).toBe(200);
    expect(updateChain.update.mock.calls[0][0]).toMatchObject({
      status: "final",
      final_markdown: "My reviewed and edited text.",
      finalized_from_draft_id: null,
      finalized_by: USER_ID,
    });
    const payload = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof payload.finalized_at).toBe("string");
    expect(payload.finalized_at).toBe(payload.updated_at);
  });

  it("does not restamp the finalizer on an idempotent status:'final' no-op", async () => {
    // A PATCH that re-asserts 'final' without committing new text is a touch,
    // not a finalization — restamping it would misattribute the finalizer to
    // whoever sent the no-op.
    const loadChain = makeQuery({
      data: { ...baseSectionRow, status: "final", final_markdown: "Approved text." },
      error: null,
    });
    const updateChain = makeQuery({
      data: { ...baseSectionRow, status: "final", final_markdown: "Approved text." },
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
    });

    const response = await patchSection(jsonRequest(url, "PATCH", { status: "final" }), context);

    expect(response.status).toBe(200);
    const payload = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect("finalized_by" in payload).toBe(false);
    expect("finalized_at" in payload).toBe(false);
  });

  it("answers 503 naming the finalizer migration when the stamp hits a pre-migration database", async () => {
    // Provenance depends on the stamp, so omitting it when the column is
    // missing is not an acceptable degradation — the finalize refuses and
    // names the migration instead.
    const loadChain = makeQuery({ data: { ...baseSectionRow, status: "drafting" }, error: null });
    const updateChain = makeQuery({
      data: null,
      error: {
        message:
          "Could not find the 'finalized_by' column of 'funding_opportunity_application_sections' in the schema cache",
      },
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { status: "final", finalMarkdown: "My reviewed text." }),
      context
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("20260727000016_application_section_finalizer");
  });

  it("rejects finalMarkdown outside a finalization", async () => {
    installTables({
      funding_opportunity_application_sections: () => makeQuery({ data: baseSectionRow, error: null }),
    });

    const response = await patchSection(
      jsonRequest(url, "PATCH", { finalMarkdown: "Sneaky rewrite." }),
      context
    );
    expect(response.status).toBe(400);
  });

  it("has nothing to finalize when no text exists", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({ data: { ...baseSectionRow, final_markdown: null }, error: null }),
    });

    const response = await patchSection(jsonRequest(url, "PATCH", { status: "final" }), context);
    expect(response.status).toBe(422);
  });

  it("reopens a finalized section to operator review, keeping the text", async () => {
    const loadChain = makeQuery({
      data: { ...baseSectionRow, status: "final", final_markdown: "Approved text." },
      error: null,
    });
    const updateChain = makeQuery({
      data: { ...baseSectionRow, status: "operator_review", final_markdown: "Approved text." },
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(loadChain, updateChain),
    });

    const response = await patchSection(jsonRequest(url, "PATCH", { status: "operator_review" }), context);

    expect(response.status).toBe(200);
    const updatePayload = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe("operator_review");
    expect(updatePayload.final_markdown).toBeUndefined();
    // Reverting clears the finalizer stamp: the old finalization no longer
    // describes the section, and the next finalize will stamp its own event.
    expect(updatePayload.finalized_by).toBeNull();
    expect(updatePayload.finalized_at).toBeNull();
  });
});
