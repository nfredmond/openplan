import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { PORTFOLIO_ROUND_TRIP_HEADERS } from "@/lib/projects/portfolio-round-trip-contract";
import type { PortfolioRoundTripProject } from "@/lib/projects/portfolio-export";
import { moneyCents } from "@/lib/money/optional-amount";

const state = vi.hoisted(() => ({ createClient: vi.fn(), membership: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: state.createClient }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: state.membership }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
import { GET } from "@/app/api/projects/export/workbook/route";

const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const COLUMNS = "id, name, summary, status, plan_type, delivery_phase, estimated_cost_amount::text, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_source_document_id, estimated_cost_recorded_at, created_at, updated_at, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_set_at";
type Row = PortfolioRoundTripProject & { workspace_id: string };
type Query = { table: string; columns: string; filters: [string, unknown][]; cursors: [string, string][]; orders: [string, boolean][]; range: [number, number]; limit: number };

function projects(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    workspace_id: WORKSPACE, id: `project-${String(index).padStart(5, "0")}`,
    name: `=Synthetic project ${index}`, summary: `Original description ${index}`,
    status: "draft", plan_type: "capital_program", delivery_phase: "programming",
    estimated_cost_amount: "1234567890123456.78", estimated_cost_currency: "USD",
    estimated_cost_basis_year: null, estimated_cost_source_document_id: `document-${index}`,
    estimated_cost_recorded_at: "2026-10-01T00:00:00Z",
    place_source: index % 2 ? "staff-source" : null, place_kind: index % 2 ? "custom" : null,
    place_ref: index % 2 ? `reference-${index}` : null,
    place_label: index % 2 ? "Unverified source-location label" : null,
    place_country_code: index % 2 ? "ZZ" : null, place_subdivision_code: null,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  }));
}

// Apply workspace filters, ID cursors, projection, ordering and inclusive ranges
// before the API cap. Retain offset support to reproduce the previous reader.
function database(rows: Row[], options: { cap?: number; failFrom?: number; nullFrom?: number; anonymous?: boolean; beforePage?: (page: number) => void } = {}) {
  const queries: Query[] = [];
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: options.anonymous ? null : { id: USER } } })) },
    from: vi.fn((table: string) => {
      const query: Query = { table, columns: "", filters: [], cursors: [], orders: [], range: [0, Infinity], limit: Infinity };
      const chain = {
        select(columns: string) { query.columns = columns; return chain; },
        eq(column: string, value: unknown) { query.filters.push([column, value]); return chain; },
        gt(column: string, value: string) { query.cursors.push([column, value]); return chain; },
        order(column: string, settings: { ascending: boolean }) { query.orders.push([column, settings.ascending]); return chain; },
        limit(limit: number) { query.limit = limit; return chain; },
        range(from: number, to: number) { query.range = [from, to]; return chain; },
        then(resolve: (result: { data: Record<string, unknown>[] | null; error: { code: string } | null }) => unknown) {
          options.beforePage?.(queries.length);
          queries.push(query);
          const [from, to] = query.range;
          if (queries.length - 1 >= (options.failFrom ?? Infinity)) return Promise.resolve(resolve({ data: null, error: { code: "42501" } }));
          if (queries.length - 1 >= (options.nullFrom ?? Infinity)) return Promise.resolve(resolve({ data: null, error: null }));
          const selected = rows.filter((row) => query.filters.every(([key, value]) => row[key as keyof Row] === value)
            && query.cursors.every(([key, value]) => String(row[key as keyof Row]) > value));
          selected.sort((a, b) => {
            for (const [key, ascending] of query.orders) {
              const left = String(a[key as keyof Row] ?? ""), right = String(b[key as keyof Row] ?? "");
              if (left !== right) return (left < right ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          const size = Math.min(to - from + 1, query.limit, options.cap ?? 1000);
          const data = selected.slice(from, from + size).map((row) => Object.fromEntries(
            query.columns.split(",").map((key) => key.trim()).map((selected) => {
              const key = selected.split("::")[0];
              const value = row[key as keyof Row];
              // Model the SDK's precision loss if the server text cast is removed.
              return [key, key === "estimated_cost_amount" && value != null
                ? selected.endsWith("::text") ? String(value) : Number(value) : value];
            })
          ));
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return chain;
    }),
  };
  state.createClient.mockResolvedValue(client);
  return { client, queries };
}

function request() { return GET(new NextRequest("http://localhost/api/projects/export/workbook")); }
async function grid(response: Response) {
  const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: "array" });
  return { workbook, rows: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Projects, { header: 1, defval: "" }) };
}
function expectedRow(row: Row) {
  return [row.name, row.id, row.summary, row.estimated_cost_amount, row.estimated_cost_currency, "", row.plan_type,
    row.status, row.delivery_phase, row.place_label ?? "", row.place_source ?? "", row.place_kind ?? "",
    row.place_ref ?? "", row.place_country_code ?? "", "", row.estimated_cost_source_document_id,
    row.estimated_cost_recorded_at, row.created_at, row.updated_at];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.membership.mockResolvedValue({ membership: { workspace_id: WORKSPACE, role: "viewer" }, workspace: { name: "Synthetic workspace" } });
});

it("exports the exact unusual cent value as workbook text with an unknown year", async () => {
  const row = { ...projects(1)[0], estimated_cost_amount: "999999999999999.99" };
  const { queries } = database([row]);
  const response = await request();
  expect(response.status).toBe(200);
  const result = await grid(response);
  expect(queries[0].columns).toBe(COLUMNS);
  expect(result.workbook.Sheets.Projects.D2).toMatchObject({ t: "s", v: row.estimated_cost_amount });
  expect(moneyCents(result.rows[1][3])).toBe(BigInt("99999999999999999"));
  expect(result.rows[1][5]).toBe("");
});

