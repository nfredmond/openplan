import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE DATA HUB'S CLAIM ABOUT TRANSIT FEEDS.
 *
 * "Foundation sources" carried a hardcoded card reading "GTFS uploads —
 * Transit feed storage already exists in the current architecture and can fold
 * into this registry", printed under the heading "Visible system component"
 * beside registries backed by real reads. It described nine empty tables, and
 * the only action it supported was a search for a control nobody had built.
 *
 * These tests drive the REAL page against a recording Supabase double, because
 * the defect was never in the wording function: it was that no read existed.
 * A test of the helper alone would pass with the page still rendering a
 * constant.
 *
 * ================= WHAT THESE TESTS ASSERTED UNTIL THE INGEST LANE SHIPPED
 *
 * Three of them pinned the OPPOSITE claim — that the page linked nowhere to
 * ingest a feed, that "OpenPlan does not have a feed upload path yet", and that
 * the kicker read "Schema only — no ingest path yet". Every one of those was
 * the honest sentence at the time and every one became FALSE when
 * `/api/gtfs/catalog/search`, `/api/gtfs/feeds` and `/api/gtfs/feeds/upload`
 * landed with a panel calling them.
 *
 * THEY WERE REWRITTEN, NOT DELETED, and the distinction is the point. A claim
 * boundary that is dropped the moment it becomes inconvenient stops being a
 * boundary; the guard has to keep pointing at the same sentence and simply
 * demand the other answer. So each now asserts the NEW truth AND that the OLD
 * wording is gone — which is what makes a silent regression to "no ingest path
 * yet" a failure rather than a shrug.
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
/** What `gtfs_feed_versions` answers — where the service window lives. */
let transitFeedVersionsResult: { data: unknown; error: { message: string } | null };
/** Every prop the ingest panel was mounted with, or null if it never mounted. */
let ingestPanelProps: Record<string, unknown> | null = null;

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

/**
 * THE PANEL IS DOUBLED, AND WHAT IT IS DOUBLED FOR IS ITS PROPS.
 *
 * The panel is a client component that fetches on mount and mounts
 * `StudyAreaPicker`, which lazily loads a Mapbox surface — none of which this
 * file is about. What this file IS about is whether the page MOUNTS it and
 * hands it this workspace's identity, because a panel rendered with the wrong
 * workspace id, or not rendered at all, is exactly the "shipped invisible"
 * defect the card's old wording described. The double records every prop so the
 * assertions below can check the binding rather than the existence of a div —
 * and one test varies the role so "threads the value" is distinguishable from
 * "hardcodes it". The panel's own behaviour is proved in
 * `gtfs-ingest-panel.test.tsx`, against the real component.
 */
vi.mock("@/components/data-hub/gtfs-ingest-panel", () => ({
  GtfsIngestPanel: (props: Record<string, unknown>) => {
    ingestPanelProps = props;
    return <div data-testid="gtfs-ingest-panel" />;
  },
}));

import DataHubPage from "@/app/(app)/data-hub/page";
import { BODY_LIMITS } from "@/lib/http/body-limit";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";

async function renderPage() {
  render(await DataHubPage());
}

/** The `gtfs_feeds` select this render issued, if any. */
function transitProjection(): string | undefined {
  return recordedSelects.find((entry) => entry.table === "gtfs_feeds")?.columns;
}

/** The `gtfs_feed_versions` select this render issued, if any. */
function transitVersionProjection(): string | undefined {
  return recordedSelects.find((entry) => entry.table === "gtfs_feed_versions")?.columns;
}

