import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const jurisdictionResult = vi.hoisted(() => ({
  data: {
    home_geography_source: "tigerweb",
    home_country_code: "US",
    home_subdivision_code: "PR",
  },
  error: null as { message: string } | null,
}));

const jurisdictionChain = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
};
jurisdictionChain.select.mockReturnValue(jurisdictionChain);
jurisdictionChain.eq.mockReturnValue(jurisdictionChain);

const supabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabase,
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: "workspace-1", role: "owner" },
  }),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { POST } from "@/app/api/land-use-plans/route";

function request() {
  return new NextRequest("http://localhost/api/land-use-plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Ponce Test Plan",
      descriptorId: "us-ca-general-plan",
      planKindKey: "comprehensive",
      authorityLabel: "Ponce Planning Board",
      geographyLabel: "Ponce, PR",
      geographyGeojson: { type: "FeatureCollection", features: [] },
    }),
  });
}

describe("land use plan legal-bundle jurisdiction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jurisdictionResult.data.home_subdivision_code = "PR";
    jurisdictionResult.error = null;
    jurisdictionChain.select.mockReturnValue(jurisdictionChain);
    jurisdictionChain.eq.mockReturnValue(jurisdictionChain);
    jurisdictionChain.maybeSingle.mockImplementation(async () => jurisdictionResult);
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabase.from.mockImplementation((table: string) => {
      if (table === "workspaces") return jurisdictionChain;
      throw new Error(`Unexpected table access: ${table}`);
    });
  });

  it("refuses to attach California law to a Puerto Rico workspace", async () => {
    const response = await POST(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("does not match this workspace's home jurisdiction");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the workspace jurisdiction cannot be read", async () => {
    jurisdictionResult.error = { message: "database unavailable" };

    const response = await POST(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("could not be verified");
  });
});
