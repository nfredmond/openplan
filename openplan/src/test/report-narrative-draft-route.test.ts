import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const generateTextMock = vi.fn();
const anthropicMock = vi.fn((..._args: unknown[]) => "mock-anthropic-model");
const checkAiUsageRateLimitMock = vi.fn();
const recordAiUsageEventMock = vi.fn();

const REPORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const draftSingleMock = vi.fn();
const draftSelectMock = vi.fn(() => ({ single: draftSingleMock }));
const draftInsertMock = vi.fn(() => ({ select: draftSelectMock }));

// Knowledge Base retrieval goes through the `kb_search_chunks` RPC. Left
// unstubbed (rejecting) it degrades to no excerpts, which is the contract.
const rpcMock = vi.fn();

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

import { POST as postNarrativeDraft } from "@/app/api/reports/[reportId]/narrative-draft/route";

function jsonRequest(payload: unknown = { sectionKey: "executive_summary" }) {
  return new NextRequest(`http://localhost/api/reports/${REPORT_ID}/narrative-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function routeContext(reportId: string = REPORT_ID) {
  return { params: Promise.resolve({ reportId }) };
}

const baseReport = {
  id: REPORT_ID,
  workspace_id: WORKSPACE_ID,
  project_id: PROJECT_ID,
  rtp_cycle_id: null,
  engagement_campaign_id: null,
  title: "Main St Bridge Board Packet",
  summary: "Quarterly board packet.",
  report_type: "board_packet",
};

const baseProject = {
  id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  name: "Main St Bridge",
  summary: "Replace the load-limited bridge.",
  status: "active",
  plan_type: "capital",
  delivery_phase: "design",
  updated_at: "2026-07-20T00:00:00.000Z",
};

// Generic awaitable query chain: every builder method returns the chain,
// awaiting it (or calling maybeSingle) yields the canned result.
function chainable(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const chain: Record<string, unknown> = {
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "eq", "neq", "in", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

function installClient(overrides?: {
  report?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
}) {
  const report = overrides?.report === undefined ? baseReport : overrides.report;
  const membership =
    overrides?.membership === undefined
      ? { workspace_id: WORKSPACE_ID, role: "member" }
      : overrides.membership;

  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === "document_narrative_drafts") return { insert: draftInsertMock };
      if (table === "reports") return chainable({ data: report, error: null });
      if (table === "workspace_members") return chainable({ data: membership, error: null });
      if (table === "projects") return chainable({ data: baseProject, error: null });
      if (table === "report_runs") {
        return chainable({
          data: [{ id: "link-1", run_id: "run-1", model_run_id: null, county_run_id: null, sort_order: 0 }],
          error: null,
        });
      }
      if (table === "runs") {
        return chainable({
          data: [
            {
              id: "run-1",
              title: "Corridor screening",
              summary_text: "Screening summary text.",
              metrics: { overallScore: 72, confidence: "medium" },
              created_at: "2026-07-01T00:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "project_funding_profiles") {
        return chainable({
          data: { id: "profile-1", funding_need_amount: 500000, local_match_need_amount: 0, updated_at: null },
          error: null,
        });
      }
      // funding_awards, funding_opportunities, billing_invoice_records — empty
      // is a valid posture for all.
      return chainable({ data: [], error: null });
    }),
  });
}

describe("/api/reports/[reportId]/narrative-draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("OPENPLAN_ASSISTANT_MODEL", "");

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    // Default: the workspace has uploaded nothing that matches this packet.
    rpcMock.mockResolvedValue({ data: [], error: null });
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    recordAiUsageEventMock.mockResolvedValue(undefined);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });

    draftSingleMock.mockImplementation(async () => ({
      data: {
        id: DRAFT_ID,
        target_kind: "report_section",
        target_id: REPORT_ID,
        section_key: "executive_summary",
        draft_markdown: "Drafted narrative paragraphs.",
        model: "claude-opus-4-8",
        status: "draft",
        created_at: "2026-07-27T00:00:00.000Z",
      },
      error: null,
    }));

    generateTextMock.mockResolvedValue({
      text: "Drafted narrative paragraphs.",
      usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
    });

    installClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when the user is not authenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(draftInsertMock).not.toHaveBeenCalled();
  });

  it("returns a typed 503 ai_offline error when ANTHROPIC_API_KEY is empty", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "   ");

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ai_offline" });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a section outside the AI-narrative whitelist", async () => {
    const response = await postNarrativeDraft(
      jsonRequest({ sectionKey: "deliverables" }),
      routeContext()
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('"deliverables"');
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(draftInsertMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the section key belongs to a different report type", async () => {
    // run_summaries is whitelisted for analysis_summary, not board_packet.
    const response = await postNarrativeDraft(
      jsonRequest({ sectionKey: "run_summaries" }),
      routeContext()
    );

    expect(response.status).toBe(400);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("answers 405 for an RTP-cycle-targeted report, with a plain statement", async () => {
    installClient({
      report: { ...baseReport, rtp_cycle_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(405);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("project-targeted reports only");
    expect(payload.error).toContain("chapter draft assist");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("answers 405 for a campaign-targeted report, with a plain statement", async () => {
    installClient({
      report: {
        ...baseReport,
        project_id: null,
        engagement_campaign_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      },
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(405);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Campaign-targeted packets");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the member lacks report.generate access", async () => {
    installClient({ membership: { workspace_id: WORKSPACE_ID, role: "viewer" } });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns 429 without a model call when the workspace AI allowance is exhausted", async () => {
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 300 });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });

  it("generates, validates, and stores the draft with grounding stats and a facts hash", async () => {
    generateTextMock.mockResolvedValue({
      text: 'The Main St Bridge project is in design. [fact:fact_1] Uncited filler claim here.',
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);

    // The prompt is grounded: numbered facts + mandatory citations + honesty rails.
    const generationArgs = generateTextMock.mock.calls[0][0] as { prompt: string };
    expect(generationArgs.prompt).toContain("WORKSPACE FACTS");
    expect(generationArgs.prompt).toContain("CITATIONS ARE MANDATORY");
    expect(generationArgs.prompt).toContain("NEVER upgrade a claim");
    expect(generationArgs.prompt).toContain('[fact:fact_1] The Main St Bridge project is in status "Active"');
    expect(generationArgs.prompt).toContain("recorded funding need: $500,000");

    // The stored row carries the annotated validation and the facts fingerprint.
    const insertPayload = (draftInsertMock.mock.calls[0] as unknown[])[0] as {
      workspace_id: string;
      target_kind: string;
      target_id: string;
      section_key: string;
      status: string;
      facts_hash: string;
      grounded_sentence_count: number;
      total_sentence_count: number;
      grounding_json: { mode: string; is_fully_grounded: boolean };
      created_by: string;
    };
    expect(insertPayload.workspace_id).toBe(WORKSPACE_ID);
    expect(insertPayload.target_kind).toBe("report_section");
    expect(insertPayload.target_id).toBe(REPORT_ID);
    expect(insertPayload.section_key).toBe("executive_summary");
    expect(insertPayload.status).toBe("draft");
    expect(insertPayload.facts_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(insertPayload.grounded_sentence_count).toBe(1);
    expect(insertPayload.total_sentence_count).toBe(2);
    expect(insertPayload.grounding_json.mode).toBe("annotated");
    expect(insertPayload.grounding_json.is_fully_grounded).toBe(false);
    expect(insertPayload.created_by).toBe(USER_ID);

    // The successful generation is metered against the shared staff AI allowance.
    expect(recordAiUsageEventMock).toHaveBeenCalledTimes(1);
    expect(recordAiUsageEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        bucketKey: "document_narrative_draft",
        eventKey: "report_section_narrative_draft",
      })
    );
  });

  it("respects the OPENPLAN_ASSISTANT_MODEL override", async () => {
    vi.stubEnv("OPENPLAN_ASSISTANT_MODEL", "claude-haiku-4-5");

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);
    expect(anthropicMock).toHaveBeenCalledWith("claude-haiku-4-5");
    expect(draftInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5" })
    );
  });

  it("returns 502 without persisting or metering when generation fails", async () => {
    generateTextMock.mockRejectedValue(new Error("model unavailable"));

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(502);
    expect(draftInsertMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });

  it("answers 503 with the migration name when the drafts table is missing", async () => {
    draftSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "public.document_narrative_drafts" does not exist' },
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { hint?: string };
    expect(payload.hint).toContain("20260727000013_document_narrative_drafts");
  });

  it("makes an uploaded document citable in the agency's own board packet", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          document_title: "2024 Local Road Safety Plan",
          doc_kind: "plan",
          page_from: 12,
          page_to: 13,
          chunk_index: 4,
          content: "The corridor was identified as a high-injury network segment.",
          rank: 0.9,
        },
      ],
      error: null,
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);

    // Retrieval is scoped to this workspace AND this report's project.
    expect(rpcMock).toHaveBeenCalledWith(
      "kb_search_chunks",
      expect.objectContaining({ p_workspace_id: WORKSPACE_ID, p_project_id: PROJECT_ID })
    );

    // The excerpt reaches the model only as a NUMBERED, citable fact carrying
    // its document, page, and the uploaded-document caveat verbatim.
    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toMatch(
      /\[fact:fact_\d+\] An uploaded document "2024 Local Road Safety Plan", pp\. 12-13 in the Main St Bridge project workspace states:/
    );
    expect(prompt).toContain("high-injury network segment");
    expect(prompt).toContain(
      "has not been independently verified by OpenPlan"
    );
    expect(prompt).toContain("attribute the content to the named document");

    // The stored provenance record lists the KB fact among the citable facts.
    const insertPayload = (draftInsertMock.mock.calls[0] as unknown[])[0] as {
      grounding_json: { facts: Array<{ fact_id: string; claim_text: string }> };
    };
    expect(
      insertPayload.grounding_json.facts.some((fact) =>
        fact.claim_text.includes("2024 Local Road Safety Plan")
      )
    ).toBe(true);
  });

  it("grounds a sentence that cites a knowledge-base fact instead of flagging it as unknown", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          document_title: "2024 Local Road Safety Plan",
          doc_kind: "plan",
          page_from: 12,
          page_to: null,
          chunk_index: 4,
          content: "The corridor was identified as a high-injury network segment.",
          rank: 0.9,
        },
      ],
      error: null,
    });

    // Draft first so the fact ids are known, then answer citing the last one
    // (the KB claim is appended after the deterministic section facts).
    await postNarrativeDraft(jsonRequest(), routeContext());
    const firstFacts = (
      (draftInsertMock.mock.calls[0] as unknown[])[0] as {
        grounding_json: { facts: Array<{ fact_id: string; claim_text: string }> };
      }
    ).grounding_json.facts;
    const kbFactId = firstFacts.find((fact) =>
      fact.claim_text.includes("2024 Local Road Safety Plan")
    )?.fact_id;
    expect(kbFactId).toBeTruthy();

    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    rpcMock.mockResolvedValue({
      data: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          document_title: "2024 Local Road Safety Plan",
          doc_kind: "plan",
          page_from: 12,
          page_to: null,
          chunk_index: 4,
          content: "The corridor was identified as a high-injury network segment.",
          rank: 0.9,
        },
      ],
      error: null,
    });
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    draftSingleMock.mockResolvedValue({ data: { id: DRAFT_ID }, error: null });
    generateTextMock.mockResolvedValue({
      text: `The adopted plan names this corridor a high-injury network segment. [fact:${kbFactId}]`,
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    });
    installClient();

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);
    const insertPayload = (draftInsertMock.mock.calls[0] as unknown[])[0] as {
      grounding_json: { is_fully_grounded: boolean; unknown_fact_ids: string[] };
      grounded_sentence_count: number;
    };
    expect(insertPayload.grounding_json.unknown_fact_ids).toEqual([]);
    expect(insertPayload.grounding_json.is_fully_grounded).toBe(true);
    expect(insertPayload.grounded_sentence_count).toBe(1);
  });

  it("keeps the facts hash tied to the deterministic packet facts, not to retrieval", async () => {
    // The generate route recomputes this hash from `buildReportSectionFacts`
    // alone. If a retrieved excerpt moved it, every accepted block would be
    // reported stale at the next generation with nothing having changed.
    await postNarrativeDraft(jsonRequest(), routeContext());
    const withoutKb = (
      (draftInsertMock.mock.calls[0] as unknown[])[0] as { facts_hash: string }
    ).facts_hash;

    draftInsertMock.mockClear();
    rpcMock.mockResolvedValue({
      data: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          document_title: "2024 Local Road Safety Plan",
          doc_kind: "plan",
          page_from: 12,
          page_to: null,
          chunk_index: 4,
          content: "The corridor was identified as a high-injury network segment.",
          rank: 0.9,
        },
      ],
      error: null,
    });

    await postNarrativeDraft(jsonRequest(), routeContext());
    const withKb = (
      (draftInsertMock.mock.calls[0] as unknown[])[0] as { facts_hash: string }
    ).facts_hash;

    expect(withKb).toBe(withoutKb);
  });

  it("does not instruct the model about uploaded-document facts it was not given", async () => {
    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);
    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).not.toContain("uploaded-document facts");
    expect(prompt).not.toContain("has not been independently verified by OpenPlan");
  });

  it("still drafts when the knowledge base cannot be searched", async () => {
    // Retrieval is best-effort by contract: an unavailable RPC costs the draft
    // some citable facts and never invents one.
    rpcMock.mockRejectedValue(new Error("kb_search_chunks does not exist"));

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);
    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain("WORKSPACE FACTS");
    expect(prompt).not.toContain("An uploaded document");
  });
});

/**
 * The route appends uploaded-document claims to the deterministic section
 * facts. That is safe only while every draftable section has deterministic
 * facts of its own: if one ever produced none, the appended excerpts would BE
 * the whole citable list, and the section would come back reading
 * `is_fully_grounded: true` while resting entirely on quotations OpenPlan has
 * not verified and the packet does not itself render. `buildReportSectionFacts`
 * answers [] for any key it does not handle, so a section key added to the
 * whitelist without a matching fact branch would open exactly that path — and
 * would do it silently, since nothing else in the route notices an empty list.
 */
describe("AI-narrative section whitelist", () => {
  it("gives every draftable section deterministic facts of its own to cite", async () => {
    const { AI_NARRATIVE_SECTION_KEYS } = await import("@/lib/reports/catalog");
    const { buildReportSectionFacts } = await import("@/lib/reports/narrative-drafts");

    // Deliberately the emptiest input the route can assemble: no runs, no
    // citations, no funding snapshot. A section whose facts appear only when
    // data exists is exactly the hazard this pins.
    const bareInput = {
      report: { title: "Packet", summary: null, report_type: "board_packet" },
      project: {
        name: "Project",
        summary: null,
        status: "active",
        plan_type: "capital",
        delivery_phase: "planning",
        updated_at: null,
      },
      runs: [],
      citedModelRuns: [],
      citedCountyRuns: [],
      projectFundingSnapshot: null,
    };

    for (const [reportType, sectionKeys] of Object.entries(AI_NARRATIVE_SECTION_KEYS)) {
      for (const sectionKey of sectionKeys) {
        const facts = buildReportSectionFacts(
          { ...bareInput, report: { ...bareInput.report, report_type: reportType } },
          sectionKey
        );
        expect(
          facts.length,
          `${reportType}.${sectionKey} is draftable but has no deterministic facts, so a knowledge-base excerpt would become the only citable claim in it`
        ).toBeGreaterThan(0);
      }
    }
  });
});
