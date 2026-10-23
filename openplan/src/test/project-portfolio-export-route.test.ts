import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { reviewPortfolioWorkbook } from "@/lib/projects/portfolio-import";

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
const COLUMNS = "id, name, summary, status, plan_type, delivery_phase, estimated_cost_amount::text, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_source_document_id, estimated_cost_recorded_at, created_at, updated_at, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_set_at";
type Row = Record<string, unknown>;
type ReadResult = { data: Row[] | null; error: { code?: string; message: string } | null };
type Query = {
  table: string; columns: string; filters: Array<[string, unknown]>; cursors: Array<[string, string]>;
  orders: Array<[string, boolean]>; range: [number, number]; limit: number;
};

// Each read applies its own scope, ID cursor, ordering, limit and projection.
// Preserve the API cap so a single limit read cannot masquerade as pagination.
function fakeClient(result: ReadResult) {
  const queries: Query[] = [];
  return {
    queries,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: vi.fn((table: string) => {
        const query: Query = { table, columns: "", filters: [], cursors: [], orders: [], range: [0, Infinity], limit: Infinity };
        const read = async (): Promise<ReadResult> => {
          queries.push(query);
          if (result.error || !result.data) return result;
          const rows = result.data.filter((row) => query.filters.every(([column, value]) => row[column] === value)
            && query.cursors.every(([column, value]) => String(row[column]) > value));
          rows.sort((left, right) => {
            for (const [column, ascending] of query.orders) {
              const a = String(left[column] ?? ""), b = String(right[column] ?? "");
              if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          const [from, to] = query.range;
          const count = Math.min(to - from + 1, query.limit, 1_000);
          return { data: rows.slice(from, from + count).map((row) => Object.fromEntries(
            query.columns.split(",").map((column) => column.trim()).map((selected) => {
              const column = selected.split("::")[0];
              return [column, column === "estimated_cost_amount" && row[column] != null
                ? selected.endsWith("::text") ? String(row[column]) : Number(row[column]) : row[column]];
            })
          )), error: null };
        };
        const chain = {
          select: (columns: string) => { query.columns = columns; return chain; },
          eq: (column: string, value: unknown) => { query.filters.push([column, value]); return chain; },
          gt: (column: string, value: string) => { query.cursors.push([column, value]); return chain; },
          order: (column: string, settings: { ascending: boolean }) => {
            query.orders.push([column, settings.ascending]); return chain;
          },
          limit: (value: number) => { query.limit = value; return read(); },
          range: (from: number, to: number) => { query.range = [from, to]; return read(); },
        };
        return chain;
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
    workspace: { name: "OpenPlan QA" },
  });
  buildPortfolioRoundTripWorkbookMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe("GET /api/projects/export/workbook", () => {
  it("exports only the active workspace and allows read-only members", async () => {
    const first = { id: "project-1", workspace_id: WORKSPACE_ID, name: "=Original name", summary: "Original summary",
      updated_at: "2026-10-01T00:00:00Z", estimated_cost_amount: "1234567890123456.78",
      estimated_cost_basis_year: null, estimated_cost_source_document_id: "source-1", place_ref: "reference-1" };
    const second = { ...first, id: "project-2" };
    const older = { ...first, id: "project-0", updated_at: "2026-09-01T00:00:00Z" };
    const fake = fakeClient({ data: [older, second, { ...first, workspace_id: "foreign", id: "foreign" }, first], error: null });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status, "viewer export must remain successful").toBe(200);
    expect(new Uint8Array(await response.arrayBuffer()), "awaited serializer bytes reach response").toEqual(new Uint8Array([1, 2, 3]));
    expect(audit.info).toHaveBeenCalledWith("portfolio_workbook_exported", expect.objectContaining({ bytes: 3 }));
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("openplan-openplan-qa-projects-2026-08-26.xlsx");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fake.queries, "every legacy read must preserve projection scope ID cursor and limit").toEqual(
      [null, "project-2"].map((cursor) => ({ table: "projects", columns: COLUMNS,
        filters: [["workspace_id", WORKSPACE_ID]], cursors: cursor === null ? [] : [["id", cursor]],
        orders: [["id", true]], range: [0, Infinity], limit: 1000 }))
    );
    expect(loadCurrentWorkspaceMembershipMock).toHaveBeenCalledWith(fake.client, USER_ID);
    expect(buildPortfolioRoundTripWorkbookMock).toHaveBeenCalledTimes(1);
    expect(buildPortfolioRoundTripWorkbookMock, "legacy workbook must retain ordered scoped original metadata").toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      workspaceName: "OpenPlan QA",
      generatedAt: expect.any(Date),
      projects: [first, second, older].map((row) => Object.fromEntries(
        COLUMNS.split(", ").map((selected) => selected.split("::")[0]).map((column) => [column, (row as Row)[column]])
      )),
    }));
  });

  it("catches an asynchronous serializer failure before logging or sending a workbook", async () => {
    createClientMock.mockResolvedValue(fakeClient({ data: [], error: null }).client);
    buildPortfolioRoundTripWorkbookMock.mockRejectedValueOnce(new Error("formatting failed"));
    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));
    expect(response.status, "async formatting failure is handled").toBe(500);
    expect(audit.info, "failed formatting is not an export").not.toHaveBeenCalled();
    expect(audit.error).toHaveBeenCalledWith("portfolio_workbook_export_failed", expect.objectContaining({ code: "Error" }));
  });

  it("stops before a project read when the user has no active workspace", async () => {
    const fake = fakeClient({ data: [], error: null });
    createClientMock.mockResolvedValue(fake.client);
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status, "missing workspace must stop before reads").toBe(404);
    expect(fake.client.from).not.toHaveBeenCalled();
    expect(buildPortfolioRoundTripWorkbookMock).not.toHaveBeenCalled();
  });

  it("refuses an over-limit portfolio instead of silently truncating it", async () => {
    const fake = fakeClient({ data: Array.from({ length: 2_001 }, (_, index) => ({ id: `project-${index}`, workspace_id: WORKSPACE_ID })), error: null });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status, "legacy over-limit export must refuse without a workbook").toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "row_limit" });
    expect(buildPortfolioRoundTripWorkbookMock).not.toHaveBeenCalled();
  });

  it("exports and reimports a recorded cost with an unknown price year", async () => {
    const real = await vi.importActual<typeof import("@/lib/projects/portfolio-export")>("@/lib/projects/portfolio-export");
    buildPortfolioRoundTripWorkbookMock.mockImplementation(real.buildPortfolioRoundTripWorkbook);
    const fake = fakeClient({
      data: [{ id: "project-1", workspace_id: WORKSPACE_ID, name: "Synthetic cost regression", estimated_cost_amount: "999999999999999.99",
        estimated_cost_currency: "USD", estimated_cost_basis_year: null,
        status: "draft", plan_type: "capital_program", delivery_phase: "programming" }],
      error: null,
    });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status).toBe(200);
    const review = await reviewPortfolioWorkbook({
      bytes: new Uint8Array(await response.arrayBuffer()), filename: "projects.xlsx",
      contentType: real.PORTFOLIO_ROUND_TRIP_CONTENT_TYPE,
      configurations: [{ worksheetIndex: 0, headerRow: 1, mapping: real.PORTFOLIO_ROUND_TRIP_MAPPING,
        defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming",
          cost: { currency: "USD", scale: "ones", priceYear: 2026 } } }],
    });
    expect(review.rows[0], "legacy round trip must preserve exact cents and an unknown price year").toMatchObject({ estimatedCost: { amount: "999999999999999.99", currency: "USD", priceYear: null },
      canCreate: true, warnings: [{ code: "unknown_price_year" }], errors: [] });
  });

  it("fails closed when the workspace-scoped read fails", async () => {
    const fake = fakeClient({ data: null, error: { code: "42501", message: "denied" } });
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));

    expect(response.status, "denied project read must fail without a workbook").toBe(500);
    expect(buildPortfolioRoundTripWorkbookMock).not.toHaveBeenCalled();
  });
});