it("exports all 2000 projects through the configured row cap with original workbook values", async () => {
  const rows = projects(2000);
  database([...rows].reverse());
  const response = await request();
  expect(response.status).toBe(200);
  const result = await grid(response);
  expect(result.rows, "complete workbook must preserve all original rows and literal metadata").toEqual([
    [...PORTFOLIO_ROUND_TRIP_HEADERS], ...rows.map(expectedRow),
  ]);
  expect(result.workbook.SheetNames).toEqual(["Projects", "Read me"]);
  expect(result.workbook.Sheets.Projects.A2.f).toBeUndefined();
  const readme = XLSX.utils.sheet_to_json(result.workbook.Sheets["Read me"], { header: 1 });
  expect(readme).toContainEqual(["Workspace ID", WORKSPACE]);
  expect(readme).toContainEqual(["Project rows", "2000"]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="openplan-synthetic-workspace-projects-.*\.xlsx"$/);
});

it("scopes and projects every ordered page for a read-only workspace member", async () => {
  const foreign = { ...projects(1)[0], workspace_id: "foreign", id: "foreign" };
  const fake = database([...projects(2000), foreign]);
  await request();
  expect(fake.queries, "every page must retain workspace projection ID cursor and bounded limit").toEqual(
    [null, "project-00999", "project-01999"].map((cursor, index) => ({
      table: "projects", columns: COLUMNS, filters: [["workspace_id", WORKSPACE]],
      cursors: cursor === null ? [] : [["id", cursor]], orders: [["id", true]],
      range: [0, Infinity], limit: index === 2 ? 1 : 1000,
    }))
  );
  expect(state.membership).toHaveBeenCalledWith(fake.client, USER);
});

it("continues after a short capped page until the scoped portfolio is exhausted", async () => {
  database(projects(1001), { cap: 137 });
  const response = await request();
  const result = await grid(response);
  expect(result.rows.length, "short server pages must not truncate the workbook").toBe(1002);
});

it("refuses 2001 projects explicitly instead of generating a partial workbook", async () => {
  database(projects(2001));
  const response = await request();
  expect(response.status, "over-limit portfolio must refuse before creating a workbook").toBe(409);
  expect(await response.json()).toMatchObject({ code: "row_limit", error: expect.stringContaining("2,000") });
  expect(response.headers.get("content-disposition")).toBeNull();
});

it("refuses a later page error instead of exporting the earlier rows", async () => {
  database(projects(2000), { failFrom: 1 });
  const response = await request();
  expect(response.status, "later page read failure must not export a partial workbook").toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to read the project portfolio" });
  expect(response.headers.get("content-disposition")).toBeNull();
});

it("keeps an unavailable page distinct from an empty portfolio", async () => {
  database(projects(2000), { nullFrom: 1 });
  const response = await request();
  expect(response.status, "unavailable data must not become a successful empty page").toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to read the project portfolio" });
});

it("exports a genuinely empty portfolio with the original workbook headers", async () => {
  database([]);
  const response = await request();
  expect(response.status, "empty successful read must still export the workbook").toBe(200);
  expect((await grid(response)).rows).toEqual([[...PORTFOLIO_ROUND_TRIP_HEADERS]]);
});

it("stops anonymous callers before membership or project reads", async () => {
  const fake = database(projects(1), { anonymous: true });
  const response = await request();
  expect([response.status, state.membership.mock.calls.length, fake.queries.length], "anonymous caller must stop before portfolio access").toEqual([401, 0, 0]);
});

it("stops callers without active membership before project reads", async () => {
  const fake = database(projects(1));
  state.membership.mockResolvedValue({ membership: null, workspace: null });
  const response = await request();
  expect([response.status, fake.queries.length], "missing membership must stop before portfolio access").toEqual([404, 0]);
});

// Mutate the unread row at the second query, after the first page was copied.
// Offset paging still returns the expected count, but repeats one ID and omits it.
it("retains each project exactly once when an unread project is updated between pages", async () => {
  const rows = projects(4);
  let changed = false;
  database(rows, { cap: 2, beforePage(page) {
    if (page === 1) {
      rows[2].updated_at = "2026-10-15T00:00:00Z";
      changed = true;
    }
  } });
  const response = await request();
  expect(response.status).toBe(200);
  const actual = (await grid(response)).rows.slice(1);
  expect(changed, "the concurrent update must actually run").toBe(true);
  expect(actual).toHaveLength(rows.length);
  expect(actual.map((row) => row[1]).sort(), "mutable update must not omit or duplicate a project").toEqual(rows.map((row) => row.id));
  expect(actual, "presentation must sort the received values by update time then ID").toEqual([
    rows[2], rows[0], rows[1], rows[3],
  ].map(expectedRow));
});

it("sorts presentation by timestamp instant and breaks ties by ID after cursor reads", async () => {
  const rows = projects(5);
  rows[0].updated_at = "2026-10-01T00:00:00Z";
  rows[1].updated_at = "2026-10-01T02:00:00+02:00";
  rows[2].updated_at = "2026-10-01T00:00:00.000500Z";
  rows[3].updated_at = "2026-10-15T00:00:00Z";
  rows[4].updated_at = "2026-10-01T00:00:00.000501Z";
  database([...rows].reverse(), { cap: 2 });
  const response = await request();
  expect(response.status).toBe(200);
  expect((await grid(response)).rows.slice(1), "presentation must use descending instants and ascending IDs for ties").toEqual([
    rows[3], rows[4], rows[2], rows[0], rows[1],
  ].map(expectedRow));
});
