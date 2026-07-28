import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadAssistantContextMock = vi.fn();
const streamTextMock = vi.fn();
const stepCountIsMock = vi.fn((count: number) => ({ __stepCountIs: count }));
const anthropicMock = vi.fn((modelId: string) => ({ __modelId: modelId }));
const checkAiUsageRateLimitMock = vi.fn();
const recordAiUsageEventMock = vi.fn();
const buildAssistantChatToolsMock = vi.fn();
const createChatToolBudgetMock = vi.fn();

type BudgetFixture = {
  maxCalls: number;
  maxKnowledgeBaseSearches: number;
  usedCalls: number;
  usedKnowledgeBaseSearches: number;
  ledger: Array<{ toolCallId: string; tool: string; ok: boolean; durationMs: number }>;
};

function freshBudgetFixture(): BudgetFixture {
  return { maxCalls: 12, maxKnowledgeBaseSearches: 3, usedCalls: 0, usedKnowledgeBaseSearches: 0, ledger: [] };
}

let budgetFixture: BudgetFixture = freshBudgetFixture();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

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

vi.mock("@/lib/assistant/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assistant/context")>("@/lib/assistant/context");
  return {
    ...actual,
    loadAssistantContext: (...args: unknown[]) => loadAssistantContextMock(...args),
  };
});

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  stepCountIs: (...args: unknown[]) => stepCountIsMock(...(args as [number])),
}));

vi.mock("@/lib/assistant/chat-tools", () => ({
  buildAssistantChatTools: (...args: unknown[]) => buildAssistantChatToolsMock(...args),
  createChatToolBudget: (...args: unknown[]) => createChatToolBudgetMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (...args: unknown[]) => anthropicMock(...(args as [string])),
}));

vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  checkAiUsageRateLimit: (...args: unknown[]) => checkAiUsageRateLimitMock(...args),
  recordAiUsageEvent: (...args: unknown[]) => recordAiUsageEventMock(...args),
}));

import { POST as postAssistantChat } from "@/app/api/assistant/chat/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function workspaceContextFixture() {
  return {
    kind: "workspace",
    workspace: { id: WORKSPACE_ID, name: "Foothill COG", plan: "pro", role: "admin" },
    recentProject: null,
    recentRuns: [],
    currentRun: null,
    baselineRun: null,
    operationsSummary: {
      posture: "stable",
      headline: "Workspace is steady.",
      detail: "No urgent pressure.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 0,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 0,
        rtpFundingReviewPackets: 0,
        comparisonBackedReports: 0,
        fundingOpportunities: 0,
        openFundingOpportunities: 0,
        closingSoonFundingOpportunities: 0,
        overdueDecisionFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 0,
        aerialMissions: 0,
        aerialActiveMissions: 0,
        aerialReadyPackages: 0,
      },
      nextCommand: null,
      commandQueue: [],
      fullCommandQueue: [],
    },
  };
}

