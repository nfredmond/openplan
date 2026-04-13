import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadAssistantContextMock = vi.fn();
const resolveAssistantWorkflowIdMock = vi.fn();
const buildAssistantResponseMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";

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

vi.mock("@/lib/assistant/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assistant/catalog")>("@/lib/assistant/catalog");
  return {
    ...actual,
    resolveAssistantWorkflowId: (...args: unknown[]) => resolveAssistantWorkflowIdMock(...args),
  };
});

vi.mock("@/lib/assistant/respond", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assistant/respond")>("@/lib/assistant/respond");
  return {
    ...actual,
    buildAssistantResponse: (...args: unknown[]) => buildAssistantResponseMock(...args),
  };
});

import { POST as postAssistant } from "@/app/api/assistant/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
        },
      },
    });

    loadAssistantContextMock.mockResolvedValue({
      kind: "workspace",
      workspace: {
        id: WORKSPACE_ID,
      },
    });

    resolveAssistantWorkflowIdMock.mockReturnValue("workspace-overview");
    buildAssistantResponseMock.mockReturnValue({
      title: "Workspace overview",
      summary: "Run release review on current RTP packets.",
      findings: ["One current RTP packet still needs funding-backed release review."],
      nextSteps: ["Open the release review queue."],
      evidence: [],
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postAssistant(jsonRequest({ kind: "workspace" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 400 for invalid assistant requests", async () => {
    const response = await postAssistant(jsonRequest({ kind: "not-real" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid assistant request" });
  });

  it("returns 404 when no assistant context is found", async () => {
    loadAssistantContextMock.mockResolvedValueOnce(null);

    const response = await postAssistant(
      jsonRequest({
        kind: "report",
        id: REPORT_ID,
        workspaceId: WORKSPACE_ID,
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Assistant context not found" });
  });

  it("returns an assistant response for a valid request", async () => {
    const response = await postAssistant(
      jsonRequest({
        kind: "report",
        id: REPORT_ID,
        workspaceId: WORKSPACE_ID,
        workflowId: "report-release-review",
        question: "What should move next?",
        localConsoleState: null,
      })
    );

    expect(response.status).toBe(200);
    expect(loadAssistantContextMock).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        kind: "report",
        id: REPORT_ID,
        workspaceId: WORKSPACE_ID,
        runId: null,
        baselineRunId: null,
      })
    );
    expect(resolveAssistantWorkflowIdMock).toHaveBeenCalledWith(
      "workspace",
      "report-release-review",
      "What should move next?"
    );
    expect(buildAssistantResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "workspace",
        workspace: expect.objectContaining({ id: WORKSPACE_ID }),
      }),
      "workspace-overview",
      "What should move next?",
      null
    );
    expect(await response.json()).toMatchObject({
      contextKind: "workspace",
      response: expect.objectContaining({
        title: "Workspace overview",
      }),
    });
  });

  it("returns 500 when assistant response building throws", async () => {
    buildAssistantResponseMock.mockImplementationOnce(() => {
      throw new Error("response build failed");
    });

    const response = await postAssistant(jsonRequest({ kind: "workspace" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "Unexpected error while building assistant response",
    });
  });
});
