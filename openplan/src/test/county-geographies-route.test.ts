import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const searchUsCountiesMock = vi.fn();

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

vi.mock("@/lib/geographies/us-counties", () => ({
  searchUsCounties: (...args: unknown[]) => searchUsCountiesMock(...args),
}));

import { GET as getCountyGeographies } from "@/app/api/geographies/counties/route";

describe("GET /api/geographies/counties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "123e4567-e89b-12d3-a456-426614174000" },
      },
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    });
    searchUsCountiesMock.mockResolvedValue([
      {
        geographyId: "06057",
        geographyLabel: "Nevada County, CA",
        countyPrefix: "NEVADA",
        countySlug: "nevada-county-06057",
        suggestedRunName: "nevada-county-06057-runtime",
      },
    ]);
  });

  it("returns county matches for authenticated users", async () => {
    const response = await getCountyGeographies(new NextRequest("http://localhost/api/geographies/counties?q=nevada"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          countyPrefix: "NEVADA",
          countySlug: "nevada-county-06057",
          suggestedRunName: "nevada-county-06057-runtime",
        },
      ],
    });
    expect(searchUsCountiesMock).toHaveBeenCalledWith("nevada", 8);
  });

  it("returns an empty list for too-short queries", async () => {
    const response = await getCountyGeographies(new NextRequest("http://localhost/api/geographies/counties?q=n"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(searchUsCountiesMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCountyGeographies(new NextRequest("http://localhost/api/geographies/counties?q=nevada"));

    expect(response.status).toBe(401);
  });
});
