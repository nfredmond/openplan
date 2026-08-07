import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE NARRATIVE-DRAFT ROUTE MUST REFUSE TO DRAFT ON A FAILED EVIDENCE READ.
 *
 * THE CONSEQUENCE, WHICH IS WHY THIS FILE IS SEPARATE AND SPECIFIC. The prompt
 * this route builds does not merely omit missing evidence — it ORDERS the model
 * to omit it:
 *
 *   "No engagement campaign is linked to this project. Do not reference
 *    community input, public comments, or outreach results."
 *   "No comparison-backed modeling packet or benefit-cost screening is visible
 *    for this project. Do not reference modeling or analysis results."
 *
 * Both sentences are produced from an EMPTY read result, and a failed read is
 * empty too. So a dropped column, an RLS change, or one transient failure during
 * drafting deletes an agency's Title VI outreach record and its modeling
 * evidence out of a competitive federal grant application, and nobody is told
 * the read failed. The agency submits a weaker application and never learns why.
 *
 * Each test below therefore asserts BOTH halves: the refusal is produced, and
 * the false instruction is NOT — checked against every prompt the route sent, so
 * a future change that drafts anyway cannot pass by leaving `generateText`
 * uncalled in some other way.
 *
 * The boundary case is asserted too, and it is the one that keeps the fix from
 * being a blunt instrument: a read that SUCCEEDS and genuinely finds no campaign
 * still produces the omit instruction, because that instruction is true.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const generateTextMock = vi.fn();
const anthropicMock = vi.fn((..._args: unknown[]) => "mock-anthropic-model");
const checkAiUsageRateLimitMock = vi.fn();
const recordAiUsageEventMock = vi.fn();

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const NO_ENGAGEMENT_INSTRUCTION =
  "Do not reference community input, public comments, or outreach results.";
const NO_ANALYSIS_INSTRUCTION = "Do not reference modeling or analysis results.";

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

vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
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

import { POST as postNarrativeDraft } from "@/app/api/funding-opportunities/[opportunityId]/narrative-draft/route";

type ReadResult = { data: unknown; error: { message: string } | null };

function jsonRequest() {
  return new NextRequest(
    `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/narrative-draft`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }
  );
}

const routeContext = () => ({ params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) });

const opportunityRow = {
  id: OPPORTUNITY_ID,
  workspace_id: WORKSPACE_ID,
  program_id: null,
  project_id: PROJECT_ID,
  title: "2027 ATP countywide active transportation call",
  opportunity_status: "open",
  decision_state: "pursue",
  agency_name: "CTC / Caltrans",
  expected_award_amount: 750000,
  closes_at: null,
  decision_due_at: null,
  fit_notes: "Strong safe-routes fit.",
  readiness_notes: "Local match posture confirmed with finance.",
  decision_rationale: "Board approved pursue.",
  summary: "Countywide ATP package opportunity.",
};

/** Everything the evidence assembly reads, succeeding and empty. */
function succeeding(table: string, columns: string): ReadResult {
  if (table === "projects" && !columns.includes("updated_at")) {
    return { data: { id: PROJECT_ID, name: "Main St Bridge" }, error: null };
  }
  if (table === "project_funding_profiles") return { data: null, error: null };
  return { data: [], error: null };
}

/**
 * A client whose reads all succeed except the one `fail` names. Resolving on
 * `(table, columns)` is what makes a NAMED read failable — a mock keyed on the
 * table alone hands its fixture to every caller of that table, which is the
 * reason this defect class survived a green suite in the first place.
 */
function clientWith(fail?: (table: string, columns: string) => ReadResult | null) {
  return {
    auth: { getUser: authGetUserMock },
    rpc: () => Promise.resolve({ data: [], error: null }),
    from(table: string) {
      if (table === "funding_opportunity_narrative_drafts") {
        return { insert: draftInsertMock } as unknown as Record<string, unknown>;
      }
      let columns = "";
      const resolve = () => fail?.(table, columns) ?? succeeding(table, columns);
      const chain: Record<string, unknown> = {
        select: (cols: string) => {
          columns = cols;
          return chain;
        },
        maybeSingle: () => Promise.resolve(resolve()),
        then: (ok: (value: unknown) => unknown, err?: (reason: unknown) => unknown) =>
          Promise.resolve(resolve()).then(ok, err),
      };
      for (const method of ["eq", "neq", "not", "in", "order", "limit"]) {
        chain[method] = () => chain;
      }
      return chain;
    },
  };
}

