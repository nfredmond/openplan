/**
 * KI-2026-11-14-060: a report the reader cannot see answers a real 404.
 *
 * The page streams behind `loading.tsx`, so its own `notFound()` rendered the
 * not-found screen under HTTP 200. `[reportId]/layout.tsx` sits outside that
 * Suspense boundary and now calls `notFound()` first. These tests hold the
 * layout to that, with a fake client that applies row security the way the
 * `reports` SELECT policy does: only rows in the reader's workspaces come back.
 *
 * BLIND CATEGORY: this does not prove the HTTP status. That depends on Next.js
 * rendering this layout before the loading fallback streams, which the cited
 * docs state and the lead checks on a running server. It also does not test
 * the real row-security policy; RLS Isolation in CI does.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
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
const OWN_REPORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_REPORT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NO_SUCH_REPORT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const REPORT_ROWS = [
  { id: OWN_REPORT, workspace_id: READER_WORKSPACE, title: "Own corridor report" },
  { id: OTHER_REPORT, workspace_id: OTHER_WORKSPACE, title: "Another workspace's report" },
];

type Query = { table: string; columns: string; filters: Array<[string, unknown]> };
let queries: Query[] = [];
let failReads = false;

/** A cookie-scoped client stand-in: the reader sees only their workspace's rows. */
function readerClient() {
  return {
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
          if (failReads) return { data: null, error: { message: "connection refused" } };
          const visible = REPORT_ROWS.filter((row) => row.workspace_id === READER_WORKSPACE);
          const match = visible.find((row) => query.filters.every(([column, value]) => row[column as keyof typeof row] === value));
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

const createClientMock = vi.fn(async () => readerClient());
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));

import ReportRecordLayout from "@/app/(app)/reports/[reportId]/layout";
import ReportLoading from "@/app/(app)/reports/[reportId]/loading";
import { ModulePageSkeleton } from "@/components/ui/module-page-skeleton";

const CHILD = <main data-testid="report-page">report</main>;

async function renderLayout(reportId: string) {
  return ReportRecordLayout({ children: CHILD, params: Promise.resolve({ reportId }) });
}

beforeEach(() => {
  queries = [];
  failReads = false;
  notFoundMock.mockClear();
  createClientMock.mockClear();
});

describe("the report record layout", () => {
  it("renders the page for a report the reader's client can see", async () => {
    await expect(renderLayout(OWN_REPORT)).resolves.toBe(CHILD);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("reports");
    expect(queries[0].filters).toEqual([["id", OWN_REPORT]]);
    // The page's own detail projection, so the page can reuse this read.
    expect(queries[0].columns).toMatch(/^id, /);
  });

  it("answers not found for a report that does not exist", async () => {
    await expect(renderLayout(NO_SUCH_REPORT)).rejects.toBe(NOT_FOUND);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("answers not found for a report in another workspace, on the same path as an absent one", async () => {
    await expect(renderLayout(OTHER_REPORT)).rejects.toBe(NOT_FOUND);
    const otherWorkspaceQueries = queries;
    queries = [];
    await expect(renderLayout(NO_SUCH_REPORT)).rejects.toBe(NOT_FOUND);
    // Same query shape, same count, same thrown answer.
    expect(otherWorkspaceQueries.map(({ table, columns, filters }) => [table, columns, filters.map(([column]) => column)])).toEqual(
      queries.map(({ table, columns, filters }) => [table, columns, filters.map(([column]) => column)])
    );
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });

  it("answers not found for a malformed id before any query", async () => {
    await expect(renderLayout("new")).rejects.toBe(NOT_FOUND);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("renders the page when the read fails, so the page can say the report could not be read", async () => {
    failReads = true;
    await expect(renderLayout(OWN_REPORT)).resolves.toBe(CHILD);
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});

describe("the report route's loading state", () => {
  const routeDir = path.join(process.cwd(), "src", "app", "(app)", "reports", "[reportId]");

  it("still exists beside the layout and renders the module skeleton", () => {
    expect(existsSync(path.join(routeDir, "loading.tsx"))).toBe(true);
    expect(renderToStaticMarkup(<ReportLoading />)).toBe(renderToStaticMarkup(<ModulePageSkeleton sections={4} />));
  });

  it("is not wrapped around the layout's check: the page shares the layout's read", () => {
    const page = readFileSync(path.join(routeDir, "page.tsx"), "utf8");
    expect(page).toContain("loadReportDetailRowForRequest(reportId)");
    expect(page).not.toMatch(/loadReportDetailRow\(supabase/);
  });
});
