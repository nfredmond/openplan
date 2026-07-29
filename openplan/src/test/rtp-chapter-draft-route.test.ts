import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const generateTextMock = vi.fn();
const anthropicMock = vi.fn((..._args: unknown[]) => "mock-anthropic-model");
const checkAiUsageRateLimitMock = vi.fn();
const recordAiUsageEventMock = vi.fn();
const loadCountyRunModelingEvidenceMock = vi.fn();
const retrieveKnowledgeBaseExcerptsMock = vi.fn();

const CYCLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const draftSingleMock = vi.fn();
const draftSelectMock = vi.fn(() => ({ single: draftSingleMock }));
const draftInsertMock = vi.fn(() => ({ select: draftSelectMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (...args: unknown[]) => anthropicMock(...args),
  createAnthropic: () => (...args: unknown[]) => anthropicMock(...args),
}));

vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  checkAiUsageRateLimit: (...args: unknown[]) => checkAiUsageRateLimitMock(...args),
  recordAiUsageEvent: (...args: unknown[]) => recordAiUsageEventMock(...args),
}));

vi.mock("@/lib/models/evidence-backbone", () => ({
  loadCountyRunModelingEvidence: (...args: unknown[]) => loadCountyRunModelingEvidenceMock(...args),
}));

vi.mock("@/lib/knowledge-base/retrieval", () => ({
  retrieveKnowledgeBaseExcerpts: (...args: unknown[]) => retrieveKnowledgeBaseExcerptsMock(...args),
  excerptPageLabel: (pageFrom: number | null, pageTo: number | null) =>
    pageFrom == null ? "" : pageTo == null || pageTo === pageFrom ? `p. ${pageFrom}` : `pp. ${pageFrom}-${pageTo}`,
}));

import { POST as postChapterDraft, PATCH as patchChapterDraft } from "@/app/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/draft/route";

