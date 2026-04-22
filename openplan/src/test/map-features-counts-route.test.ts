import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";

type CountResult = { count: number | null; error: { message: string; code?: string } | null };

function buildQueryChain(result: CountResult) {
  const chain: Record<string, unknown> & PromiseLike<CountResult> = {
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (onFulfilled?: (value: CountResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  } as never;
  return chain;
}

let projectsChain: ReturnType<typeof buildQueryChain>;
let aerialChain: ReturnType<typeof buildQueryChain>;
let corridorsChain: ReturnType<typeof buildQueryChain>;
let rtpChain: ReturnType<typeof buildQueryChain>;

const projectsSelectMock = vi.fn(() => projectsChain);
const aerialSelectMock = vi.fn(() => aerialChain);
const corridorsSelectMock = vi.fn(() => corridorsChain);
const rtpSelectMock = vi.fn(() => rtpChain);

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "projects") return { select: projectsSelectMock };
  if (table === "aerial_missions") return { select: aerialSelectMock };
  if (table === "project_corridors") return { select: corridorsSelectMock };
  if (table === "rtp_cycles") return { select: rtpSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>(
    "@/lib/workspaces/current"
  );
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) =>
      loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getCounts } from "@/app/api/map-features/counts/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/counts", { method: "GET" });
}

describe("GET /api/map-features/counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    projectsChain = buildQueryChain({ count: 0, error: null });
    aerialChain = buildQueryChain({ count: 0, error: null });
    corridorsChain = buildQueryChain({ count: 0, error: null });
    rtpChain = buildQueryChain({ count: 0, error: null });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns zero counts when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ projects: 0, aerial: 0, corridors: 0, rtp: 0 });
    expect(projectsSelectMock).not.toHaveBeenCalled();
    expect(aerialSelectMock).not.toHaveBeenCalled();
    expect(corridorsSelectMock).not.toHaveBeenCalled();
    expect(rtpSelectMock).not.toHaveBeenCalled();
  });

  it("returns live counts across all four layers when queries succeed", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    aerialChain = buildQueryChain({ count: 3, error: null });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: 1, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ projects: 1, aerial: 3, corridors: 2, rtp: 1 });
    expect(projectsSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(aerialSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(corridorsSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(rtpSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(mockAudit.info).toHaveBeenCalledWith(
      "map_feature_counts_loaded",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        counts: { projects: 1, aerial: 3, corridors: 2, rtp: 1 },
      })
    );
  });

  it("returns null for the failing layer and logs a partial-failure warning", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    aerialChain = buildQueryChain({ count: null, error: { message: "boom", code: "42P01" } });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: 1, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ projects: 1, aerial: null, corridors: 2, rtp: 1 });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "map_feature_counts_partial_failure",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        aerialError: "boom",
        projectsError: null,
        corridorsError: null,
        rtpError: null,
      })
    );
  });

  it("returns null for the rtp layer and logs a partial-failure warning when rtp_cycles fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    aerialChain = buildQueryChain({ count: 3, error: null });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: null, error: { message: "no anchor column", code: "42703" } });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ projects: 1, aerial: 3, corridors: 2, rtp: null });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "map_feature_counts_partial_failure",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        rtpError: "no anchor column",
        aerialError: null,
        projectsError: null,
        corridorsError: null,
      })
    );
  });

  it("coerces a null count from Supabase to 0 on the happy path", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: null, error: null });
    aerialChain = buildQueryChain({ count: null, error: null });
    corridorsChain = buildQueryChain({ count: null, error: null });
    rtpChain = buildQueryChain({ count: null, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ projects: 0, aerial: 0, corridors: 0, rtp: 0 });
    expect(mockAudit.warn).not.toHaveBeenCalled();
  });
});
