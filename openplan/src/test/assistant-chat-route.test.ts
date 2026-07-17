import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadAssistantContextMock = vi.fn();
const streamTextMock = vi.fn();
const anthropicMock = vi.fn((modelId: string) => ({ __modelId: modelId }));
const recordUsageEventBestEffortMock = vi.fn();

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
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (...args: unknown[]) => anthropicMock(...(args as [string])),
}));

vi.mock("@/lib/billing/usage-recording", () => ({
  recordUsageEventBestEffort: (...args: unknown[]) => recordUsageEventBestEffortMock(...args),
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
    recordUsageEventBestEffortMock.mockResolvedValue(undefined);
    streamTextMock.mockReturnValue({
      toTextStreamResponse: () =>
        new Response("Grounded reply", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
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
    expect(recordUsageEventBestEffortMock).not.toHaveBeenCalled();
  });

  it("streams a grounded reply on the happy path", async () => {
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
    expect(await response.text()).toBe("Grounded reply");

    expect(loadAssistantContextMock).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ kind: "workspace", workspaceId: WORKSPACE_ID })
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const callArgs = streamTextMock.mock.calls[0][0] as {
      model: { __modelId: string };
      system: string;
      messages: Array<{ role: string; content: string }>;
      maxOutputTokens: number;
    };

    expect(callArgs.model).toEqual({ __modelId: "claude-opus-4-8" });
    expect(callArgs.system).toContain("Workspace: Foothill COG");
    expect(callArgs.system).toContain("Never invent workspace data.");
    expect(callArgs.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello, planner." },
      { role: "user", content: "Where should I focus this week?" },
    ]);
    expect(callArgs.maxOutputTokens).toBeGreaterThan(0);
  });

  it("records an assistant_chat usage event before streaming", async () => {
    await postAssistantChat(
      jsonRequest({ kind: "workspace", workspaceId: WORKSPACE_ID, question: "Where should I focus this week?" })
    );

    expect(recordUsageEventBestEffortMock).toHaveBeenCalledTimes(1);
    expect(recordUsageEventBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        eventKey: "assistant_chat",
        bucketKey: "assistant_chat",
        sourceRoute: "/api/assistant/chat",
      }),
      mockAudit
    );
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