function jsonRequest(method: string, payload: unknown = {}) {
  return new NextRequest(
    `http://localhost/api/rtp-cycles/${CYCLE_ID}/chapters/${CHAPTER_ID}/draft`,
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

function routeContext() {
  return { params: Promise.resolve({ rtpCycleId: CYCLE_ID, chapterId: CHAPTER_ID }) };
}

const baseChapter = {
  id: CHAPTER_ID,
  workspace_id: WORKSPACE_ID,
  rtp_cycle_id: CYCLE_ID,
  title: "Financial Element",
  section_type: "financial",
  status: "drafting",
  summary: "How the constrained plan is paid for.",
  guidance: "Lead with the constrained portfolio and its committed dollars.",
};

const baseCycle = {
  id: CYCLE_ID,
  title: "2050 Regional Transportation Plan",
  status: "draft",
  geography_label: "Example County",
  horizon_start_year: 2026,
  horizon_end_year: 2050,
  adoption_target_date: "2027-06-01",
  public_review_open_at: null,
  public_review_close_at: null,
};

function chainable(result: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

function installClient(overrides?: {
  chapter?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  storedDraft?: Record<string, unknown> | null;
}) {
  const chapter = overrides?.chapter === undefined ? baseChapter : overrides.chapter;
  const membership =
    overrides?.membership === undefined
      ? { workspace_id: WORKSPACE_ID, role: "member" }
      : overrides.membership;

  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "document_narrative_drafts") {
        const lookup = chainable({ data: overrides?.storedDraft ?? null, error: null });
        return { ...lookup, insert: draftInsertMock, update: updateMock };
      }
      if (table === "rtp_cycle_chapters") return chainable({ data: chapter, error: null });
      if (table === "workspace_members") return chainable({ data: membership, error: null });
      if (table === "rtp_cycles") return chainable({ data: baseCycle, error: null });
      if (table === "project_rtp_cycle_links") {
        return chainable({
          data: [
            {
              id: "link-1",
              project_id: "44444444-4444-4444-8444-444444444444",
              portfolio_role: "constrained",
              projects: { id: "44444444-4444-4444-8444-444444444444", name: "Main St Bridge", status: "active", updated_at: null },
            },
          ],
          error: null,
        });
      }
      if (table === "engagement_campaigns") {
        return chainable({ data: [{ id: "camp-1", rtp_cycle_chapter_id: null }], error: null });
      }
      if (table === "engagement_items") {
        return chainable({
          data: [
            {
              id: "item-1",
              campaign_id: "camp-1",
              category_id: null,
              status: "approved",
              source_type: "public_portal",
              latitude: null,
              longitude: null,
              moderation_notes: null,
              created_at: "2026-07-01T00:00:00.000Z",
              updated_at: "2026-07-01T00:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "county_runs") {
        return chainable({
          data: [
            {
              id: "county-1",
              workspace_id: WORKSPACE_ID,
              run_name: "Countywide screening",
              geography_label: "Example County",
              stage: "validated-screening",
              updated_at: "2026-07-10T00:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "project_funding_profiles") {
        return chainable({
          data: [
            {
              project_id: "44444444-4444-4444-8444-444444444444",
              funding_need_amount: 500000,
              local_match_need_amount: 0,
              updated_at: null,
            },
          ],
          error: null,
        });
      }
      // funding_awards, funding_opportunities, billing_invoice_records
      return chainable({ data: [], error: null });
    }),
  });
}

const updateSingleMock = vi.fn();
const updateSelectMock = vi.fn(() => ({ single: updateSingleMock }));
const updateEqMock = vi.fn(() => ({ select: updateSelectMock }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

describe("/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/draft POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("OPENPLAN_ASSISTANT_MODEL", "");

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    recordAiUsageEventMock.mockResolvedValue(undefined);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCountyRunModelingEvidenceMock.mockResolvedValue({ evidence: null, error: null });
    retrieveKnowledgeBaseExcerptsMock.mockResolvedValue([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentTitle: "Adopted 2045 RTP",
        docKind: "plan",
        pageFrom: 12,
        pageTo: 12,
        chunkIndex: 0,
        snippet: "The financial element totals were updated in the prior cycle.",
        rank: 1,
      },
    ]);

    draftSingleMock.mockResolvedValue({
      data: {
        id: DRAFT_ID,
        target_kind: "rtp_chapter",
        target_id: CHAPTER_ID,
        section_key: null,
        draft_markdown: "Drafted chapter narrative.",
        model: "claude-opus-4-8",
        status: "draft",
      },
      error: null,
    });

    generateTextMock.mockResolvedValue({
      text: 'The chapter is drafting. [fact:fact_1] Uncited filler sentence here.',
      usage: { inputTokens: 1500, outputTokens: 900, totalTokens: 2400 },
    });

    installClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await postChapterDraft(jsonRequest("POST"), routeContext());
    expect(response.status).toBe(401);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns a typed 503 ai_offline error when ANTHROPIC_API_KEY is empty", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "  ");
    const response = await postChapterDraft(jsonRequest("POST"), routeContext());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ai_offline" });
  });

  it("returns 429 without a model call when the workspace AI allowance is exhausted", async () => {
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 300 });

    const response = await postChapterDraft(jsonRequest("POST"), routeContext());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer", async () => {
    installClient({ membership: { workspace_id: WORKSPACE_ID, role: "viewer" } });
    const response = await postChapterDraft(jsonRequest("POST"), routeContext());
    expect(response.status).toBe(403);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("grounds the prompt in cycle facts and stores the validated draft", async () => {
    const response = await postChapterDraft(jsonRequest("POST"), routeContext());
    expect(response.status).toBe(201);

    const generationArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
    // Chapter + cycle metadata as citable facts, with real recorded values.
    expect(generationArgs.prompt).toContain('The RTP chapter "Financial Element"');
    expect(generationArgs.prompt).toContain("2050 Regional Transportation Plan");
    expect(generationArgs.prompt).toContain("planning horizon 2026–2050");
    expect(generationArgs.prompt).toContain("1 project(s) are linked to this RTP cycle: 1 constrained.");
    // The engagement caveat contract and the KB caveat contract ship verbatim.
    expect(generationArgs.prompt).toContain(ENGAGEMENT_NARRATIVE_CAVEAT);
    expect(generationArgs.prompt).toContain(KB_NARRATIVE_CAVEAT);
    expect(generationArgs.prompt).toContain('"Adopted 2045 RTP"');
    expect(generationArgs.prompt).toContain("CITATIONS ARE MANDATORY");
    expect(generationArgs.prompt).toContain("NEVER upgrade a claim");

    // The stored row is chapter-targeted with grounding stats + facts hash.
    const insertPayload = (draftInsertMock.mock.calls[0] as unknown[])[0] as {
      workspace_id: string;
      target_kind: string;
      target_id: string;
      section_key: string | null;
      status: string;
      facts_hash: string;
      grounded_sentence_count: number;
      total_sentence_count: number;
      grounding_json: { mode: string; is_fully_grounded: boolean };
    };
    expect(insertPayload.workspace_id).toBe(WORKSPACE_ID);
    expect(insertPayload.target_kind).toBe("rtp_chapter");
    expect(insertPayload.target_id).toBe(CHAPTER_ID);
    expect(insertPayload.section_key).toBeNull();
    expect(insertPayload.status).toBe("draft");
    expect(insertPayload.facts_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(insertPayload.grounded_sentence_count).toBe(1);
    expect(insertPayload.total_sentence_count).toBe(2);
    expect(insertPayload.grounding_json.is_fully_grounded).toBe(false);

    // Metered into the shared document-narrative bucket after success.
    expect(recordAiUsageEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        bucketKey: "document_narrative_draft",
        eventKey: "rtp_chapter_narrative_draft",
      })
    );
  });

  it("respects the OPENPLAN_ASSISTANT_MODEL override", async () => {
    vi.stubEnv("OPENPLAN_ASSISTANT_MODEL", "claude-haiku-4-5");
    const response = await postChapterDraft(jsonRequest("POST"), routeContext());
    expect(response.status).toBe(201);
    expect(anthropicMock).toHaveBeenCalledWith("claude-haiku-4-5");
  });

  it("returns 502 without persisting or metering when generation fails", async () => {
    generateTextMock.mockRejectedValue(new Error("model unavailable"));
    const response = await postChapterDraft(jsonRequest("POST"), routeContext());
    expect(response.status).toBe(502);
    expect(draftInsertMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });
});

describe("/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/draft PATCH", () => {
  const storedDraft = {
    id: DRAFT_ID,
    workspace_id: WORKSPACE_ID,
    target_kind: "rtp_chapter",
    target_id: CHAPTER_ID,
    section_key: null,
    draft_markdown: "Drafted chapter narrative. [fact:fact_1]",
    model: "claude-opus-4-8",
    grounding_json: { mode: "annotated" },
    grounded_sentence_count: 1,
    total_sentence_count: 1,
    facts_hash: "hash",
    status: "draft",
    accepted_markdown: null,
    accepted_by: null,
    accepted_at: null,
    created_by: USER_ID,
    created_at: "2026-07-27T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    updateSingleMock.mockResolvedValue({ data: { id: DRAFT_ID, status: "accepted" }, error: null });
    installClient({ storedDraft });
  });

  it("flips the draft to accepted as provenance of an editor insert", async () => {
    const response = await patchChapterDraft(
      jsonRequest("PATCH", {
        action: "accept",
        draftId: DRAFT_ID,
        acceptedMarkdown: "Drafted chapter narrative.",
      }),
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        accepted_markdown: "Drafted chapter narrative.",
        accepted_by: USER_ID,
      })
    );
  });

  it("reports a refused write, not a bare 500, when the update matches no rows", async () => {
    // PostgREST's `.single()` spelling of "your UPDATE changed nothing": PGRST116
    // with a null row, which is not a server fault. Both the chapter and the
    // draft row itself were read through this caller's client first, so the
    // honest answer names the refusal instead of "Failed to update".
    updateSingleMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });

    const response = await patchChapterDraft(
      jsonRequest("PATCH", { action: "accept", draftId: DRAFT_ID }),
      routeContext()
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "The chapter draft was not saved",
      details: expect.stringContaining("row-level security policy"),
    });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "draft_review_update_matched_no_rows",
      expect.objectContaining({ draftId: DRAFT_ID, chapterId: CHAPTER_ID, workspaceId: WORKSPACE_ID })
    );
    expect(mockAudit.error).not.toHaveBeenCalledWith("draft_review_update_failed", expect.anything());
  });

  it("keeps the original 500 and audit code when the update genuinely fails", async () => {
    updateSingleMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });

    const response = await patchChapterDraft(
      jsonRequest("PATCH", { action: "dismiss", draftId: DRAFT_ID }),
      routeContext()
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to update chapter draft" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "draft_review_update_failed",
      expect.objectContaining({ draftId: DRAFT_ID, message: "permission denied" })
    );
  });

  it("answers 409 for a dismissed draft — dismissal is terminal", async () => {
    installClient({ storedDraft: { ...storedDraft, status: "dismissed" } });

    const response = await patchChapterDraft(
      jsonRequest("PATCH", { action: "accept", draftId: DRAFT_ID }),
      routeContext()
    );

    expect(response.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
