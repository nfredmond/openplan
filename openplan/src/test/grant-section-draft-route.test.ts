import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const generateTextMock = vi.fn();
const anthropicMock = vi.fn((..._args: unknown[]) => "mock-anthropic-model");
const checkAiUsageRateLimitMock = vi.fn();
const recordAiUsageEventMock = vi.fn();
const loadOpportunityPursuitContextMock = vi.fn();

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (...args: unknown[]) => anthropicMock(...args),
}));

vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  checkAiUsageRateLimit: (...args: unknown[]) => checkAiUsageRateLimitMock(...args),
  recordAiUsageEvent: (...args: unknown[]) => recordAiUsageEventMock(...args),
}));

vi.mock("@/lib/grants/pursuit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/grants/pursuit")>("@/lib/grants/pursuit");
  return {
    ...actual,
    loadOpportunityPursuitContext: (...args: unknown[]) => loadOpportunityPursuitContextMock(...args),
  };
});

import { POST as postSectionDraft } from "@/app/api/funding-opportunities/[opportunityId]/sections/[sectionId]/draft/route";

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

const url = `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/sections/${SECTION_ID}/draft`;

function jsonRequest(payload: unknown = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function routeContext() {
  return { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID, sectionId: SECTION_ID }) };
}

const baseOpportunity = {
  id: OPPORTUNITY_ID,
  workspace_id: WORKSPACE_ID,
  program_id: null,
  project_id: null,
  title: "2027 ATP countywide active transportation call",
  opportunity_status: "open",
  decision_state: "pursue",
  agency_name: "CTC / Caltrans",
  expected_award_amount: 750000,
  opens_at: null,
  closes_at: null,
  decision_due_at: null,
  fit_notes: "Strong safe-routes fit.",
  readiness_notes: null,
  decision_rationale: null,
  decided_at: null,
  summary: null,
  created_at: "2026-04-10T16:30:00.000Z",
  updated_at: "2026-04-10T17:00:00.000Z",
};

