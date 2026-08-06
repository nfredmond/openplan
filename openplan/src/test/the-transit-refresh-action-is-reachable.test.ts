import { describe, expect, it, vi } from "vitest";

/**
 * The workspace operations summary is a large independent read with no bearing
 * on transit. Stubbing it keeps this file about the one seam it is named for.
 */
vi.mock("@/lib/operations/workspace-summary", () => ({
  loadWorkspaceOperationsSummaryForWorkspace: async () => ({
    posture: "under control",
    nextCommand: null,
    nextActions: [],
    commandQueue: [],
    fullCommandQueue: [],
    counts: {
      queueDepth: 0,
      reportRefreshRecommended: 0,
      reportNoPacket: 0,
      rtpFundingReviewPackets: 0,
      projectFundingNeedAnchorProjects: 0,
      projectFundingSourcingProjects: 0,
      projectFundingDecisionProjects: 0,
      projectFundingAwardRecordProjects: 0,
      projectFundingReimbursementStartProjects: 0,
      projectFundingReimbursementActiveProjects: 0,
      projectFundingGapProjects: 0,
    },
  }),
}));

import { buildAssistantOperations } from "@/lib/assistant/operations";
import { loadAssistantContext, type WorkspaceAssistantContext } from "@/lib/assistant/context";
import {
  buildWorkspaceTransitSummary,
  GTFS_REFRESH_OFFER_WINDOW_DAYS,
  type GtfsAssistantFeedRow,
  type GtfsAssistantVersionRow,
  type WorkspaceTransitSummary,
} from "@/lib/gtfs/assistant-summary";
import type { AssistantQuickLink } from "@/lib/assistant/catalog";

/**
 * CAN A PLANNER ACTUALLY REACH `refresh_gtfs_feed`? — asked of a workspace the
 * product can really produce, not of a fixture that describes one.
 *
 * This repository's signature defect is a capability that is complete, tested,
 * access-gated and reviewed, and that no person can get to. A registered action
 * with no `quickLink({ executeAction })` call site is one shape of it.
 * `record_stage_gate_hold` shipped a WORSE shape: a call site whose condition no
 * real state could satisfy. Its reachability test passed because the fixture
 * hand-described a board `buildProjectStageGateSummary` cannot emit — the
 * assertion was true and the feature was unreachable.
 *
 * So nothing here describes a transit summary. Every case starts from
 * `buildWorkspaceTransitSummary` running over the row shapes the database really
 * holds, and the last block starts one level further back still: from
 * `loadAssistantContext` reading a stubbed Supabase, which is the only way to
 * find out whether the loader hands the builder anything at all.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-08-06";

function feedRow(overrides: Partial<GtfsAssistantFeedRow> & { id: string }): GtfsAssistantFeedRow {
  return {
    agency_name: "Foothill Transit District",
    source_kind: "catalog",
    feed_url: "https://example.org/feeds/foothill.zip",
    catalog_source_id: "mdb-1234",
    ...overrides,
  };
}

function versionRow(feedId: string, serviceEndDate: string | null): GtfsAssistantVersionRow {
  return { feed_id: feedId, service_end_date: serviceEndDate };
}

function summaryFor(
  feeds: GtfsAssistantFeedRow[],
  currentVersions: GtfsAssistantVersionRow[],
  options?: { readable?: boolean; today?: string }
): WorkspaceTransitSummary {
  return buildWorkspaceTransitSummary({
    feeds,
    currentVersions,
    today: options?.today ?? TODAY,
    readable: options?.readable ?? true,
  });
}

/**
 * The rest of a workspace context, with `transit` supplied by the caller.
 *
 * Everything OTHER than transit is inert here on purpose — the point of the
 * assertions below is that the transit clause alone decides whether the link
 * appears, so any funding or run state would only add noise to the list.
 */
function workspaceContext(transit: WorkspaceTransitSummary): WorkspaceAssistantContext {
  return {
    kind: "workspace",
    workspace: { id: WORKSPACE_ID, name: "Foothill COG", role: "owner" },
    recentProject: null,
    recentRuns: [],
    currentRun: null,
    baselineRun: null,
    operationsSummary: {
      posture: "under control",
      nextCommand: null,
      commandQueue: [],
      fullCommandQueue: [],
      counts: {
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
      },
    },
    transit,
  } as unknown as WorkspaceAssistantContext;
}