describe("DataHubPage — the transit feed card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordedSelects = [];
    transitFeedsResult = { data: [], error: null };
    transitFeedVersionsResult = { data: [], error: null };
    ingestPanelProps = null;

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
        makeChain(table, () => {
          if (table === "gtfs_feeds") return transitFeedsResult;
          if (table === "gtfs_feed_versions") return transitFeedVersionsResult;
          return { data: [], error: null };
        })
      ),
    });
  });

  it("no longer claims transit feed uploads already work", async () => {
    await renderPage();

    // The shipped sentence, and the two claims inside it. The card described
    // nine empty tables as a working capability; that wording must not return
    // even now that a real capability exists, because it was never a
    // description of THIS workspace's feeds.
    expect(screen.queryByText(/Transit feed storage already exists/i)).toBeNull();
    expect(screen.queryByText(/can fold into this registry/i)).toBeNull();
    expect(screen.queryByText(/^GTFS uploads$/)).toBeNull();
  });

  /**
   * REWRITTEN, NOT DELETED. This test used to require the sentence "OpenPlan
   * does not have a feed upload path yet" and the kicker "Schema only — no
   * ingest path yet". Both were honest until the ingest lane shipped and are
   * now false, so the assertion is inverted onto the same sentences: the old
   * wording must be ABSENT, and the card must name the three doors that exist.
   */
  it("tells a workspace with no feed that none has been ingested, and where the three doors are", async () => {
    transitFeedsResult = { data: [], error: null };

    await renderPage();

    expect(screen.getByText(/No transit feed has been ingested for this workspace yet/i)).toBeInTheDocument();
    expect(screen.getByText(/search the public feed catalog/i)).toBeInTheDocument();
    expect(screen.getByText(/upload a GTFS \.zip/i)).toBeInTheDocument();

    // The claim that became a lie, pinned so it cannot come back.
    expect(screen.queryByText(/does not have a feed upload path yet/i)).toBeNull();
    expect(screen.queryByText(/Schema only — no ingest path yet/i)).toBeNull();
    expect(screen.getByText(/No feed ingested yet — add one below/i)).toBeInTheDocument();
  });

  /**
   * REWRITTEN, NOT DELETED. The original asserted that NO href matched
   * `/gtfs|transit-feed|feeds?\/(new|upload|import)/` "because no such route
   * exists". Five such routes exist now, so the honest form of the same guard
   * is the opposite claim: the ingest lane must be REACHABLE from this page.
   *
   * It is asserted on the mounted panel and its workspace binding rather than
   * on an href, because the lane is reached by `fetch` from a client component
   * and not by navigation — an href assertion would now be checking for
   * something the design does not have.
   */
  it("puts the ingest lane on the page, bound to this workspace", async () => {
    await renderPage();

    expect(screen.getByTestId("gtfs-ingest-panel")).toBeInTheDocument();
    expect(ingestPanelProps?.workspaceId).toBe(WORKSPACE_ID);
    // The upload ceiling is threaded from the server because the client may not
    // import `@/lib/http/body-limit` (it pulls `next/server` into the bundle).
    expect(typeof ingestPanelProps?.maxUploadBytes).toBe("number");
    expect(ingestPanelProps?.maxUploadBytes).toBe(BODY_LIMITS.gtfsFeedRaw);
    // Expiry must not depend on a browser clock, so the day is server-supplied.
    expect(ingestPanelProps?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ingestPanelProps?.readOnly).toBe(false);
  });

  /**
   * THE BINDING IS VARIED, because one fixture cannot tell "threads the role"
   * from "passes a constant". An owner renders a writable panel above; a viewer
   * must render a read-only one.
   */
  it("hands the panel a read-only flag derived from the member's own role", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      workspace: { id: WORKSPACE_ID, name: "Planning Workspace" },
    });

    await renderPage();

    expect(ingestPanelProps?.readOnly).toBe(true);
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

  /**
   * EXPIRY IS THE NORMAL CASE, NOT AN EDGE CASE.
   *
   * Measured on the live Mobility Database on 2026-08-05, three of the four
   * Sacramento-area feeds had already ended — SacRT's on 2025-04-05. A card
   * that prints `status = 'loaded'` over a schedule that stopped a year ago
   * reports on the INGEST and lets the reader infer the SERVICE.
   */
  it("says a loaded feed's schedule has expired, rather than only that it loaded", async () => {
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
    transitFeedVersionsResult = {
      data: [
        {
          feed_id: "feed-1",
          workspace_id: WORKSPACE_ID,
          service_start_date: "2024-08-01",
          service_end_date: "2025-04-05",
          route_service_level_rows: 42,
          stop_service_level_rows: 18_141,
        },
      ],
      error: null,
    };

    await renderPage();

    expect(screen.getByText(/that schedule ENDED/i)).toBeInTheDocument();
    expect(screen.getByText(/2025-04-05/)).toBeInTheDocument();
    expect(screen.getByText(/historic service levels/i)).toBeInTheDocument();
  });

  /**
   * A version row whose `workspace_id` is NULL belongs to a PUBLIC preloaded
   * feed shared by every tenant. Matching it on `feed_id` alone would print
   * some other deployment-wide feed's service window under this workspace's
   * agency name — the same misattribution the feed read is scoped against.
   */
  it("does not borrow a public feed's service window for this workspace's feed", async () => {
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
    transitFeedVersionsResult = {
      data: [
        {
          feed_id: "feed-1",
          workspace_id: null,
          service_start_date: "2024-08-01",
          service_end_date: "2025-04-05",
          route_service_level_rows: 42,
          stop_service_level_rows: 18_141,
        },
      ],
      error: null,
    };

    await renderPage();

    expect(screen.queryByText(/2025-04-05/)).toBeNull();
    expect(screen.getByText(/No ingest of this feed has been adopted yet/i)).toBeInTheDocument();
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

  /**
   * THE SAME ASSERTION FOR THE COLUMN THAT CARRIES EXPIRY.
   *
   * `service_end_date` is the whole reason the version read exists. Because the
   * clients are untyped and the double answers with its fixture whatever was
   * asked for, dropping it from the `.select()` would leave every expiry
   * assertion above green while the real page compared `undefined` to today and
   * silently reported every expired feed as current. This is the only place a
   * unit test can see that.
   *
   * The `is_current` / `status` filters are asserted for a different reason:
   * they are `filterToCurrentReadyVersion`, the codebase's one expression of
   * "the version this workspace analyses with". Filtering on `is_current` alone
   * would read a promoted-then-failed version as service data; filtering on
   * `status` alone would show three successful ingests as three feeds.
   */
  it("asks the database for the service window, scoped to this workspace's adopted version", async () => {
    await renderPage();

    const projection = transitVersionProjection();
    expect(projection).toBeDefined();
    for (const column of [
      "feed_id",
      "workspace_id",
      "service_start_date",
      "service_end_date",
      "route_service_level_rows",
      "stop_service_level_rows",
    ]) {
      expect(projection).toContain(column);
    }

    const versionSelect = recordedSelects.find((entry) => entry.table === "gtfs_feed_versions");
    expect(versionSelect?.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(versionSelect?.filters).toContainEqual(["is_current", true]);
    expect(versionSelect?.filters).toContainEqual(["status", "ready"]);
  });

  /**
   * THE FAILED-READ-AS-EMPTY-READ DEFECT, ON THE SECOND TABLE.
   *
   * This test used to assert only that no expiry was claimed — which passed
   * while the card was printing "No ingest of this feed has been adopted yet"
   * beside a green "loaded" badge, because the page threaded `readFailed` from
   * the FEED read alone and collapsed the version rows with `data ?? []`. The
   * absent-expiry assertion is kept and the sentence the page actually rendered
   * is now pinned: a failed read must say it failed, must not be the
   * adopted-nothing sentence, and must not wear a success tone.
   */
  it("says the version read failed, rather than reporting the feed as having adopted nothing", async () => {
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
    transitFeedVersionsResult = { data: null, error: { message: "permission denied for table gtfs_feed_versions" } };

    await renderPage();

    // A failed version read must not become "this feed has no adopted version
    // that expired" — it must simply say nothing about the window.
    expect(screen.queryByText(/that schedule ENDED/i)).toBeNull();
    expect(screen.getByText(/Mountain Transit/)).toBeInTheDocument();

    expect(screen.getByText(/adopted version of this feed could not be read/i)).toBeInTheDocument();
    expect(screen.queryByText(/No ingest of this feed has been adopted yet/i)).toBeNull();

    /**
     * AND THE BADGE MAY NOT BE GREEN OVER IT.
     *
     * Tone is only visible from this page as the class `StatusBadge` picks —
     * `--pine` is the success tone and `--copper` the warning one. The card
     * carries the feed's `status = 'loaded'`, which is exactly what would make
     * this badge read as success while the sentence beside it describes an
     * unanswered question.
     */
    const badge = screen.getByText("Transit feeds (GTFS)");
    expect(badge.className).toContain("copper");
    expect(badge.className).not.toContain("pine");
  });
});
