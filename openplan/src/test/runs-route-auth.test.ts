import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const runsGetLimitMock = vi.fn();
const runsGetOrderMock = vi.fn(() => ({ limit: runsGetLimitMock }));
const runsGetEqMock = vi.fn(() => ({ order: runsGetOrderMock }));
const runsGetSelectMock = vi.fn(() => ({ eq: runsGetEqMock }));

const runsDeleteLookupMaybeSingleMock = vi.fn();
const runsDeleteLookupEqMock = vi.fn(() => ({ maybeSingle: runsDeleteLookupMaybeSingleMock }));
const runsDeleteLookupSelectMock = vi.fn(() => ({ eq: runsDeleteLookupEqMock }));

// `.delete().eq().select().maybeSingle()` — the `.select()` is what makes zero
// rows visible at all; without it PostgREST reports the same `{data: null,
// error: null}` for a deletion and for a refusal.
const runsDeleteMaybeSingleMock = vi.fn();
const runsDeleteSelectMock = vi.fn(() => ({ maybeSingle: runsDeleteMaybeSingleMock }));
const runsDeleteEqMock = vi.fn(() => ({ select: runsDeleteSelectMock }));
const runsDeleteMock = vi.fn(() => ({ eq: runsDeleteEqMock }));

const runsUpdateSelectMock = vi.fn();
const runsUpdateEqMock = vi.fn(() => ({ select: runsUpdateSelectMock }));
const runsUpdateMock = vi.fn(() => ({ eq: runsUpdateEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  if (table === "runs") {
    return {
      select: (fields: string) => {
        if (fields.includes("title") || fields.includes("summary_text")) {
          return runsGetSelectMock();
        }
        return runsDeleteLookupSelectMock();
      },
      delete: runsDeleteMock,
      update: runsUpdateMock,
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

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

import { GET as getRuns, DELETE as deleteRun, PATCH as patchRun } from "@/app/api/runs/route";

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function patchRequest(body: unknown = { id: RUN_ID, mapViewState: { showTracts: true } }) {
  return new NextRequest("http://localhost/api/runs", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/runs auth + membership guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "member" },
      error: null,
    });

    runsGetLimitMock.mockResolvedValue({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          title: "Sample run",
        },
      ],
      error: null,
    });

    runsDeleteLookupMaybeSingleMock.mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspace_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });

    runsDeleteMaybeSingleMock.mockResolvedValue({
      data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      error: null,
    });

    runsUpdateSelectMock.mockResolvedValue({
      data: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      error: null,
    });
  });

  it("GET returns 400 when limit is invalid", async () => {
    const response = await getRuns(
      new NextRequest(
        "http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111&limit=0"
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid limit" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("GET returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(401);
  });

  it("GET returns 403 when workspace membership is missing", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("GET returns 403 when workspace role is unsupported (deny-by-default)", async () => {
    // "viewer" became a real read-capable role; an unknown string still denies.
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "auditor" },
      error: null,
    });

    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("GET returns 200 when user is a workspace member", async () => {
    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runs: expect.any(Array) });
    expect(runsGetLimitMock).toHaveBeenCalledWith(50);
  });

  /**
   * WHICH ROW THE MEMBERSHIP CHECK READS IS THE CHECK.
   *
   * Every membership assertion above drives a double that answers a member row
   * no matter what it was asked for, so the tests could not tell a query scoped
   * to (this workspace, this user) from one scoped to neither. Mutation proved
   * it: replacing `.eq("user_id", user.id)` with `.eq("role", "member")` — which
   * makes ANY authenticated caller a member of ANY workspace they name — left
   * all eighteen tests in this file green, and five sibling guards with it.
   * The columns and the values are therefore asserted here directly.
   */
  it("GET scopes the membership lookup to this workspace AND this user", async () => {
    const response = await getRuns(
      new NextRequest(`http://localhost/api/runs?workspaceId=${WORKSPACE_ID}`)
    );

    expect(response.status).toBe(200);
    expect(membershipEqWorkspaceMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(membershipEqUserMock).toHaveBeenCalledWith("user_id", USER_ID);
  });

  /**
   * And which rows come back is the tenancy boundary itself. `.eq("id", …)` in
   * place of `.eq("workspace_id", …)` returns another workspace's runs to a
   * caller who passed every access check — a mutation the shape assertions
   * above (`runs: expect.any(Array)`) cannot see.
   */
  it("GET asks the database only for runs belonging to the requested workspace", async () => {
    const response = await getRuns(
      new NextRequest(`http://localhost/api/runs?workspaceId=${WORKSPACE_ID}`)
    );

    expect(response.status).toBe(200);
    expect(runsGetEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(runsGetEqMock).not.toHaveBeenCalledWith("id", WORKSPACE_ID);
  });

  it("GET uses a caller-provided limit when supplied", async () => {
    const response = await getRuns(
      new NextRequest(
        "http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111&limit=10"
      )
    );

    expect(response.status).toBe(200);
    expect(runsGetLimitMock).toHaveBeenCalledWith(10);
  });

  it("DELETE returns 400 when explicit confirmation is missing", async () => {
    const response = await deleteRun(
      new NextRequest("http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
        method: "DELETE",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Run deletion requires explicit confirmation",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("DELETE returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await deleteRun(
      new NextRequest(
        "http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&confirm=true",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(401);
  });

  it("DELETE returns 404 when run does not exist", async () => {
    runsDeleteLookupMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await deleteRun(
      new NextRequest(
        "http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&confirm=true",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Run not found" });
  });

  it("DELETE returns 403 when user is not a workspace member", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await deleteRun(
      new NextRequest(
        "http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&confirm=true",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("DELETE returns 403 for the read-only viewer role", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "viewer" },
      error: null,
    });

    const response = await deleteRun(
      new NextRequest(
        "http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&confirm=true",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("DELETE returns 200 when user is authorized", async () => {
    const response = await deleteRun(
      new NextRequest(
        "http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&confirm=true",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    // A deletion that leaves no trace is the half of the audit trail nothing was
    // guarding: the zero-row FAILURE path below asserts its audit line, while
    // deleting `audit.info("run_deleted", …)` outright left this file green.
    // The case that actually happened is the one an agency has to be able to
    // reconstruct.
    expect(mockAudit.info).toHaveBeenCalledWith(
      "run_deleted",
      expect.objectContaining({ runId: RUN_ID, workspaceId: WORKSPACE_ID, userId: USER_ID })
    );
  });

  /**
   * "Deleted" must mean deleted.
   *
   * This route answered `200 { success: true }` for a run it did not remove,
   * because `.delete().eq()` alone cannot distinguish one row removed from none.
   * A planner deleting a run is usually deleting one they must not keep, so a
   * false assurance here is worse than an error: they stop looking.
   */
  it("DELETE refuses to report success when the delete matched no rows", async () => {
    runsDeleteMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await deleteRun(
      new NextRequest(
        "http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&confirm=true",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; details: string; success?: boolean };
    expect(body.success).toBeUndefined();
    expect(body.error).toBe("The run was not saved");
    expect(body.details).toMatch(/row-level security/i);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "run_delete_matched_no_rows",
      expect.objectContaining({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
    );
    expect(mockAudit.info).not.toHaveBeenCalledWith("run_deleted", expect.anything());
  });

  it("DELETE treats PGRST116 as zero rows rather than a delete failure", async () => {
    runsDeleteMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "no rows returned" },
    });

    const response = await deleteRun(
      new NextRequest(
        "http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&confirm=true",
        { method: "DELETE" }
      )
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "The run was not saved" });
    expect(mockAudit.error).not.toHaveBeenCalledWith("delete_failed", expect.anything());
  });

  /**
   * PATCH had a test file of its own (`runs-update-route.test.ts`) but no
   * coverage in THIS one, which is about auth and membership — so the role
   * matrix was never applied to it. The row-counting regression lives in that
   * other file, next to the assertion it corrects.
   */
  it("PATCH returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await patchRun(patchRequest());

    expect(response.status).toBe(401);
    expect(runsUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 when the run does not exist", async () => {
    runsDeleteLookupMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await patchRun(patchRequest());

    expect(response.status).toBe(404);
    expect(runsUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH returns 403 for the read-only viewer role", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "viewer" },
      error: null,
    });

    const response = await patchRun(patchRequest());

    expect(response.status).toBe(403);
    expect(runsUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH returns 200 for an authorized member", async () => {
    const response = await patchRun(patchRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(runsUpdateEqMock).toHaveBeenCalledWith("id", RUN_ID);
  });
});
