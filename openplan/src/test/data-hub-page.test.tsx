import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE DATA HUB'S CLAIM ABOUT TRANSIT FEEDS.
 *
 * "Foundation sources" carried a hardcoded card reading "GTFS uploads —
 * Transit feed storage already exists in the current architecture and can fold
 * into this registry", printed under the heading "Visible system component"
 * beside registries backed by real reads. It described nine empty tables. There
 * is no upload route, no parser, no ingest worker, and nothing in `src/` reads
 * or writes `gtfs_feeds` at all — so the only action the card supports is a
 * search for a control that has never been built.
 *
 * These tests drive the REAL page against a recording Supabase double, because
 * the defect was never in the wording function: it was that no read existed.
 * A test of the helper alone would pass with the page still rendering a
 * constant.
 */

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const WORKSPACE_ID = "workspace-1";

/** Every `.select()` this render issued, as `{ table, columns, filters }`. */
type RecordedSelect = { table: string; columns: string; filters: Array<[string, unknown]> };
let recordedSelects: RecordedSelect[] = [];

/** What `gtfs_feeds` answers. Varied per test; this is the whole subject. */
let transitFeedsResult: { data: unknown; error: { message: string } | null };

function makeChain(table: string, resolve: () => { data: unknown; error: unknown }) {
  const record: RecordedSelect = { table, columns: "", filters: [] };
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((columns: string) => {
    record.columns = columns;
    recordedSelects.push(record);
    return chain;
  });
  chain.eq = vi.fn((column: string, value: unknown) => {
    record.filters.push([column, value]);
    return chain;
  });
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => resolve());
  chain.single = vi.fn(async () => resolve());
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );

  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

vi.mock("@/components/cartographic/cartographic-surface-wide", () => ({
  CartographicSurfaceWide: () => <div data-testid="cartographic-surface" />,
}));

vi.mock("@/components/data-hub/data-hub-record-composer", () => ({
  DataHubRecordComposer: () => <div data-testid="data-hub-record-composer" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

import DataHubPage from "@/app/(app)/data-hub/page";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";

async function renderPage() {
  render(await DataHubPage());
}

/** The `gtfs_feeds` select this render issued, if any. */
function transitProjection(): string | undefined {
  return recordedSelects.find((entry) => entry.table === "gtfs_feeds")?.columns;
}

describe("DataHubPage — the transit feed card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordedSelects = [];
    transitFeedsResult = { data: [], error: null };

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "owner" },
      workspace: { id: WORKSPACE_ID, name: "Planning Workspace" },
    });
    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue(
      buildWorkspaceOperationsSummaryFromSourceRows({
        projects: [],
        plans: [],
        programs: [],
        reports: [],
        fundingOpportunities: [],
      })
    );

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) =>
        makeChain(table, () =>
          table === "gtfs_feeds" ? transitFeedsResult : { data: [], error: null }
        )
      ),
    });
  });

  it("no longer claims transit feed uploads already work", async () => {
    await renderPage();

    // The shipped sentence, and the two claims inside it. Both are false: the
    // storage exists and the capability does not, which is the distinction the
    // card erased.
    expect(screen.queryByText(/Transit feed storage already exists/i)).toBeNull();
    expect(screen.queryByText(/can fold into this registry/i)).toBeNull();
    expect(screen.queryByText(/^GTFS uploads$/)).toBeNull();
  });

  it("tells a workspace with no feed that none has been ingested, and why", async () => {
    transitFeedsResult = { data: [], error: null };

    await renderPage();

    expect(screen.getByText(/No transit feed has been ingested for this workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/does not have a feed upload path yet/i)).toBeInTheDocument();
    // The panel's blanket "Visible system component" kicker is not printed over
    // a capability that does not exist.
    expect(screen.getByText(/Schema only — no ingest path yet/i)).toBeInTheDocument();
  });

  it("does not link anywhere to ingest a feed, because no such route exists", async () => {
    await renderPage();

    const hrefs = Array.from(document.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href") ?? "");
    expect(hrefs.some((href) => /gtfs|transit-feed|feeds?\/(new|upload|import)/i.test(href))).toBe(false);
  });

  it("shows the agency, status and load time when a feed is registered", async () => {
    transitFeedsResult = {
      data: [
        {
          id: "feed-1",
          workspace_id: WORKSPACE_ID,
          agency_name: "Mountain Transit",
          status: "loaded",
          loaded_at: "2026-08-01T00:00:00.000Z",
        },
      ],
      error: null,
    };

    await renderPage();

    expect(screen.getByText(/Mountain Transit/)).toBeInTheDocument();
    expect(screen.queryByText(/No transit feed has been ingested/i)).toBeNull();
  });

  it("says nothing about feeds when the registry read failed", async () => {
    transitFeedsResult = { data: null, error: { message: "permission denied for table gtfs_feeds" } };

    await renderPage();

    expect(screen.getByText(/transit feed registry could not be read/i)).toBeInTheDocument();
    // The `data ?? []` collapse would have reported this workspace as having no
    // feed — a claim about the agency's own data made from a failed question.
    expect(screen.queryByText(/No transit feed has been ingested/i)).toBeNull();
  });

  /**
   * ASSERTED ON THE PROJECTION STRING, NOT ON THE RENDER.
   *
   * The double above answers with its fixture whatever the `.select()` asked
   * for, and the Supabase clients are deliberately untyped, so dropping a
   * column from the query leaves every assertion in this file green while the
   * real page renders `undefined`. This is the only place a unit test can see
   * it — the same guard `public-engagement-page.test.tsx` carries.
   *
   * The `workspace_id` filter is asserted for a second reason:
   * `gtfs_feeds.workspace_id` is NULLABLE and a null row is a PUBLIC preloaded
   * feed. An unscoped read would show this workspace a stranger's agency as
   * their own ingested feed, and every assertion above would still pass.
   */
  it("asks the database for the feed columns it renders, scoped to this workspace", async () => {
    await renderPage();

    const projection = transitProjection();
    expect(projection).toBeDefined();
    for (const column of ["id", "workspace_id", "agency_name", "status", "loaded_at"]) {
      expect(projection).toContain(column);
    }

    const feedSelect = recordedSelects.find((entry) => entry.table === "gtfs_feeds");
    expect(feedSelect?.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
  });
});