/** Every prompt the route actually sent to the model, across all calls. */
function promptsSent(): string[] {
  return generateTextMock.mock.calls.map((call) => (call[0] as { prompt: string }).prompt);
}

describe("/api/funding-opportunities/[opportunityId]/narrative-draft — a failed evidence read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("OPENPLAN_GRANTS_AI_MODEL", "");

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    recordAiUsageEventMock.mockResolvedValue(undefined);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });

    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: opportunityRow,
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    generateTextMock.mockResolvedValue({
      text: "Drafted narrative paragraphs.",
      usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
    });

    draftSingleMock.mockResolvedValue({
      data: {
        id: DRAFT_ID,
        opportunity_id: OPPORTUNITY_ID,
        draft_markdown: "Drafted narrative paragraphs.",
        model: "claude-opus-4-8",
        source: "ai",
        created_at: "2026-07-17T00:00:00.000Z",
      },
      error: null,
    });

    createClientMock.mockResolvedValue(clientWith());
  });

  it("refuses to draft when the engagement-campaigns read fails, and never orders the model to omit outreach", async () => {
    createClientMock.mockResolvedValue(
      clientWith((table) =>
        table === "engagement_campaigns"
          ? { data: null, error: { message: "permission denied for table engagement_campaigns" } }
          : null
      )
    );

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: string; failedReads: string[] };
    expect(payload.failedReads).toEqual(["the project's engagement campaigns"]);
    expect(payload.error).toContain("the project's engagement campaigns");
    // The planner is told this is a read failure, not an empty result — the one
    // sentence that stops the refusal being read as "there is nothing to cite".
    expect(payload.error).toContain("read failure, not an empty result");

    // THE FALSE CLAIM IS GONE. No draft was generated at all, and no prompt the
    // route sent carried the instruction that deletes the outreach record.
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(promptsSent().some((prompt) => prompt.includes(NO_ENGAGEMENT_INSTRUCTION))).toBe(false);
    expect(draftInsertMock).not.toHaveBeenCalled();
    // A refusal is not an AI call, so it is never metered against the workspace.
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "narrative_evidence_read_failed",
      expect.objectContaining({
        failedReads: [
          {
            subject: "the project's engagement campaigns",
            message: "permission denied for table engagement_campaigns",
          },
        ],
      })
    );
  });

  it("refuses to draft when the reports read fails, and never orders the model to omit modeling", async () => {
    createClientMock.mockResolvedValue(
      clientWith((table) =>
        table === "reports" ? { data: null, error: { message: "connection reset" } } : null
      )
    );

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { failedReads: string[] };
    expect(payload.failedReads).toEqual(["the project's reports"]);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(promptsSent().some((prompt) => prompt.includes(NO_ANALYSIS_INSTRUCTION))).toBe(false);
    expect(draftInsertMock).not.toHaveBeenCalled();
  });

  it("names an unapplied migration as one, instead of telling the planner to retry forever", async () => {
    createClientMock.mockResolvedValue(
      clientWith((table) =>
        table === "engagement_campaigns"
          ? {
              data: null,
              error: { message: 'column engagement_campaigns.representativeness_json does not exist' },
            }
          : null
      )
    );

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("apply the latest Supabase migrations");
    // NOT 503: this endpoint's 503 already means `ai_offline`, and the panel
    // renders that as "AI drafting is offline" — a second wrong sentence.
    expect(response.status).not.toBe(503);
  });

  it("still drafts, and still orders the omission, when the reads SUCCEED and find nothing", async () => {
    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);
    // The boundary this fix must not blur: an omit instruction is legitimate
    // when a successful read genuinely found nothing.
    const prompt = promptsSent()[0];
    expect(prompt).toContain(NO_ENGAGEMENT_INSTRUCTION);
    expect(prompt).toContain(NO_ANALYSIS_INSTRUCTION);
    expect(draftInsertMock).toHaveBeenCalled();
  });
});