function refreshLink(transit: WorkspaceTransitSummary): AssistantQuickLink | undefined {
  return buildAssistantOperations(workspaceContext(transit)).find(
    (link) => link.executeAction?.kind === "refresh_gtfs_feed"
  );
}

type RefreshAction = Extract<
  NonNullable<AssistantQuickLink["executeAction"]>,
  { kind: "refresh_gtfs_feed" }
>;

/* -------------------------------------------------------------------------- */
/* The offer, against summaries the builder really produces                    */
/* -------------------------------------------------------------------------- */

describe("the transit refetch offer is reachable from the workspace copilot", () => {
  it("appears for a catalog feed whose schedule has already stopped running", () => {
    // THE STATE THIS OFFER EXISTS FOR, and it is the common one rather than an
    // edge: three of four Sacramento-area feeds measured on 2026-08-05 had
    // already expired. If the link is absent here it is absent for everyone.
    const transit = summaryFor(
      [feedRow({ id: "feed-expired" })],
      [versionRow("feed-expired", "2025-04-05")]
    );

    expect(transit.staleRefetchableFeed?.id).toBe("feed-expired");
    expect(transit.staleRefetchableFeed?.serviceDaysRemaining).toBeLessThan(0);

    const link = refreshLink(transit);
    expect(link, "no quick link offers refresh_gtfs_feed for an expired, refetchable feed").toBeDefined();
    expect(link?.approval).toBe("approval_required");
    expect(link?.label).toContain("Foothill Transit District");
    expect(link?.reason).toContain("2025-04-05");

    const action = link?.executeAction as RefreshAction;
    expect(action.workspaceId).toBe(WORKSPACE_ID);
    expect(action.gtfsFeedId).toBe("feed-expired");

    // The payload is two ids and the three presentation-only chaining fields —
    // nothing else. In particular there is no `adoptDespiteCollapse` to send,
    // which is the first of the two locks on it (the route's own
    // `refuseOutOfScopeAgentRequest` is the second).
    expect(Object.keys(action).sort()).toEqual([
      "gtfsFeedId",
      "kind",
      "postActionPrompt",
      "postActionPromptLabel",
      "postActionWorkflowId",
      "workspaceId",
    ]);
  });

  it("appears for a feed whose schedule runs out inside the offer window", () => {
    const endingSoon = "2026-08-20"; // 14 days after TODAY
    const transit = summaryFor([feedRow({ id: "feed-soon" })], [versionRow("feed-soon", endingSoon)]);

    expect(transit.staleRefetchableFeed?.serviceDaysRemaining).toBe(14);
    expect(14).toBeLessThanOrEqual(GTFS_REFRESH_OFFER_WINDOW_DAYS);

    const link = refreshLink(transit);
    expect(link).toBeDefined();
    expect(link?.reason).toContain("14 days");
  });

  it("stays away when the schedule still has months to run", () => {
    // Otherwise the offer is permanently present, and an offer that is always
    // there carries no information about the workspace at all.
    const transit = summaryFor([feedRow({ id: "feed-fresh" })], [versionRow("feed-fresh", "2027-06-30")]);
    expect(transit.staleRefetchableFeed).toBeNull();
    expect(refreshLink(transit)).toBeUndefined();
  });

  it("stays away for an uploaded archive, which has no address to fetch again", () => {
    // Mirrors the route's own 422. An offer looser than the endpoint would be a
    // quick link that always fails.
    const transit = summaryFor(
      [feedRow({ id: "feed-upload", source_kind: "upload", feed_url: null, catalog_source_id: null })],
      [versionRow("feed-upload", "2025-01-01")]
    );

    expect(transit.feeds[0].refetchable).toBe(false);
    expect(transit.feeds[0].notRefetchableReason).toBe("uploaded_archive");
    expect(refreshLink(transit)).toBeUndefined();
  });

  it("stays away for a feed with no recorded address at all", () => {
    const transit = summaryFor(
      [feedRow({ id: "feed-addressless", source_kind: "url", feed_url: null, catalog_source_id: null })],
      [versionRow("feed-addressless", "2025-01-01")]
    );

    expect(transit.feeds[0].notRefetchableReason).toBe("no_recorded_address");
    expect(refreshLink(transit)).toBeUndefined();
  });

  it("stays away when the feed has no ready version, because staleness is then unknown", () => {
    // An ingest that never completed leaves a feed row with no current, ready
    // version. "We cannot tell whether this schedule is running" is not a reason
    // to fetch an agency's server.
    const transit = summaryFor([feedRow({ id: "feed-unparsed" })], []);
    expect(transit.feeds[0].serviceEndDate).toBeNull();
    expect(transit.feeds[0].serviceDaysRemaining).toBeNull();
    expect(refreshLink(transit)).toBeUndefined();
  });

  it("stays away when the transit read failed, even with a stale feed in hand", () => {
    // `readable: false` is what a revoked grant or a dropped connection looks
    // like. Acting on a summary the console could not read would be the copilot
    // proposing a change to a state it never saw.
    const transit = summaryFor(
      [feedRow({ id: "feed-expired" })],
      [versionRow("feed-expired", "2025-04-05")],
      { readable: false }
    );

    expect(transit.staleRefetchableFeed).not.toBeNull();
    expect(refreshLink(transit)).toBeUndefined();
  });

  it("names one feed, deterministically, when several are stale", () => {
    // Nine offers each fetching a different agency's archive is a wall, not a
    // queue — and a link that names a different feed on every render is worse
    // than no link, because a planner cannot tell an approval sheet apart from
    // the last one they read.
    const feeds = [
      feedRow({ id: "feed-c", agency_name: "C Transit" }),
      feedRow({ id: "feed-a", agency_name: "A Transit" }),
      feedRow({ id: "feed-b", agency_name: "B Transit" }),
    ];
    const versions = [
      versionRow("feed-c", "2025-04-05"),
      versionRow("feed-a", "2025-04-05"),
      versionRow("feed-b", "2024-01-01"),
    ];

    const first = summaryFor(feeds, versions);
    const second = summaryFor([...feeds].reverse(), [...versions].reverse());

    // Soonest-expiring wins outright...
    expect(first.staleRefetchableFeed?.id).toBe("feed-b");
    // ...and the answer does not depend on row order.
    expect(second.staleRefetchableFeed?.id).toBe("feed-b");

    const links = buildAssistantOperations(workspaceContext(first)).filter(
      (link) => link.executeAction?.kind === "refresh_gtfs_feed"
    );
    expect(links).toHaveLength(1);
  });

  it("breaks a tie on id rather than on row order", () => {
    const feeds = [feedRow({ id: "feed-z" }), feedRow({ id: "feed-a" })];
    const versions = [versionRow("feed-z", "2025-04-05"), versionRow("feed-a", "2025-04-05")];

    expect(summaryFor(feeds, versions).staleRefetchableFeed?.id).toBe("feed-a");
    expect(summaryFor([...feeds].reverse(), [...versions].reverse()).staleRefetchableFeed?.id).toBe(
      "feed-a"
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The loader, which is the half a builder test cannot see                     */
/* -------------------------------------------------------------------------- */

/**
 * Every read `loadWorkspaceContext` makes, recorded as it is made.
 *
 * The filters are captured as well as the table, because two of them are the
 * whole safety argument: `gtfs_feeds` must be filtered to THIS workspace (a NULL
 * `workspace_id` is a public preloaded feed every tenant reads, and `.eq()`
 * never matches NULL), and the version read must go through
 * `filterToCurrentReadyVersion` rather than pick either half of that predicate.
 */
type RecordedRead = {
  table: string;
  projection: string | null;
  filters: Array<{ verb: string; column: string; value: unknown }>;
};

function createSupabaseStub(rows: Record<string, unknown[]>) {
  const reads: RecordedRead[] = [];

  const from = (table: string) => {
    const read: RecordedRead = { table, projection: null, filters: [] };

    const chain: Record<string, unknown> = {};
    const self = () => chain;

    chain.select = (projection?: string) => {
      read.projection = projection ?? null;
      reads.push(read);
      return chain;
    };
    for (const verb of ["eq", "is", "in", "not", "gte", "lte"]) {
      chain[verb] = (column: string, value: unknown) => {
        read.filters.push({ verb, column, value });
        return chain;
      };
    }
    chain.order = self;
    chain.limit = async () => ({ data: rows[table] ?? [], error: null });
    chain.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject);

    return chain;
  };

  return { supabase: { from } as never, reads };
}

describe("the loader fills the field the offer reads", () => {
  const stubRows = {
    workspace_members: [
      {
        workspace_id: WORKSPACE_ID,
        role: "owner",
        workspaces: { id: WORKSPACE_ID, name: "Foothill COG" },
      },
    ],
    projects: [],
    runs: [],
    gtfs_feeds: [{ id: "feed-expired", ...feedRow({ id: "feed-expired" }) }],
    gtfs_feed_versions: [versionRow("feed-expired", "2025-04-05")],
  };

  it("reads the workspace's own feeds and their current service window, and offers the refetch", async () => {
    const { supabase, reads } = createSupabaseStub(stubRows);

    const context = (await loadAssistantContext(supabase, "user-1", {
      kind: "workspace",
      id: null,
      workspaceId: WORKSPACE_ID,
      runId: null,
      baselineRunId: null,
    })) as WorkspaceAssistantContext | null;

    expect(context, "the workspace context did not load at all").not.toBeNull();

    // THE WHOLE POINT OF THIS BLOCK. A builder test proves the derivation; only
    // this proves the loader calls it. Without it, deleting the read would leave
    // every assertion above green and no planner would ever see the offer.
    expect(context?.transit.readable).toBe(true);
    expect(context?.transit.staleRefetchableFeed?.id).toBe("feed-expired");
    expect(refreshLink(context!.transit)).toBeDefined();

    const feedRead = reads.find((entry) => entry.table === "gtfs_feeds");
    expect(feedRead, "the loader never read gtfs_feeds").toBeDefined();
    // The clients are untyped, so a dropped column renders `undefined` with the
    // suite green — CLAUDE.md's standing instruction is to assert the projection.
    expect(feedRead?.projection).toContain("source_kind");
    expect(feedRead?.projection).toContain("catalog_source_id");
    expect(feedRead?.filters).toContainEqual({
      verb: "eq",
      column: "workspace_id",
      value: WORKSPACE_ID,
    });

    const versionRead = reads.find((entry) => entry.table === "gtfs_feed_versions");
    expect(versionRead, "the loader never read gtfs_feed_versions").toBeDefined();
    expect(versionRead?.projection).toContain("service_end_date");
    // BOTH HALVES of the shared predicate, which is what
    // `filterToCurrentReadyVersion` applies. `is_current` alone reads a
    // promoted-then-failed version as service data; `status` alone gives a
    // workspace with three successful ingests three service windows.
    expect(versionRead?.filters).toContainEqual({ verb: "eq", column: "is_current", value: true });
    expect(versionRead?.filters).toContainEqual({ verb: "eq", column: "status", value: "ready" });
  });

  it("reports a workspace with no transit feeds as readable and empty", async () => {
    const { supabase } = createSupabaseStub({ ...stubRows, gtfs_feeds: [], gtfs_feed_versions: [] });

    const context = (await loadAssistantContext(supabase, "user-1", {
      kind: "workspace",
      id: null,
      workspaceId: WORKSPACE_ID,
      runId: null,
      baselineRunId: null,
    })) as WorkspaceAssistantContext | null;

    // "No feeds" and "could not look" must not collapse into one another — the
    // second is what a copilot would otherwise state as a fact about the agency.
    expect(context?.transit).toEqual({ readable: true, feeds: [], staleRefetchableFeed: null });
    expect(refreshLink(context!.transit)).toBeUndefined();
  });
});
