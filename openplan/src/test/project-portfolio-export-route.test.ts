import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const buildPortfolioRoundTripWorkbookMock = vi.fn();
const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => audit }));
vi.mock("@/lib/projects/portfolio-export", () => ({
  PORTFOLIO_ROUND_TRIP_CONTENT_TYPE: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buildPortfolioRoundTripWorkbook: (...args: unknown[]) => buildPortfolioRoundTripWorkbookMock(...args),
  portfolioRoundTripFilename: () => "openplan-openplan-qa-projects-2026-08-26.xlsx",
}));

import { GET } from "@/app/api/projects/export/workbook/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

function fakeClient(result: { data: unknown[] | null; error: { code?: string; message: string } | null }) {
  const filters: Array<[string, unknown]> = [];
  const limits: number[] = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
    order: () => chain,
    limit: async (value: number) => { limits.push(value); return result; },
  };
  return {
    filters,
    limits,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: vi.fn(() => chain),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
    workspace: { name: "OpenPlan QA" },
  });
  buildPortfolioRoundTripWorkbookMock.mockReturnValue(new Uint8Array([1, 2, 3]));
});

describe("GET /api/projects/export/workbook", () => {
  it("exports only the active workspace and allows read-only members", async () => {
    const fake = fakeClient({ data: [{ id: "project-1" }], error: null });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("openplan-openplan-qa-projects-2026-08-26.xlsx");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fake.filters).toEqual([["workspace_id", WORKSPACE_ID]]);
    expect(fake.limits).toEqual([2_001]);
    expect(buildPortfolioRoundTripWorkbookMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      workspaceName: "OpenPlan QA",
      projects: [{ id: "project-1" }],
    }));
  });

  it("stops before a project read when the user has no active workspace", async () => {
    const fake = fakeClient({ data: [], error: null });
    createClientMock.mockResolvedValue(fake.client);
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status).toBe(404);
    expect(fake.client.from).not.toHaveBeenCalled();
    expect(buildPortfolioRoundTripWorkbookMock).not.toHaveBeenCalled();
  });

  it("refuses an over-limit portfolio instead of silently truncating it", async () => {
    const fake = fakeClient({ data: Array.from({ length: 2_001 }, (_, index) => ({ id: `project-${index}` })), error: null });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "row_limit" });
    expect(buildPortfolioRoundTripWorkbookMock).not.toHaveBeenCalled();
  });

  it("refuses to invent a missing price year for a recorded cost", async () => {
    const fake = fakeClient({
      data: [{ id: "project-1", estimated_cost_amount: "100", estimated_cost_basis_year: null }],
      error: null,
    });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "cost_price_year_missing" });
    expect(buildPortfolioRoundTripWorkbookMock).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace-scoped read fails", async () => {
    const fake = fakeClient({ data: null, error: { code: "42501", message: "denied" } });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status).toBe(500);
    expect(buildPortfolioRoundTripWorkbookMock).not.toHaveBeenCalled();
  });
});
