import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const generateTextMock = vi.fn();
const anthropicMock = vi.fn((..._args: unknown[]) => "mock-anthropic-model");

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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

vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (...args: unknown[]) => anthropicMock(...args),
}));

import { POST as postNarrativeDraft } from "@/app/api/funding-opportunities/[opportunityId]/narrative-draft/route";

function jsonRequest(payload: unknown = {}) {
  return new NextRequest(`http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/narrative-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function routeContext(opportunityId: string = OPPORTUNITY_ID) {
  return { params: Promise.resolve({ opportunityId }) };
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
  owner_label: "Grant lead",
  cadence_label: "Biennial",
  expected_award_amount: 750000,
  opens_at: null,
  closes_at: null,
  decision_due_at: null,
  fit_notes: "Strong safe-routes fit.",
  readiness_notes: "Local match posture confirmed with finance.",
  decision_rationale: "Board approved pursue.",
  decided_at: null,
  summary: "Countywide ATP package opportunity.",
  created_at: "2026-04-10T16:30:00.000Z",
  updated_at: "2026-04-10T17:00:00.000Z",
};

describe("/api/funding-opportunities/[opportunityId]/narrative-draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("OPENPLAN_GRANTS_AI_MODEL", "");

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
    });

    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: baseOpportunity,
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
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

    generateTextMock.mockResolvedValue({
      text: "Drafted narrative paragraphs.",
      usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "funding_opportunity_narrative_drafts") {
          return { insert: draftInsertMock };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when the user is not authenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(draftInsertMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid opportunity id", async () => {
    const response = await postNarrativeDraft(jsonRequest(), routeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid funding opportunity id" });
  });

  it("returns 404 when the RLS-scoped lookup finds no opportunity (non-member)", async () => {
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: null,
      membership: null,
      error: null,
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Funding opportunity not found" });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(draftInsertMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the member lacks write access", async () => {
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: baseOpportunity,
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Workspace access denied" });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns a typed 503 ai_offline error when ANTHROPIC_API_KEY is empty", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "   ");

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ai_offline" });
    expect(loadFundingOpportunityAccessMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(draftInsertMock).not.toHaveBeenCalled();
  });

  it("generates, persists, and returns the narrative draft on the happy path", async () => {
    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      draft: {
        id: DRAFT_ID,
        opportunity_id: OPPORTUNITY_ID,
        draft_markdown: "Drafted narrative paragraphs.",
        model: "claude-opus-4-8",
        source: "ai",
      },
      usage: {
        inputTokens: 1200,
        outputTokens: 800,
        totalTokens: 2000,
        // 1200/1M * $5 + 800/1M * $25 for claude-opus-4-8
        estimatedCostUsd: 0.026,
      },
    });

    // The generation call uses the configured default model and a grounded prompt.
    expect(anthropicMock).toHaveBeenCalledWith("claude-opus-4-8");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const generationArgs = generateTextMock.mock.calls[0][0] as { system: string; prompt: string };
    expect(generationArgs.prompt).toContain("2027 ATP countywide active transportation call");
    expect(generationArgs.prompt).toContain("Do not invent numbers");
    expect(generationArgs.prompt).toContain(GRANT_MODELING_PLANNING_CAVEAT);
    expect(generationArgs.prompt).toContain("No project is linked to this opportunity.");

    // The draft is persisted with the migration's exact columns.
    expect(draftInsertMock).toHaveBeenCalledWith({
      workspace_id: WORKSPACE_ID,
      opportunity_id: OPPORTUNITY_ID,
      draft_markdown: "Drafted narrative paragraphs.",
      model: "claude-opus-4-8",
      source: "ai",
      created_by: USER_ID,
    });
  });

  it("respects the OPENPLAN_GRANTS_AI_MODEL override", async () => {
    vi.stubEnv("OPENPLAN_GRANTS_AI_MODEL", "claude-haiku-4-5");
    draftSingleMock.mockResolvedValue({
      data: {
        id: DRAFT_ID,
        opportunity_id: OPPORTUNITY_ID,
        draft_markdown: "Drafted narrative paragraphs.",
        model: "claude-haiku-4-5",
        source: "ai",
        created_at: "2026-07-17T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(201);
    expect(anthropicMock).toHaveBeenCalledWith("claude-haiku-4-5");
    expect(draftInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5" })
    );
  });

  it("returns 502 without persisting a fake draft when generation fails", async () => {
    generateTextMock.mockRejectedValue(new Error("model unavailable"));

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "narrative_generation_failed" });
    expect(draftInsertMock).not.toHaveBeenCalled();
  });

  it("returns 502 without persisting when generation produces empty text", async () => {
    generateTextMock.mockResolvedValue({ text: "   ", usage: { inputTokens: 10, outputTokens: 0 } });

    const response = await postNarrativeDraft(jsonRequest(), routeContext());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "narrative_generation_failed" });
    expect(draftInsertMock).not.toHaveBeenCalled();
  });
});
