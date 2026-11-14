/**
 * KI-2026-11-14-280: three record pages with no loading boundary answered 200
 * for a record the reader cannot see, because the page itself never called
 * `notFound()` for that case. No `loading.tsx` covers them, so the page's own
 * `notFound()` keeps its 404 (the route guard holds that).
 *
 *   county-runs/[countyRunId]        read the run, then rendered a client view of nothing
 *   land-use-plans/[planId]          rendered a workbench that loads the plan in the browser
 *   invoicing/engagements/[id]       rendered "Contract management unavailable"
 *
 * Each is held to: a visible record renders the page, a missing record and
 * another workspace's record both answer not found, and a failed read keeps
 * the page's own notice.
 *
 * BLIND CATEGORY: no HTTP status here (the lane's before and after tables
 * measure it) and no real row security (RLS Isolation in CI covers it).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
const notFoundMock = vi.fn(() => {
  throw NOT_FOUND;
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: vi.fn(),
}));

/** The reader's current workspace. */
const READER_WORKSPACE = "11111111-1111-4111-8111-111111111111";
/** A workspace the reader also belongs to, but is not current. */
const SECOND_WORKSPACE = "33333333-3333-4333-8333-333333333333";
/** A workspace the reader does not belong to. */
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const READER_MEMBER_OF = [READER_WORKSPACE, SECOND_WORKSPACE];
const OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NO_SUCH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const IN_SECOND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ROWS = [
  { id: OWN, workspace_id: READER_WORKSPACE, run_name: "Own run", geography_type: "county", geography_id: "x" },
  { id: OTHER, workspace_id: OTHER_WORKSPACE, run_name: "Other run", geography_type: "county", geography_id: "y" },
  { id: IN_SECOND, workspace_id: SECOND_WORKSPACE, run_name: "Second run", geography_type: "county", geography_id: "z" },
];

type Query = { table: string; columns: string; filters: Array<[string, unknown]> };
let queries: Query[] = [];
let failReads = false;
let kpiWorkspaceIds: string[] = [];

/**
 * A cookie-scoped client stand-in: row security shows the reader every row in
 * a workspace they belong to, current or not, and none in any other.
 */
function readerClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "reader" } }, error: null }) },
    from(table: string) {
      const query: Query = { table, columns: "", filters: [] };
      queries.push(query);
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          if (failReads) return { data: null, error: { code: "08006", message: "connection refused" } };
          const match = ROWS.filter((row) => READER_MEMBER_OF.includes(row.workspace_id)).find((row) =>
            query.filters.every(([column, value]) => row[column as keyof typeof row] === value)
          );
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

type RpcError = { code: string; message: string };
let contractRead: { data: unknown; error: RpcError | null } = { data: null, error: null };
let rpcCalls: Array<[string, unknown]> = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => readerClient(),
  // The contract read runs `read_contract_management` through the service client; its errors pass
  // through the real `contractAccess` and `reportingError`.
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return contractRead;
    },
  }),
}));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({ membership: { workspace_id: READER_WORKSPACE, role: "owner" } }),
}));
vi.mock("@/lib/models/behavioral-onramp-kpis", () => ({
  loadBehavioralOnrampKpisForWorkspace: async ({ workspaceId }: { workspaceId: string }) => {
    kpiWorkspaceIds.push(workspaceId);
    return { kpis: [], rejectedCountyRunIds: [], error: null };
  },
}));

vi.mock("@/lib/time/workspace-calendar", () => ({ loadWorkspaceCalendar: async () => ({ timeZone: "UTC" }) }));

import CountyRunDetailPage from "@/app/(app)/county-runs/[countyRunId]/page";
import LandUsePlanPage from "@/app/(app)/land-use-plans/[planId]/page";
import ContractPage from "@/app/(app)/invoicing/engagements/[engagementId]/page";

beforeEach(() => {
  queries = [];
  failReads = false;
  kpiWorkspaceIds = [];
  notFoundMock.mockClear();
  contractRead = { data: null, error: null };
  rpcCalls = [];
});

