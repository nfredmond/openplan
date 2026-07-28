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
});
