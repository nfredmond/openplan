import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";

/**
 * A CLOSED REVIEW FREEZES ITS COMMENT COUNTS, SO THEY MUST BE COUNTED.
 *
 * Closing a land use plan's public review writes `outcome_snapshot`, a public
 * record. Its comment counts came from one row read of the campaign's comments,
 * and PostgREST stops a response at 1,000 rows with no error. So a review with
 * 1,237 comments froze "1,000", and a pending comment past row 1,000 was never
 * seen, so the review closed over an unmoderated comment.
 *
 * The fake below holds that cap on every row read and answers `count: "exact"`
 * from the whole store, as PostgREST does. A route that read rows to count them
 * fails here; one that asks the database to count passes.
 */

const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/lib/land-use-plans/api", () => ({ loadLandUsePlanAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "@/app/api/land-use-plans/[planId]/review-releases/route";

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const planId = id(1);
const workspaceId = id(2);
const releaseId = id(3);
const campaignId = id(4);

const POSTGREST_MAX_ROWS = 1000;

type Row = Record<string, unknown>;
let store: Record<string, Row[]>;
let failingCount: string | null;
let snapshots: unknown[];
let queries: Array<{ table: string; calls: Array<[string, ...unknown[]]> }>;

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const calls: Array<[string, ...unknown[]]> = [];
      queries.push({ table, calls });
      let head = false;
      let columns: string[] = [];
      let updatePayload: Row | null = null;
      const matching = () =>
        (store[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value));
      // The fake returns only the selected columns, as PostgREST does.
      const project = (row: Row) =>
        Object.fromEntries(Object.entries(row).filter(([column]) => columns.includes(column)));
      const builder: Record<string, unknown> = {
        select(projection: string, options?: { count?: string; head?: boolean }) {
          calls.push(["select", projection, options]);
          columns = projection.split(",").map((column) => column.trim());
          head = options?.head === true;
          return builder;
        },
        eq(column: string, value: unknown) {
          calls.push(["eq", column, value]);
          filters.push([column, value]);
          return builder;
        },
        neq() {
          return builder;
        },
        order(column: string, options?: unknown) {
          calls.push(["order", column, options]);
          return builder;
        },
        update(payload: Row) {
          updatePayload = payload;
          return builder;
        },
        async range(from: number, toInclusive: number) {
          calls.push(["range", from, toInclusive]);
          const asked = toInclusive - from + 1;
          return { data: matching().slice(from, from + Math.min(asked, POSTGREST_MAX_ROWS)).map(project), error: null };
        },
        async maybeSingle() {
          if (updatePayload) {
            snapshots.push(updatePayload.outcome_snapshot);
            return { data: { id: releaseId, outcome_hash: "hash" }, error: null };
          }
          const row = matching()[0];
          return { data: row ? project(row) : null, error: null };
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const status = filters.find(([column]) => column === "status")?.[1] ?? "total";
          if (head && failingCount === status) {
            return Promise.resolve({ data: null, count: null, error: { message: "statement timeout" } }).then(resolve, reject);
          }
          const value = head
            ? { data: null, count: matching().length, error: null }
            : { data: matching().slice(0, POSTGREST_MAX_ROWS).map(project), error: null };
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function comments(count: number, status: string, offset = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${String(offset + i).padStart(6, "0")}`,
    campaign_id: campaignId,
    status,
    source_type: "public",
  }));
}

function close() {
  return POST(
    new NextRequest(`http://localhost/api/land-use-plans/${planId}/review-releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "close", releaseId, dispositionSummary: null }),
    }),
    { params: Promise.resolve({ planId }) }
  );
}

beforeEach(() => {
  failingCount = null;
  snapshots = [];
  queries = [];
  store = {
    land_use_plan_review_releases: [
      {
        id: releaseId,
        plan_id: planId,
        status: "open",
        review_method: "engagement_campaign",
        engagement_campaign_id: campaignId,
        version_id: id(5),
        version_content_hash: "a".repeat(64),
      },
    ],
    engagement_campaigns: [{ id: campaignId, workspace_id: workspaceId, status: "closed" }],
    engagement_items: [...comments(1234, "approved"), ...comments(3, "rejected", 1234)],
    engagement_closeloop_entries: [],
  };
  mocks.access.mockResolvedValue({
    ok: true,
    access: {
      supabase: fakeClient(),
      userId: id(6),
      plan: { id: planId, workspace_id: workspaceId },
      canWrite: true,
    },
  });
});

describe("closing a land use plan review counts every comment", () => {
  it("freezes the full comment counts of a campaign above 1,000 comments", async () => {
    const response = await close();

    expect(response.status).toBe(200);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      method: "engagement_campaign",
      campaignId,
      commentCounts: { total: 1237, byStatus: { approved: 1234, rejected: 3, pending: 0, flagged: 0 } },
    });
    const countQueries = queries.filter((query) => query.table === "engagement_items");
    expect(countQueries).toHaveLength(5);
    for (const query of countQueries) {
      expect(query.calls[0]).toEqual(["select", "id", { count: "exact", head: true }]);
      expect(query.calls).toContainEqual(["eq", "campaign_id", campaignId]);
    }
  });

  it("refuses to close while a pending comment sits past row 1,000", async () => {
    store.engagement_items = [...comments(1200, "approved"), ...comments(1, "pending", 1200)];

    const response = await close();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ pendingCount: 1 });
    expect(snapshots).toHaveLength(0);
  });

  it("refuses to freeze an outcome when a count fails", async () => {
    failingCount = "rejected";

    const response = await close();

    expect(response.status).toBe(500);
    expect(snapshots).toHaveLength(0);
  });

  it("hashes every published response past the 1,000-row cap, in a total order", async () => {
    store.engagement_closeloop_entries = Array.from({ length: 1050 }, (_, i) => ({
      id: `entry-${String(i).padStart(6, "0")}`,
      campaign_id: campaignId,
      status: "published",
      theme_title: `Theme ${i}`,
      you_said: "You said",
      we_did: "We did",
      source_item_ids: [],
      published_at: "2026-10-01T00:00:00.000Z",
    }));

    const response = await close();

    expect(response.status).toBe(200);
    const entries = (snapshots[0] as { publishedCloseLoopEntries: Array<{ id: string; hash: string }> })
      .publishedCloseLoopEntries;
    expect(entries).toHaveLength(1050);
    // The hash covers the projected columns only, as the route selects them.
    expect(entries[0].hash).toBe(
      hashFrozenRecord({
        id: "entry-000000",
        theme_title: "Theme 0",
        you_said: "You said",
        we_did: "We did",
        source_item_ids: [],
        published_at: "2026-10-01T00:00:00.000Z",
      })
    );
    const responseQuery = queries.find((query) => query.table === "engagement_closeloop_entries");
    expect(responseQuery?.calls[0]).toEqual([
      "select",
      "id, theme_title, you_said, we_did, source_item_ids, published_at",
      undefined,
    ]);
    expect(responseQuery?.calls.filter(([method]) => method === "order").map(([, column]) => column)).toEqual([
      "sort_order",
      "id",
    ]);
  });
});