describe("the county run page", () => {
  const render = (countyRunId: string) => CountyRunDetailPage({ params: Promise.resolve({ countyRunId }) });

  it("renders for a run in the reader's workspace", async () => {
    await expect(render(OWN)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(kpiWorkspaceIds).toEqual([READER_WORKSPACE]);
  });

  // Before KI-2026-11-14-280 this page rendered the client view, which loads
  // the run through `/api/county-runs/[id]` with no workspace filter. Row
  // security decides here too, so a shared link to a run in the reader's other
  // workspace still opens, with that workspace's indicators.
  it("renders for a run in another workspace the reader belongs to, which is not current", async () => {
    await expect(render(IN_SECOND)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(kpiWorkspaceIds).toEqual([SECOND_WORKSPACE]);
    const runRead = queries.find((query) => query.table === "county_runs");
    expect(runRead).toEqual({
      table: "county_runs",
      columns: "id, workspace_id, run_name, geography_type, geography_id",
      filters: [["id", IN_SECOND]],
    });
  });

  it.each([
    ["a run that does not exist", NO_SUCH],
    ["a run in a workspace the reader does not belong to", OTHER],
  ])("answers not found for %s", async (_label, id) => {
    await expect(render(id)).rejects.toBe(NOT_FOUND);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("renders the read-failure notice when the run's read fails", async () => {
    failReads = true;
    await expect(render(OWN)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(kpiWorkspaceIds).toEqual([READER_WORKSPACE]);
  });
});

describe("the land use plan page", () => {
  const render = (planId: string) =>
    LandUsePlanPage({ params: Promise.resolve({ planId }), searchParams: Promise.resolve({}) });

  it("renders the workbench for a plan the reader's client can see, reading only the id", async () => {
    await expect(render(OWN)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(queries).toEqual([{ table: "land_use_plans", columns: "id", filters: [["id", OWN]] }]);
  });

  it.each([
    ["a plan that does not exist", NO_SUCH],
    ["another workspace's plan", OTHER],
  ])("answers not found for %s", async (_label, id) => {
    await expect(render(id)).rejects.toBe(NOT_FOUND);
  });

  it("renders the workbench when the read fails, so it can say the plan could not be loaded", async () => {
    failReads = true;
    await expect(render(OWN)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});

describe("the contract management page", () => {
  const render = (engagementId: string) => ContractPage({ params: Promise.resolve({ engagementId }) });
  const fails = (code: string, message: string) => {
    contractRead = { data: null, error: { code, message } };
  };

  // `read_contract_management_v046` raises this for a contract that does not exist and for a reader
  // with no role on it: one error for both, so one answer.
  it("answers not found when the contract read refuses the reader", async () => {
    fails("42501", "Contract access denied");
    await expect(render(NO_SUCH)).rejects.toBe(NOT_FOUND);
    await expect(render(OTHER)).rejects.toBe(NOT_FOUND);
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a missing EXECUTE grant (403)", "42501", "permission denied for function read_contract_management"],
    ["the delivery layer's own refusal (403)", "42501", "Contract delivery access denied"],
    ["a read that did not complete (503)", "08006", "connection refused"],
    ["a duplicate source observation (409)", "23505", "duplicate key value violates unique constraint"],
  ])("keeps the unavailable notice for %s", async (_label, code, message) => {
    fails(code, message);
    const page = await render(OWN);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(JSON.stringify(page)).toContain("Contract management unavailable");
  });

  // Access follows the contract's own workspace (`contract_actor_role`), never the current one: the
  // read takes no workspace, so a contract in the reader's other workspace opens like any other.
  it("renders a contract the read returns, in any workspace, and passes the read no workspace", async () => {
    contractRead = { data: { engagement: { id: IN_SECOND, workspace_id: SECOND_WORKSPACE } }, error: null };
    await expect(render(IN_SECOND)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([
      ["read_contract_management", { p_engagement_id: IN_SECOND, p_actor_id: "reader" }],
    ]);
  });
});