describe("/api/assistant/chat", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalModelOverride = process.env.OPENPLAN_ASSISTANT_MODEL;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.OPENPLAN_ASSISTANT_MODEL;

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: (...args: unknown[]) => authGetUserMock(...args) },
    });
    loadAssistantContextMock.mockResolvedValue(workspaceContextFixture());
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    recordAiUsageEventMock.mockResolvedValue(undefined);
    budgetFixture = freshBudgetFixture();
    createChatToolBudgetMock.mockReturnValue(budgetFixture);
    buildAssistantChatToolsMock.mockReturnValue({
      list_projects: { description: "stub tool" },
      propose_generate_report_artifact: { description: "stub proposal tool" },
    });
    streamTextMock.mockReturnValue({
      toUIMessageStreamResponse: () =>
        new Response("data: {\"type\":\"start\"}\n\ndata: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
    if (originalModelOverride === undefined) {
      delete process.env.OPENPLAN_ASSISTANT_MODEL;
    } else {
      process.env.OPENPLAN_ASSISTANT_MODEL = originalModelOverride;
    }
  });

  it("returns 401 when the user is not authenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "What should I do next?" })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the question is missing", async () => {
    const response = await postAssistantChat(jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid assistant chat request" });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns a typed 503 ai_offline error when ANTHROPIC_API_KEY is empty", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";

    const response = await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "What should I do next?" })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ai_offline" });
    expect(loadAssistantContextMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the RLS-scoped context lookup finds nothing (non-member)", async () => {
    loadAssistantContextMock.mockResolvedValue(null);

    const response = await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "What should I do next?" })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Assistant context not found" });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("streams a grounded UI-message reply with tools wired on the happy path", async () => {
    const response = await postAssistantChat(
      jsonRequest({
        kind: "workspace",
        workspaceId: WORKSPACE_ID,
        question: "Where should I focus this week?",
        history: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello, planner." },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("data:");

    expect(loadAssistantContextMock).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ kind: "workspace", workspaceId: WORKSPACE_ID })
    );

    // Tools are built from the user-session client with the loaded context and
    // the per-request budget — never a service client.
    expect(buildAssistantChatToolsMock).toHaveBeenCalledTimes(1);
    const toolsArgs = buildAssistantChatToolsMock.mock.calls[0][0] as {
      userId: string;
      budget: unknown;
      supabase: unknown;
    };
    expect(toolsArgs.userId).toBe(USER_ID);
    expect(toolsArgs.budget).toBe(budgetFixture);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const callArgs = streamTextMock.mock.calls[0][0] as {
      model: { __modelId: string };
      system: string;
      messages: Array<{ role: string; content: string }>;
      maxOutputTokens: number;
      tools: Record<string, unknown>;
      stopWhen: { __stepCountIs: number };
    };

    expect(callArgs.model).toEqual({ __modelId: "claude-opus-4-8" });
    expect(callArgs.system).toContain("Workspace: Foothill COG");
    expect(callArgs.system).toContain("Never invent workspace data.");
    expect(Object.keys(callArgs.tools)).toContain("list_projects");
    expect(Object.keys(callArgs.tools)).toContain("propose_generate_report_artifact");
    expect(callArgs.stopWhen).toEqual({ __stepCountIs: 6 });
    expect(stepCountIsMock).toHaveBeenCalledWith(6);
    expect(callArgs.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello, planner." },
      { role: "user", content: "Where should I focus this week?" },
    ]);
    expect(callArgs.maxOutputTokens).toBeGreaterThan(0);
  });

  it("drains the tool ledger into assistant_chat_tool_called audit events at each step boundary", async () => {
    await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    const callArgs = streamTextMock.mock.calls[0][0] as {
      onStepFinish: (step: Record<string, unknown>) => void;
    };

    budgetFixture.ledger.push(
      { toolCallId: "c1", tool: "list_projects", ok: true, durationMs: 12 },
      { toolCallId: "c2", tool: "search_knowledge_base", ok: false, durationMs: 40 }
    );
    callArgs.onStepFinish({});

    expect(mockAudit.info).toHaveBeenCalledWith(
      "assistant_chat_tool_called",
      expect.objectContaining({ tool: "list_projects", ok: true, durationMs: 12, workspaceId: WORKSPACE_ID })
    );
    expect(mockAudit.info).toHaveBeenCalledWith(
      "assistant_chat_tool_called",
      expect.objectContaining({ tool: "search_knowledge_base", ok: false, durationMs: 40 })
    );
    expect(budgetFixture.ledger).toHaveLength(0);

    // A later step only audits its own executions.
    const auditCallsBefore = mockAudit.info.mock.calls.filter(([event]) => event === "assistant_chat_tool_called").length;
    callArgs.onStepFinish({});
    const auditCallsAfter = mockAudit.info.mock.calls.filter(([event]) => event === "assistant_chat_tool_called").length;
    expect(auditCallsAfter).toBe(auditCallsBefore);
  });

  it("records an assistant_chat usage event when the stream finishes (not before)", async () => {
    await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    // Nothing recorded yet — the model call has not completed, so an aborted
    // or failed stream is never counted against the workspace.
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();

    const callArgs = streamTextMock.mock.calls[0][0] as {
      onFinish: (event: { usage?: { inputTokens?: number; outputTokens?: number } }) => void;
    };
    callArgs.onFinish({ usage: { inputTokens: 10, outputTokens: 20 } });

    expect(recordAiUsageEventMock).toHaveBeenCalledTimes(1);
    expect(recordAiUsageEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        bucketKey: "assistant_chat",
        eventKey: "assistant_chat_reply",
        sourceRoute: "/api/assistant/chat",
      })
    );
  });

  it("returns 429 with retry-after when the workspace AI allowance is exhausted", async () => {
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 300 });

    const response = await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });

  it("respects the OPENPLAN_ASSISTANT_MODEL override", async () => {
    process.env.OPENPLAN_ASSISTANT_MODEL = "claude-haiku-4-5";

    await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    const callArgs = streamTextMock.mock.calls[0][0] as { model: { __modelId: string } };
    expect(callArgs.model).toEqual({ __modelId: "claude-haiku-4-5" });
  });

  it("returns 500 when streamText setup throws", async () => {
    streamTextMock.mockImplementation(() => {
      throw new Error("provider exploded");
    });

    const response = await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unexpected error while streaming assistant chat reply" });
  });
});
