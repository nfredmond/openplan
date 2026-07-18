import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const fetchMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

import { GET } from "@/app/api/grants-gov/opportunities/route";
import { resetGrantsGovResponseCache } from "@/lib/grants/grants-gov-cache";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const UPSTREAM_OK = {
  errorcode: 0,
  data: {
    hitCount: 1,
    oppHits: [
      {
        id: "362478",
        number: "693JF725R000010",
        title: "Fiscal Year 2026 United States Marine Highway Program (USMHP)",
        agencyCode: "DOT-MA",
        agency: "Maritime Administration",
        openDate: "07/06/2026",
        closeDate: "08/31/2026",
        oppStatus: "posted",
        cfdaList: ["20.816"],
      },
    ],
  },
};

function request(url = "http://localhost/api/grants-gov/opportunities") {
  return new NextRequest(url);
}

describe("/api/grants-gov/opportunities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGrantsGovResponseCache();
    vi.stubGlobal("fetch", fetchMock);

    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      workspace: { id: WORKSPACE_ID },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => UPSTREAM_OK,
    });
  });

  it("requires an authenticated user", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a workspace membership", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized keywords", async () => {
    const response = await GET(request(`http://localhost/api/grants-gov/opportunities?keyword=${"x".repeat(200)}`));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies a successful search and parses the payload", async () => {
    const response = await GET(request("http://localhost/api/grants-gov/opportunities?keyword=transit"));
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.hitCount).toBe(1);
    expect(payload.cached).toBe(false);
    expect(payload.opportunities[0].id).toBe("362478");
    expect(payload.opportunities[0].openDate).toBe("2026-07-06");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.grants.gov/v1/api/search2");
    expect(JSON.parse(String(init.body))).toEqual({
      keyword: "transit",
      rows: 25,
      oppStatuses: "forecasted|posted",
      fundingCategories: "T",
    });
  });

  it("serves the second identical request from cache without re-fetching", async () => {
    const first = await GET(request());
    expect(first.status).toBe(200);
    const second = await GET(request());
    expect(second.status).toBe(200);
    const payload = await second.json();

    expect(payload.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches per search body, not globally", async () => {
    await GET(request());
    await GET(request("http://localhost/api/grants-gov/opportunities?keyword=bridge"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when grants.gov is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const response = await GET(request());
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error).toBe("grants_gov_unreachable");
  });

  it("returns 502 on a non-OK upstream status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const response = await GET(request());
    expect(response.status).toBe(502);
  });

  it("returns 502 when the upstream payload fails the defensive parse", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ errorcode: 7 }) });
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(mockAudit.warn).toHaveBeenCalled();
  });

  it("does not cache failed upstream calls", async () => {
    fetchMock.mockRejectedValueOnce(new Error("blip"));
    const first = await GET(request());
    expect(first.status).toBe(502);

    const second = await GET(request());
    expect(second.status).toBe(200);
    const payload = await second.json();
    expect(payload.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
