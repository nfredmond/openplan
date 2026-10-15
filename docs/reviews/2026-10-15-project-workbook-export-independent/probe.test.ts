import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { buildPortfolioRoundTripWorkbook, type PortfolioRoundTripProject } from "@/lib/projects/portfolio-export";

const state = vi.hoisted(() => ({ create: vi.fn(), membership: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: state.create }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: state.membership }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info() {}, warn() {}, error() {} }) }));
import { GET } from "@/app/api/projects/export/workbook/route";

const W = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-15T07:00:00Z");
type Row = PortfolioRoundTripProject & { workspace_id: string };
const columns = "id, name, summary, status, plan_type, delivery_phase, estimated_cost_amount, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_source_document_id, estimated_cost_recorded_at, created_at, updated_at, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_set_at";

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    workspace_id: W, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: ["=literal", "+literal", "-literal", "@literal"][i % 4], summary: `row ${i}`,
    status: "draft", plan_type: "capital_program", delivery_phase: "programming",
    estimated_cost_amount: "1234567890123456.78", estimated_cost_currency: "USD", estimated_cost_basis_year: null,
    estimated_cost_source_document_id: `original-${i}`, estimated_cost_recorded_at: "2026-09-01T00:00:00Z",
    place_source: "source-only", place_kind: "custom", place_ref: `reference-${i}`,
    place_label: "Unverified source text", place_country_code: "ZZ", place_subdivision_code: null,
    created_at: "2026-09-01T00:00:00Z", updated_at: i % 3 === 0 ? "2026-10-03T00:00:00Z" : "2026-10-02T00:00:00Z",
  }));
}

// This independent fake implements the route's flat select, UUID/timestamp sort,
// equality and inclusive offset request. It does not emulate a live HTTP server.
function install(input: Row[], cap: number, failure?: "error" | "null" | "throw" | "error-with-data") {
  const queries: Array<{ columns: string; filter: [string, unknown][]; orders: [string, boolean][]; from: number; to: number }> = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from(table: string) {
      expect(table).toBe("projects");
      const q = { columns: "", filter: [] as [string, unknown][], orders: [] as [string, boolean][], from: 0, to: Infinity };
      const chain = {
        select(value: string) { q.columns = value; return chain; },
        eq(key: string, value: unknown) { q.filter.push([key, value]); return chain; },
        order(key: string, option: { ascending: boolean }) { q.orders.push([key, option.ascending]); return chain; },
        range(from: number, to: number) { q.from = from; q.to = to; return chain; },
        then(resolve: (value: unknown) => unknown, reject: (value: unknown) => unknown) {
          queries.push(q);
          if (queries.length > 2002) throw new Error("probe query budget exceeded");
          if (q.from >= 1000 && failure) {
            if (failure === "throw") return Promise.reject(new Error("synthetic transport failure")).then(resolve, reject);
            return Promise.resolve({ data: failure === "error-with-data" ? input.slice(0, 1) : null,
              error: failure === "null" ? null : { code: "42501" } }).then(resolve, reject);
          }
          const selected = input.filter(r => q.filter.every(([key, value]) => r[key as keyof Row] === value));
          selected.sort((a, b) => {
            for (const [key, asc] of q.orders) {
              const left = key === "updated_at" ? Date.parse(a.updated_at) : a.id;
              const right = key === "updated_at" ? Date.parse(b.updated_at) : b.id;
              if (left !== right) return (left < right ? -1 : 1) * (asc ? 1 : -1);
            }
            return 0;
          });
          const data = selected.slice(q.from, Math.min(q.to + 1, q.from + cap)).map(row => Object.fromEntries(
            q.columns.split(",").map(s => s.trim()).map(key => [key, row[key as keyof Row]])
          ));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  state.create.mockResolvedValue(client);
  return queries;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.setSystemTime(NOW);
  state.membership.mockResolvedValue({ membership: { workspace_id: W, role: "viewer" }, workspace: { name: "  Probe workspace  " } });
});

for (const [count, cap] of [[0, 1000], [1, 1], [999, 1000], [1000, 1000], [1001, 1000], [2000, 1000],
  [2001, 1000], [3500, 1000], [2000, 137], [2001, 137], [2000, 1], [2001, 1], [2000, 3000]]) {
  it(`independent boundary count=${count} cap=${cap}`, async () => {
    const source = rows(count);
    const queries = install([...source].reverse().concat([{ ...rows(1)[0], id: "foreign", workspace_id: "foreign" }]), cap);
    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));
    expect(response.status, "boundary status").toBe(count > 2000 ? 409 : 200);
    let offset = 0;
    for (const q of queries) {
      expect(q, "independent query contract").toEqual({ columns, filter: [["workspace_id", W]],
        orders: [["updated_at", false], ["id", true]], from: offset, to: Math.min(offset + 999, 2000) });
      offset += Math.min(Math.max(count - offset, 0), cap, 1000, 2001 - offset);
    }
    expect(queries.length, "independent exact termination").toBe(count > 2000 ? Math.ceil(2001 / Math.min(cap, 1000)) : Math.ceil(count / Math.min(cap, 1000)) + 1);
    if (count > 2000) {
      expect(await response.json(), "independent refusal contract").toMatchObject({ code: "row_limit" });
      expect(response.headers.get("content-disposition")).toBeNull();
      return;
    }
    const expected = source.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const actual = new Uint8Array(await response.arrayBuffer());
    const prior = await buildPortfolioRoundTripWorkbook({ workspaceId: W, workspaceName: "Probe workspace", generatedAt: NOW, projects: expected });
    expect(Buffer.from(actual).equals(Buffer.from(prior)), "independent complete byte parity").toBe(true);
    const workbook = XLSX.read(actual, { type: "array" });
    expect(workbook.SheetNames).toEqual(["Projects", "Read me"]);
    if (count) expect(workbook.Sheets.Projects.A2.f).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
}

for (const failure of ["error", "null", "throw", "error-with-data"] as const) {
  it(`independent later failure ${failure}`, async () => {
    const queries = install(rows(2000), 1000, failure);
    const response = await GET(new NextRequest("http://localhost/api/projects/export/workbook"));
    expect(response.status, "independent no partial workbook").toBe(500);
    expect(queries.length).toBe(2);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
  });
}
