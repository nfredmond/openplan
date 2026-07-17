import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const executionsLimitMock = vi.fn();
const executionsOrderMock = vi.fn(() => ({ limit: executionsLimitMock }));
const executionsEqMock = vi.fn(() => ({ order: executionsOrderMock }));
const executionsSelectMock = vi.fn(() => ({ eq: executionsEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "assistant_action_executions") {
    return { select: executionsSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>("@/lib/workspaces/current");
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getAssistantActivity } from "@/app/api/assistant-activity/route";

function activityRequest(query = "") {
  return new NextRequest(`http://localhost/api/assistant-activity${query}`);
}

const SUCCEEDED_EXECUTION = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspace_id: WORKSPACE_ID,
  user_id: USER_ID,
  action_kind: "generate_report_artifact",
  audit_event: "planner_agent.generate_report_artifact",
  approval: "safe",
  regrounding: "refresh_preview",
  outcome: "succeeded",
  error_message: null,
  input_summary: { reportId: "report-1" },
  input_hash: "abc123def4567890",
  approval_id: null,
  execution_source: "planner_agent_quick_link",
  started_at: "2026-07-16T18:00:00.000Z",
  completed_at: "2026-07-16T18:00:01.000Z",
};

const FAILED_EXECUTION = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspace_id: WORKSPACE_ID,
  user_id: USER_ID,
  action_kind: "create_funding_opportunity",
  audit_event: "planner_agent.create_funding_opportunity",
  approval: "approval_required",
  regrounding: "none",
  outcome: "failed",
  error_message: "Funding opportunity insert failed",
  input_summary: null,
  input_hash: "fed987cba6543210",
  approval_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  execution_source: "planner_agent_quick_link",
  started_at: "2026-07-16T17:00:00.000Z",
  completed_at: "2026-07-16T17:00:02.000Z",
};

describe("/api/assistant-activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: USER_ID },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: WORKSPACE_ID,
        role: "member",
        workspaces: {
          name: "Primary workspace",
          plan: "pilot",
          created_at: "2026-04-12T18:00:00.000Z",
        },
      },
      workspace: {
        name: "Primary workspace",
        plan: "pilot",
        created_at: "2026-04-12T18:00:00.000Z",
      },
    });

    executionsLimitMock.mockResolvedValue({
      data: [SUCCEEDED_EXECUTION, FAILED_EXECUTION],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when the request is unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getAssistantActivity(activityRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the limit filter exceeds the cap", async () => {
    const response = await getAssistantActivity(activityRequest("?limit=500"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid filters" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns an empty ledger for authenticated users without workspace membership", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: undefined, workspace: null });

    const response = await getAssistantActivity(activityRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      executions: [],
      summary: {
        total: 0,
        byOutcome: {},
        byActionKind: {},
        approvalGated: 0,
        failed: 0,
      },
      workspace: null,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns workspace-scoped executions with the activity summary", async () => {
    const response = await getAssistantActivity(activityRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      executions: [
        expect.objectContaining({
          id: SUCCEEDED_EXECUTION.id,
          action_kind: "generate_report_artifact",
          outcome: "succeeded",
          input_hash: "abc123def4567890",
        }),
        expect.objectContaining({
          id: FAILED_EXECUTION.id,
          action_kind: "create_funding_opportunity",
          approval: "approval_required",
          outcome: "failed",
          error_message: "Funding opportunity insert failed",
        }),
      ],
      summary: {
        total: 2,
        byOutcome: { succeeded: 1, failed: 1 },
        byActionKind: {
          generate_report_artifact: 1,
          create_funding_opportunity: 1,
        },
        approvalGated: 1,
        failed: 1,
      },
      workspace: {
        id: WORKSPACE_ID,
        name: "Primary workspace",
      },
    });

    expect(executionsEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(executionsOrderMock).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(executionsLimitMock).toHaveBeenCalledWith(50);
  });

  it("honors an explicit limit within the cap", async () => {
    const response = await getAssistantActivity(activityRequest("?limit=200"));

    expect(response.status).toBe(200);
    expect(executionsLimitMock).toHaveBeenCalledWith(200);
  });

  it("returns 500 when the executions query fails", async () => {
    executionsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied", code: "42501" },
    });

    const response = await getAssistantActivity(activityRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to load assistant activity" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "assistant_activity_list_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID })
    );
  });
});
