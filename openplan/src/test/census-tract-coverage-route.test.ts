import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const countEqCountyMock = vi.fn();
const countEqStateMock = vi.fn(() => ({ eq: countEqCountyMock }));
const countSelectMock = vi.fn(() => ({ eq: countEqStateMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "census_tracts_map") return { select: countSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET } from "@/app/api/geographies/census-tracts/coverage/route";

function request(query: string) {
  return new NextRequest(`http://localhost/api/geographies/census-tracts/coverage${query}`);
}

/**
 * The READ half of making the equity layer fillable.
 *
 * It exists because neither existing surface could answer "how many tracts are
 * loaded for THIS county": the map-features counts route conflates three
 * different nulls and only reports the workspace's home county, and the tract
 * feature route would ship up to 500 MultiPolygons to learn one integer.
 */
describe("GET /api/geographies/census-tracts/coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    countEqCountyMock.mockResolvedValue({ count: 328, error: null });
  });

  it("returns the stored tract count for a county", async () => {
    const response = await GET(request("?stateFips=39&countyFips=049"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stateFips: "39", countyFips: "049", tractCount: 328 });
    expect(countEqStateMock).toHaveBeenCalledWith("state_fips", "39");
    expect(countEqCountyMock).toHaveBeenCalledWith("county_fips", "049");
  });

  it("counts with head:true rather than fetching geometry", async () => {
    await GET(request("?stateFips=39&countyFips=049"));
    expect(countSelectMock).toHaveBeenCalledWith("geoid", { count: "exact", head: true });
  });

  it("answers 0 rather than null for a county with nothing loaded", async () => {
    countEqCountyMock.mockResolvedValueOnce({ count: null, error: null });
    expect(await (await GET(request("?stateFips=39&countyFips=049"))).json()).toMatchObject({
      tractCount: 0,
    });
  });

  it("refuses malformed FIPS instead of guessing", async () => {
    for (const query of ["?stateFips=3&countyFips=049", "?stateFips=39&countyFips=49", "", "?stateFips=39"]) {
      expect((await GET(request(query))).status).toBe(400);
    }
  });

  it("returns 401 when unauthenticated, without querying", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    expect((await GET(request("?stateFips=39&countyFips=049"))).status).toBe(401);
    expect(countSelectMock).not.toHaveBeenCalled();
  });

  it("never escalates to the service role for a public-data read", async () => {
    // census_tracts_map already grants SELECT to `authenticated`, so counting
    // rows in it needs no elevated key — and taking one anyway would make a
    // read that any signed-in user may do look like an operator action.
    await GET(request("?stateFips=39&countyFips=049"));
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("does not report zero when the count itself failed", async () => {
    // A county we cannot count is not a county with nothing in it.
    countEqCountyMock.mockResolvedValueOnce({ count: null, error: { message: "boom", code: "42P01" } });

    const response = await GET(request("?stateFips=39&countyFips=049"));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toMatchObject({ tractCount: 0 });
  });
});
