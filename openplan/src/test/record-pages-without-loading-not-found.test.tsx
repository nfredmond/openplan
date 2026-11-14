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

const READER_WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NO_SUCH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ROWS = [
  { id: OWN, workspace_id: READER_WORKSPACE, run_name: "Own run", geography_type: "county", geography_id: "x" },
  { id: OTHER, workspace_id: OTHER_WORKSPACE, run_name: "Other run", geography_type: "county", geography_id: "y" },
];

type Query = { table: string; columns: string; filters: Array<[string, unknown]> };
let queries: Query[] = [];
let failReads = false;

/** A cookie-scoped client stand-in: the reader sees only their workspace's rows. */
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
          const match = ROWS.filter((row) => row.workspace_id === READER_WORKSPACE).find((row) =>
            query.filters.every(([column, value]) => row[column as keyof typeof row] === value)
          );
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => readerClient() }));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({ membership: { workspace_id: READER_WORKSPACE, role: "owner" } }),
}));
vi.mock("@/lib/models/behavioral-onramp-kpis", () => ({
  loadBehavioralOnrampKpisForWorkspace: async () => ({ kpis: [], rejectedCountyRunIds: [], error: null }),
}));

const contractAccessMock = vi.fn();
vi.mock("@/lib/invoicing/contracts/server", () => ({ contractAccess: (id: string) => contractAccessMock(id) }));
vi.mock("@/lib/time/workspace-calendar", () => ({ loadWorkspaceCalendar: async () => ({ timeZone: "UTC" }) }));

import CountyRunDetailPage from "@/app/(app)/county-runs/[countyRunId]/page";
import LandUsePlanPage from "@/app/(app)/land-use-plans/[planId]/page";
import ContractPage from "@/app/(app)/invoicing/engagements/[engagementId]/page";

beforeEach(() => {
  queries = [];
  failReads = false;
  notFoundMock.mockClear();
  contractAccessMock.mockReset();
});

describe("the county run page", () => {
  const render = (countyRunId: string) => CountyRunDetailPage({ params: Promise.resolve({ countyRunId }) });

  it("renders for a run in the reader's workspace", async () => {
    await expect(render(OWN)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a run that does not exist", NO_SUCH],
    ["another workspace's run", OTHER],
  ])("answers not found for %s", async (_label, id) => {
    await expect(render(id)).rejects.toBe(NOT_FOUND);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("renders the read-failure notice when the run's read fails", async () => {
    failReads = true;
    await expect(render(OWN)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
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
  const refusal = (status: number) => ({ response: new Response(null, { status }) });

  it("answers not found when the contract read refuses (missing, another workspace, or not a manager)", async () => {
    // The read returns 42501, mapped to 403, for all three: one answer, one path.
    contractAccessMock.mockResolvedValue(refusal(403));
    await expect(render(NO_SUCH)).rejects.toBe(NOT_FOUND);
    await expect(render(OTHER)).rejects.toBe(NOT_FOUND);
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the unavailable notice when the read did not complete", async () => {
    contractAccessMock.mockResolvedValue(refusal(503));
    const page = await render(OWN);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(JSON.stringify(page)).toContain("Contract management unavailable");
  });

  it("renders the contract for a reader who may manage it", async () => {
    contractAccessMock.mockResolvedValue({
      state: { engagement: { id: OWN, workspace_id: READER_WORKSPACE } },
      service: {},
    });
    await expect(render(OWN)).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
