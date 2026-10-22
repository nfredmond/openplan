import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadAssistantContextMock = vi.fn();
const streamTextMock = vi.fn();
const stepCountIsMock = vi.fn((count: number) => ({ __stepCountIs: count }));
const anthropicMock = vi.fn((modelId: string) => ({ __modelId: modelId }));
const reserveAiUsageMock = vi.fn();
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
let uiStreamResponseOptions: Record<string, unknown> | null = null;

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
  wrapLanguageModel: ({ model }: { model: unknown }) => model,
}));

vi.mock("@/lib/assistant/chat-tools", () => ({
  buildAssistantChatTools: (...args: unknown[]) => buildAssistantChatToolsMock(...args),
  createChatToolBudget: (...args: unknown[]) => createChatToolBudgetMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (...args: unknown[]) => anthropicMock(...(args as [string])),
  createAnthropic: () => (...args: unknown[]) => anthropicMock(...(args as [string])),
}));

vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  reserveAiUsage: (...args: unknown[]) => reserveAiUsageMock(...args),
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
    reserveAiUsageMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    budgetFixture = freshBudgetFixture();
    createChatToolBudgetMock.mockReturnValue(budgetFixture);
    buildAssistantChatToolsMock.mockReturnValue({
      list_projects: { description: "stub tool" },
      propose_generate_report_artifact: { description: "stub proposal tool" },
    });
    uiStreamResponseOptions = null;
    streamTextMock.mockReturnValue({
      toUIMessageStreamResponse: (options?: Record<string, unknown>) => {
        uiStreamResponseOptions = options ?? null;
        return new Response("data: {\"type\":\"start\"}\n\ndata: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
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
    // The context IS loaded first: the offline gate runs inside the
    // workspace-integration scope so a workspace's own key counts as access.
    expect(loadAssistantContextMock).toHaveBeenCalled();
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
      system: { role: string; content: string; providerOptions: unknown };
      messages: Array<{ role: string; content: string }>;
      maxOutputTokens: number;
      tools: Record<string, unknown>;
      stopWhen: { __stepCountIs: number };
    };

    expect(callArgs.model).toEqual({ __modelId: "claude-opus-5-5" });
    expect(callArgs.system.role).toBe("system");
    expect(callArgs.system.content).toContain("Workspace: Foothill COG");
    expect(callArgs.system.content).toContain("Never invent workspace data.");
    // The tool definitions and system prompt are cached across the steps of
    // one question; without this every step pays full input price for them.
    expect(callArgs.system.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
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

  it("tells the model today's date, read from the clock when the question arrives", async () => {
    // A live test on 2026-10-11 called a call that closed 2026-09-30 "still
    // open for about three more weeks": the prompt carried no date at all.
    // Two different clocks must give two different dates, so a hardcoded or
    // build-time date cannot pass.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const [now, expected] of [
        ["2026-10-11T23:30:00Z", "2026-10-11"],
        ["2027-03-02T00:10:00Z", "2027-03-02"],
      ] as const) {
        vi.setSystemTime(new Date(now));
        streamTextMock.mockClear();
        await postAssistantChat(
          jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "What is due soon?" })
        );
        const callArgs = streamTextMock.mock.calls[0][0] as { system: { content: string } };
        expect(callArgs.system.content).toContain(`TODAY: ${expected} (UTC calendar date).`);
      }
    } finally {
      vi.useRealTimers();
    }
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

  it("counts the chat call before the model is called, not when the stream finishes", async () => {
    // The provider bills a stream the planner closes mid-reply. Counting on
    // finish left those calls out of the workspace's allowance.
    reserveAiUsageMock.mockImplementation(async () => {
      expect(streamTextMock).not.toHaveBeenCalled();
      return { allowed: true, count: 0, retryAfterSeconds: 0 };
    });

    await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    expect(reserveAiUsageMock).toHaveBeenCalledTimes(1);
    expect(reserveAiUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        bucketKey: "assistant_chat",
        eventKey: "assistant_chat_reply",
        sourceRoute: "/api/assistant/chat",
      })
    );
    expect(streamTextMock).toHaveBeenCalledTimes(1);

    // Finishing the stream records nothing more.
    const callArgs = streamTextMock.mock.calls[0][0] as {
      onFinish: (event: { usage?: { inputTokens?: number; outputTokens?: number } }) => void;
    };
    callArgs.onFinish({ usage: { inputTokens: 10, outputTokens: 20 } });
    expect(reserveAiUsageMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the model when usage cannot be metered", async () => {
    reserveAiUsageMock.mockRejectedValue(new Error("usage_events unavailable"));

    const response = await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    expect(response.status).toBe(500);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 429 with retry-after when the workspace AI allowance is exhausted", async () => {
    reserveAiUsageMock.mockResolvedValue({ allowed: false, count: 20, retryAfterSeconds: 300 });

    const response = await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("annotates the finish frame with a cost-threshold warning only when exceeded", async () => {
    await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    const messageMetadata = uiStreamResponseOptions?.messageMetadata as (options: {
      part: { type: string; totalUsage?: { inputTokens?: number; outputTokens?: number } };
    }) => unknown;
    expect(typeof messageMetadata).toBe("function");

    // Heavy call on the Opus 5.5 default ($0.60) exceeds the $0.50 threshold.
    expect(
      messageMetadata({ part: { type: "finish", totalUsage: { inputTokens: 100_000, outputTokens: 10_000 } } })
    ).toEqual({
      costWarning: { thresholdKind: "single_call", thresholdUsd: 0.5, estimatedCostUsd: 0.6 },
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "assistant_chat_cost_threshold_exceeded",
      expect.objectContaining({ estimatedCostUsd: 0.6, workspaceId: WORKSPACE_ID })
    );

    // Small calls and non-finish parts carry no metadata.
    expect(
      messageMetadata({ part: { type: "finish", totalUsage: { inputTokens: 1_000, outputTokens: 500 } } })
    ).toBeUndefined();
    expect(messageMetadata({ part: { type: "start" } })).toBeUndefined();
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

  describe("today's date in the planner's time zone", () => {
    // At 00:30 UTC on Oct 12 it is still the evening of Oct 11 in the
    // Americas and already midday Oct 12 in East Asia. The route must use the
    // zone the browser sends, so two zones give two dates.
    const NOW = "2026-10-12T00:30:00Z";

    async function systemPromptFor(timeZone: unknown): Promise<string> {
      streamTextMock.mockClear();
      await postAssistantChat(
        jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "What is due today?", timeZone })
      );
      const system = (streamTextMock.mock.calls[0][0] as { system: string | { content: string } }).system;
      return typeof system === "string" ? system : system.content;
    }

    it("dates the prompt in the zone the browser reports", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(NOW));
        expect(await systemPromptFor("America/Los_Angeles")).toContain(
          "TODAY: 2026-10-11 (calendar date in America/Los_Angeles, the planner's time zone)."
        );
        expect(await systemPromptFor("Asia/Tokyo")).toContain(
          "TODAY: 2026-10-12 (calendar date in Asia/Tokyo, the planner's time zone)."
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("falls back to the UTC date for a zone Intl rejects, without quoting it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(NOW));
        const prompt = await systemPromptFor("Mars/Olympus_Mons");
        expect(prompt).toContain("TODAY: 2026-10-12 (UTC calendar date).");
        expect(prompt).toContain("may still be open where the planner is");
        expect(prompt).not.toContain("Mars/Olympus_Mons");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("today's date in the workspace's time zone", () => {
    // 00:30 UTC Oct 12 is 5:30 p.m. Oct 11 in Los Angeles and 9:30 a.m.
    // Oct 12 in Tokyo. A workspace that recorded its zone is dated in it,
    // whatever zone the browser reports.
    const NOW = "2026-10-12T00:30:00Z";
    const workspaceSelects: string[] = [];
    const workspaceFilters: Array<[string, unknown]> = [];

    function clientWithWorkspaceZone(timeZone: string | null) {
      createClientMock.mockResolvedValue({
        auth: { getUser: (...args: unknown[]) => authGetUserMock(...args) },
        from: (table: string) => {
          if (table !== "workspaces") throw new Error(`Unexpected table ${table}`);
          return {
            select: (columns: string) => {
              workspaceSelects.push(columns);
              return {
                eq: (column: string, value: unknown) => {
                  workspaceFilters.push([column, value]);
                  return { maybeSingle: async () => ({ data: { time_zone: timeZone, home_country_code: "US" }, error: null }) };
                },
              };
            },
          };
        },
      });
    }

    async function systemPrompt(browserZone: string): Promise<string> {
      streamTextMock.mockClear();
      await postAssistantChat(
        jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "What is due today?", timeZone: browserZone })
      );
      const system = (streamTextMock.mock.calls[0][0] as { system: string | { content: string } }).system;
      return typeof system === "string" ? system : system.content;
    }

    beforeEach(() => {
      workspaceSelects.length = 0;
      workspaceFilters.length = 0;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(NOW));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("dates the prompt in the workspace's zone ahead of the browser's", async () => {
      clientWithWorkspaceZone("America/Los_Angeles");
      expect(await systemPrompt("Asia/Tokyo")).toContain(
        "TODAY: 2026-10-11 (calendar date in America/Los_Angeles, the workspace's time zone)."
      );
      expect(workspaceSelects).toEqual(["time_zone, home_country_code"]);
      expect(workspaceFilters).toEqual([["id", WORKSPACE_ID]]);
      const toolArgs = buildAssistantChatToolsMock.mock.calls.at(-1)?.[0] as { timeZone?: string | null } | undefined;
      expect(toolArgs?.timeZone).toBe("America/Los_Angeles");
    });

    it("uses the browser's zone when the workspace has none", async () => {
      clientWithWorkspaceZone(null);
      expect(await systemPrompt("Asia/Tokyo")).toContain(
        "TODAY: 2026-10-12 (calendar date in Asia/Tokyo, the planner's time zone)."
      );
    });
  });
});