/**
 * THE PURSUIT COLUMNS, ON THE DOOR THAT USED TO DROP THEM.
 *
 * `loadFundingOpportunityAccess` selects a fixed column list with no
 * `pursuit_kind`, `solicitation_number`, `submission_format_note` or
 * `questions_due_at` — which is why `opportunityRow` above has none of them.
 * This route used that row directly, so `isProposal` was PERMANENTLY FALSE: a
 * planner answering an RFP got a draft with no solicitation number, no
 * submission-format note, no questions-due date and no past-performance
 * grounding, and nothing said anything had been dropped. The per-section
 * drafter loaded the pursuit context and merged it; this one did not.
 *
 * Recorded by the 2026-08-06 foundation audit as SWEEP_A3 — "a LIVE PRODUCTION
 * DEFECT, not only an unguarded claim". A unit test on the merge is not enough
 * to close it: the defect was that THIS ROUTE did not call the merge, so the
 * assertion has to run through the real route and read the real prompt.
 */
describe("/api/funding-opportunities/[opportunityId]/narrative-draft — proposal pursuits", () => {
  const PROPOSAL_CONTEXT = {
    id: OPPORTUNITY_ID,
    pursuit_kind: "proposal",
    solicitation_number: "RFP-2026-014",
    submission_format_note: "Portal upload, 20-page limit.",
    questions_due_at: "2026-08-15T00:00:00.000Z",
  };

  /** Answers the pursuit loader's own projection, and nothing else. */
  function withPursuitRow(row: Record<string, unknown> | null) {
    return (table: string, columns: string): ReadResult | null =>
      table === "funding_opportunities" && columns.includes("pursuit_kind")
        ? { data: row, error: null }
        : null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("OPENPLAN_GRANTS_AI_MODEL", "");
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    recordAiUsageEventMock.mockResolvedValue(undefined);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: opportunityRow,
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });
    generateTextMock.mockResolvedValue({
      text: "Drafted narrative paragraphs.",
      usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
    });
    draftSingleMock.mockResolvedValue({
      data: {
        id: DRAFT_ID,
        opportunity_id: OPPORTUNITY_ID,
        draft_markdown: "Drafted narrative paragraphs.",
        model: "claude-opus-4-8",
        source: "ai",
        created_at: "2026-07-17T00:00:00.000Z",
      },
      error: null,
    });
  });

  it("grounds the draft on the solicitation the planner is answering", async () => {
    createClientMock.mockResolvedValue(clientWith(withPursuitRow(PROPOSAL_CONTEXT)));

    const response = await postNarrativeDraft(jsonRequest(), routeContext());
    expect(response.status).toBe(201);

    const prompt = promptsSent().join("\n");
    expect(prompt).toContain("RFP-2026-014");
    expect(prompt).toContain("Portal upload, 20-page limit.");
    expect(prompt).toContain("2026-08-15");
  });

  it("keeps a grant pursuit free of solicitation grounding", async () => {
    createClientMock.mockResolvedValue(
      clientWith(
        withPursuitRow({
          id: OPPORTUNITY_ID,
          pursuit_kind: "grant",
          solicitation_number: null,
          submission_format_note: null,
          questions_due_at: null,
        })
      )
    );

    const response = await postNarrativeDraft(jsonRequest(), routeContext());
    expect(response.status).toBe(201);
    // Both directions, so the assertion above cannot pass by the fixture simply
    // appearing everywhere.
    expect(promptsSent().join("\n")).not.toContain("RFP-2026-014");
  });

  it("refuses rather than degrading a proposal into a grant on a read failure", async () => {
    createClientMock.mockResolvedValue(
      clientWith((table, columns) =>
        table === "funding_opportunities" && columns.includes("pursuit_kind")
          ? { data: null, error: { message: "connection reset by peer" } }
          : null
      )
    );

    const response = await postNarrativeDraft(jsonRequest(), routeContext());
    // A transient failure produces the SAME empty pursuit context a real grant
    // does, so answering 201 here would silently strip an RFP response of its
    // solicitation grounding — the failure mode this whole route header is about.
    expect(response.status).toBe(500);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("still drafts when the pursuit schema is not migrated yet", async () => {
    // A deployment predating 20260727000015 has no pursuit columns and can hold
    // no proposal rows, so 'grant' is truthful rather than a guess — and must
    // not become the 500 above.
    createClientMock.mockResolvedValue(
      clientWith((table, columns) =>
        table === "funding_opportunities" && columns.includes("pursuit_kind")
          ? { data: null, error: { message: 'column "pursuit_kind" does not exist' } }
          : null
      )
    );

    const response = await postNarrativeDraft(jsonRequest(), routeContext());
    expect(response.status).toBe(201);
    expect(promptsSent().join("\n")).not.toContain("RFP-2026-014");
  });
});
