import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const ingestMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
  createServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/data-sources/census-tract-ingest", () => ({
  ingestCensusTractsForCounty: (...args: unknown[]) => ingestMock(...args),
}));

import { POST } from "@/app/api/geographies/census-tracts/ingest/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/geographies/census-tracts/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/geographies/census-tracts/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
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
    expect((await POST(request({ counties: [{ stateFips: "39", countyFips: "049" }] }))).status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("ingests and returns per-county results with a total", async () => {
    const res = await POST(request({ counties: [{ stateFips: "39", countyFips: "049" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tractsUpserted).toBe(328);
    expect(body.results).toHaveLength(1);
  });

  it("de-duplicates repeated counties so the work cannot be multiplied", async () => {
    await POST(
      request({
        counties: [
          { stateFips: "39", countyFips: "049" },
          { stateFips: "39", countyFips: "049" },
        ],
      })
    );
    expect(ingestMock).toHaveBeenCalledTimes(1);
  });

  it("caps how many counties one request can drive", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      stateFips: "39",
      countyFips: String(i).padStart(3, "0"),
    }));
    expect((await POST(request({ counties: many }))).status).toBe(400);
  });
});