const baseSectionRow = {
  id: SECTION_ID,
  workspace_id: WORKSPACE_ID,
  opportunity_id: OPPORTUNITY_ID,
  section_key: "community-engagement",
  title: "Community engagement",
  guidance: "Describe how the community shaped the project. Verify the current cycle's expectations.",
  sort_order: 3,
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

const storedDraft = {
  id: DRAFT_ID,
  opportunity_id: OPPORTUNITY_ID,
  section_id: SECTION_ID,
  draft_markdown: "Drafted section prose.",
  model: "claude-opus-4-8",
  grounding_json: {},
  grounded_sentence_count: 0,
  total_sentence_count: 1,
  revision_of: null,
  revision_instructions: null,
  created_at: "2026-07-27T00:00:00.000Z",
};

describe("/api/funding-opportunities/[opportunityId]/sections/[sectionId]/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("OPENPLAN_GRANTS_AI_MODEL", "");

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    recordAiUsageEventMock.mockResolvedValue(undefined);
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
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });

    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: baseOpportunity,
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    generateTextMock.mockResolvedValue({
      text: "Drafted section prose.",
      usage: { inputTokens: 900, outputTokens: 400, totalTokens: 1300 },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when unauthenticated", async () => {
    installTables({});
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postSectionDraft(jsonRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the section does not belong to the opportunity", async () => {
    installTables({
      funding_opportunity_application_sections: () => makeQuery({ data: null, error: null }),
    });

    const response = await postSectionDraft(jsonRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("refuses a never-AI section with a typed 422 — the fee/budget rule has no override", async () => {
    installTables({
      funding_opportunity_application_sections: () =>
        makeQuery({
          data: { ...baseSectionRow, section_key: "budget-narrative", ai_drafting_enabled: false },
          error: null,
        }),
    });

    const response = await postSectionDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("section_not_ai_draftable");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });

  it("returns 429 without a model call when the workspace AI allowance is exhausted", async () => {
    installTables({});
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 300 });

    const response = await postSectionDraft(jsonRequest(), routeContext());
    expect(response.status).toBe(429);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });

  it("rejects overlong revision instructions", async () => {
    installTables({});
    const response = await postSectionDraft(
      jsonRequest({ instructions: "x".repeat(1001) }),
      routeContext()
    );
    expect(response.status).toBe(400);
  });

  it("drafts a section with scoped facts, guidance, and emphasis, then meters and stores", async () => {
    const sectionLoadChain = makeQuery({ data: baseSectionRow, error: null });
    const statusBumpChain = makeQuery({ data: null, error: null });
    const draftInsertChain = makeQuery({ data: storedDraft, error: null });

    installTables({
      funding_opportunity_application_sections: tableSequence(sectionLoadChain, statusBumpChain),
      funding_opportunity_section_drafts: () => draftInsertChain,
    });

    const response = await postSectionDraft(jsonRequest(), routeContext());
    expect(response.status).toBe(201);

    const generationArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
    expect(generationArgs.prompt).toContain('Write the "Community engagement" application section');
    expect(generationArgs.prompt).toContain("Describe how the community shaped the project.");
    expect(generationArgs.prompt).toContain("EVIDENCE EMPHASIS");
    expect(generationArgs.prompt).toContain("community-engagement synthesis");
    // Identity anchors survive scoping…
    expect(generationArgs.prompt).toContain("2027 ATP countywide active transportation call");
    // …but out-of-scope evidence families are not citable for this section.
    expect(generationArgs.prompt).not.toContain("Funding-source fit notes on record:");
    expect(generationArgs.prompt).not.toContain("The expected award amount recorded");

    const inserted = draftInsertChain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      workspace_id: WORKSPACE_ID,
      opportunity_id: OPPORTUNITY_ID,
      section_id: SECTION_ID,
      draft_markdown: "Drafted section prose.",
      model: "claude-opus-4-8",
      revision_of: null,
      revision_instructions: null,
      created_by: USER_ID,
    });

    // A first draft moves the section into 'drafting'.
    expect(statusBumpChain.update.mock.calls[0][0]).toMatchObject({ status: "drafting" });

    expect(recordAiUsageEventMock).toHaveBeenCalledTimes(1);
    expect(recordAiUsageEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        bucketKey: "grant_narrative_draft",
        eventKey: "grant_section_draft",
      })
    );
  });

  it("rejects a revision base that is not a stored draft of this section", async () => {
    installTables({
      funding_opportunity_application_sections: () => makeQuery({ data: baseSectionRow, error: null }),
      funding_opportunity_section_drafts: () => makeQuery({ data: null, error: null }),
    });

    const response = await postSectionDraft(
      jsonRequest({ revisionOfDraftId: DRAFT_ID }),
      routeContext()
    );

    expect(response.status).toBe(422);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("revises with the prior draft as style input while REBUILDING facts fresh from live evidence", async () => {
    // The section scopes nothing, so the funding facts (expected award) are
    // citable. First call: award is $750,000.
    const fullScopeSection = { ...baseSectionRow, suggested_evidence: [] };

    installTables({
      funding_opportunity_application_sections: tableSequence(
        makeQuery({ data: fullScopeSection, error: null }),
        makeQuery({ data: null, error: null })
      ),
      funding_opportunity_section_drafts: () => makeQuery({ data: storedDraft, error: null }),
    });

    const firstResponse = await postSectionDraft(jsonRequest(), routeContext());
    expect(firstResponse.status).toBe(201);
    const firstPrompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(firstPrompt).toContain("$750,000");

    // The workspace evidence changes: the recorded award becomes $900,000.
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: { ...baseOpportunity, expected_award_amount: 900000 },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    const priorDraftChain = makeQuery({
      data: { id: DRAFT_ID, section_id: SECTION_ID, draft_markdown: "Earlier draft prose." },
      error: null,
    });
    const revisionInsertChain = makeQuery({
      data: { ...storedDraft, revision_of: DRAFT_ID, revision_instructions: "Tighten the opening." },
      error: null,
    });
    installTables({
      funding_opportunity_application_sections: tableSequence(
        makeQuery({ data: fullScopeSection, error: null }),
        makeQuery({ data: null, error: null })
      ),
      funding_opportunity_section_drafts: tableSequence(priorDraftChain, revisionInsertChain),
    });

    const revisionResponse = await postSectionDraft(
      jsonRequest({ revisionOfDraftId: DRAFT_ID, instructions: "Tighten the opening." }),
      routeContext()
    );
    expect(revisionResponse.status).toBe(201);

    const revisionPrompt = (generateTextMock.mock.calls[1][0] as { prompt: string }).prompt;
    // The prior draft rides along as style input with the instructions…
    expect(revisionPrompt).toContain("PRIOR DRAFT");
    expect(revisionPrompt).toContain("Earlier draft prose.");
    expect(revisionPrompt).toContain("Tighten the opening.");
    // …but the citable facts are rebuilt from CURRENT evidence: the new award
    // figure is citable and the stale one has vanished — a revision cannot
    // smuggle an outdated claim through its fact list.
    expect(revisionPrompt).toContain("$900,000");
    expect(revisionPrompt).not.toContain("$750,000");

    const inserted = revisionInsertChain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      revision_of: DRAFT_ID,
      revision_instructions: "Tighten the opening.",
      section_id: SECTION_ID,
    });
  });

  it("returns 502 without persisting or metering when generation fails", async () => {
    const draftInsertChain = makeQuery({ data: storedDraft, error: null });
    installTables({
      funding_opportunity_application_sections: () => makeQuery({ data: baseSectionRow, error: null }),
      funding_opportunity_section_drafts: () => draftInsertChain,
    });
    generateTextMock.mockRejectedValue(new Error("model unavailable"));

    const response = await postSectionDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(502);
    expect(draftInsertChain.insert).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });
});
