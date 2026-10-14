import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const ingestMock = vi.fn();
const membershipSelectMock = vi.fn();
const membershipEqMock = vi.fn();
const rpcMock = vi.fn();
const integrationContextMock = vi.fn();

type MembershipRow = { workspace_id: string; role: string; workspaces: { name: string; created_at: string } };
type MembershipRead = { data: MembershipRow[] | null; error: { message: string } | null };
type RpcReply = { data: unknown; error: { message: string } | null };

let membershipRead: MembershipRead;
let rpcReply: RpcReply;

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => ({
      select: (columns: string) => {
        membershipSelectMock(table, columns);
        return {
          eq: (column: string, value: string) => {
            membershipEqMock(column, value);
            return Promise.resolve(membershipRead);
          },
        };
      },
    }),
  }),
  createServiceRoleClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcMock(fn, args);
      return Promise.resolve(rpcReply);
    },
  }),
}));

vi.mock("@/lib/integrations/workspace-keys", () => ({
  withWorkspaceIntegrationContext: async <T,>(workspaceId: string, run: () => Promise<T>) => {
    integrationContextMock(workspaceId);
    return run();
  },
}));

vi.mock("@/lib/data-sources/census-tract-ingest", () => ({
  ingestCensusTractsForCounty: (...args: unknown[]) => ingestMock(...args),
}));

import { POST } from "@/app/api/geographies/census-tracts/ingest/route";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function member(role: string): MembershipRead {
  return {
    data: [{ workspace_id: WORKSPACE_ID, role, workspaces: { name: "Synthetic", created_at: "2026-10-01T00:00:00Z" } }],
    error: null,
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/geographies/census-tracts/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const FRANKLIN = { counties: [{ stateFips: "39", countyFips: "049" }] };

describe("POST /api/geographies/census-tracts/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipRead = member("member");
    rpcReply = { data: { allowed: true, recent: 1, limit: 20, retryAfterSeconds: 0 }, error: null };
    ingestMock.mockResolvedValue({
      stateFips: "39",
      countyFips: "049",
      status: "ingested",
      tractsUpserted: 328,
      unmatched: 0,
      error: null,
    });
  });

  it("400s on malformed JSON", async () => {
    expect((await POST(request("{bad"))).status).toBe(400);
  });

  it("400s on a badly shaped county (state must be 2 digits, county 3)", async () => {
    expect((await POST(request({ counties: [{ stateFips: "6", countyFips: "57" }] }))).status).toBe(400);
    expect((await POST(request({ counties: [] }))).status).toBe(400);
  });

  it("401s when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect((await POST(request(FRANKLIN))).status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer before reserving or loading anything", async () => {
    membershipRead = member("viewer");
    const res = await POST(request(FRANKLIN));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Viewers have read-only access to this workspace");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown role, a person with no workspace and a failed membership read", async () => {
    membershipRead = member("auditor");
    expect((await POST(request(FRANKLIN))).status).toBe(403);
    membershipRead = { data: [], error: null };
    expect((await POST(request(FRANKLIN))).status).toBe(403);
    membershipRead = { data: null, error: { message: "boom" } };
    expect((await POST(request(FRANKLIN))).status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("lets a writer load, reserving for that person in that workspace first", async () => {
    const res = await POST(request(FRANKLIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tractsUpserted).toBe(328);
    expect(body.results).toHaveLength(1);

    // The role decision depends on these selected fields.
    expect(membershipSelectMock).toHaveBeenCalledWith("workspace_members", expect.stringMatching(/\bworkspace_id\b.*\brole\b/));
    expect(membershipEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(rpcMock).toHaveBeenCalledWith("reserve_census_tract_ingest", {
      p_user_id: "user-1",
      p_workspace_id: WORKSPACE_ID,
      p_counties: ["39049"],
      p_source_route: "/api/geographies/census-tracts/ingest",
    });
    expect(integrationContextMock).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(rpcMock.mock.invocationCallOrder[0]).toBeLessThan(ingestMock.mock.invocationCallOrder[0]!);
  });

  it("lets owners and admins load too", async () => {
    for (const role of ["owner", "admin"]) {
      membershipRead = member(role);
      expect((await POST(request(FRANKLIN))).status).toBe(200);
    }
  });

  it("429s with Retry-After when the person's hourly allowance is used, and loads nothing", async () => {
    rpcReply = { data: { allowed: false, recent: 20, limit: 20, retryAfterSeconds: 700 }, error: null };
    const res = await POST(request(FRANKLIN));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("700");
    expect((await res.json()).error).toBe(
      "You have loaded 20 counties in the last hour; the limit is 20. Try again in about 12 minutes."
    );
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("503s and loads nothing when the allowance cannot be checked", async () => {
    rpcReply = { data: null, error: { message: "function does not exist" } };
    expect((await POST(request(FRANKLIN))).status).toBe(503);
    rpcReply = { data: { allowed: "yes" }, error: null };
    expect((await POST(request(FRANKLIN))).status).toBe(503);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("de-duplicates repeated counties so the work and the count cannot be multiplied", async () => {
    await POST(
      request({
        counties: [
          { stateFips: "39", countyFips: "049" },
          { stateFips: "39", countyFips: "049" },
        ],
      })
    );
    expect(ingestMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({ p_counties: ["39049"] });
  });

  it("caps how many counties one request can drive", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      stateFips: "39",
      countyFips: String(i).padStart(3, "0"),
    }));
    expect((await POST(request({ counties: many }))).status).toBe(400);
  });
});
