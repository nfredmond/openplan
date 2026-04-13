import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadAssistantContextMock = vi.fn();
const buildAssistantPreviewMock = vi.fn();

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

vi.mock("@/lib/assistant/respond", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assistant/respond")>("@/lib/assistant/respond");
  return {
    ...actual,
    buildAssistantPreview: (...args: unknown[]) => buildAssistantPreviewMock(...args),
  };
});

import { GET as getAssistantContext } from "@/app/api/assistant/context/route";

function request(url: string) {
  return new NextRequest(url);
}

describe("/api/assistant/context", () => {
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

    buildAssistantPreviewMock.mockReturnValue({
      title: "Nevada County workspace",
      summary: "Run release review on current RTP packets.",
      prompts: ["What needs attention?"],
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getAssistantContext(request("http://localhost/api/assistant/context?kind=workspace"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 400 for invalid assistant context queries", async () => {
    const response = await getAssistantContext(request("http://localhost/api/assistant/context?kind=not-real"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid assistant context query" });
  });

  it("returns 404 when no assistant context is found", async () => {
    loadAssistantContextMock.mockResolvedValueOnce(null);

    const response = await getAssistantContext(
      request(`http://localhost/api/assistant/context?kind=report&id=${REPORT_ID}&workspaceId=${WORKSPACE_ID}`)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Assistant context not found" });
  });

  it("returns preview data for a valid assistant context", async () => {
    const response = await getAssistantContext(
      request(`http://localhost/api/assistant/context?kind=report&id=${REPORT_ID}&workspaceId=${WORKSPACE_ID}`)
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
    expect(buildAssistantPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "workspace",
        workspace: expect.objectContaining({ id: WORKSPACE_ID }),
      })
    );
    expect(await response.json()).toMatchObject({
      contextKind: "workspace",
      preview: expect.objectContaining({
        title: "Nevada County workspace",
      }),
    });
  });

  it("returns 500 when assistant context loading throws", async () => {
    loadAssistantContextMock.mockRejectedValueOnce(new Error("context load failed"));

    const response = await getAssistantContext(request("http://localhost/api/assistant/context?kind=workspace"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "Unexpected error while loading assistant context",
    });
  });
});
