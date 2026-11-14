import { describe, expect, it } from "vitest";

import {
  COMMENT_READ_CAP,
  loadDashboardChartRows,
  RUN_READ_CAP,
  RUN_READ_COLUMNS,
  type DashboardChartSupabaseLike,
} from "@/lib/dashboard/chart-reads";

/**
 * THE READS THE CHARTS STAND ON.
 *
 * Supabase clients in this repo are untyped, so a `.select()` string is not
 * checked against the schema and a mocked client cannot catch a missing column.
 * These tests therefore assert on the QUERY ITSELF — the projection string, the
 * table, and every filter — because that string is the access control for the
 * one table here that has no `workspace_id` of its own.
 *
 * `engagement_items` is scoped through its campaign. Drop the `!inner` and
 * PostgREST keeps the child row with a null parent, which puts another
 * workspace's comments on this workspace's chart. That is the decoy below.
 */

type RecordedCall = {
  table: string;
  select: string;
  eq: Array<[string, string]>;
  gte: Array<[string, string]>;
  order: Array<[string, boolean]>;
  limit: number | null;
  range: Array<[number, number]>;
};

const POSTGREST_MAX_ROWS = 1000;

function capped(
  result: { data: unknown; error: { message: string } | null } | undefined,
  from: number,
  asked: number
): { data: unknown; error: { message: string } | null } {
  if (!result) return { data: [], error: null };
  if (result.error || !Array.isArray(result.data)) return result;
  return { data: result.data.slice(from, from + Math.min(asked, POSTGREST_MAX_ROWS)), error: null };
}

function fakeClient(
  results: Record<string, { data: unknown; error: { message: string } | null }>,
  failPage?: { table: string; page: number }
): { client: DashboardChartSupabaseLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const pagesServed: Record<string, number> = {};

  const client: DashboardChartSupabaseLike = {
    from(table: string) {
      return {
        select(query: string) {
          const call: RecordedCall = {
            table,
            select: query,
            eq: [],
            gte: [],
            order: [],
            limit: null,
            range: [],
          };
          calls.push(call);
          const chain = {
            eq(column: string, value: string) {
              call.eq.push([column, value]);
              return chain;
            },
            gte(column: string, value: string) {
              call.gte.push([column, value]);
              return chain;
            },
            order(column: string, options: { ascending: boolean }) {
              call.order.push([column, options.ascending]);
              return chain;
            },
            limit(count: number) {
              call.limit = count;
              return chain;
            },
            // PostgREST's `max_rows`: no response holds more than 1,000 rows,
            // ranged or not, and the cap reports no error.
            range(from: number, toInclusive: number) {
              call.range.push([from, toInclusive]);
              pagesServed[table] = (pagesServed[table] ?? 0) + 1;
              if (failPage?.table === table && failPage.page === pagesServed[table]) {
                return Promise.resolve({ data: null, error: { message: "connection reset" } });
              }
              return Promise.resolve(capped(results[table], from, toInclusive - from + 1));
            },
            then<T>(resolve: (value: { data: unknown; error: { message: string } | null }) => T) {
              return Promise.resolve(capped(results[table], 0, Number.POSITIVE_INFINITY)).then(resolve);
            },
          };
          return chain as unknown as ReturnType<
            ReturnType<DashboardChartSupabaseLike["from"]>["select"]
          >;
        },
      };
    },
  };

  return { client, calls };
}

const SINCE = new Date("2026-05-21T00:00:00Z");

describe("the dashboard's chart reads", () => {
  it("scopes comments through the campaign with an inner join, not a plain embed", async () => {
    const { client, calls } = fakeClient({});
    await loadDashboardChartRows(client, "workspace-1", SINCE);

    const comments = calls.find((call) => call.table === "engagement_items");
    expect(comments).toBeDefined();
    // The `!inner` IS the tenancy. A plain embed nulls the parent instead of
    // dropping the row, and another workspace's comments land on this chart.
    expect(comments?.select).toContain("engagement_campaigns!inner(workspace_id)");
    expect(comments?.select).toContain("created_at");
    expect(comments?.eq).toContainEqual(["engagement_campaigns.workspace_id", "workspace-1"]);
    expect(comments?.gte).toContainEqual(["created_at", SINCE.toISOString()]);
  });

  it("scopes awards and invoices by workspace directly, and selects what it uses", async () => {
    const { client, calls } = fakeClient({});
    await loadDashboardChartRows(client, "workspace-1", SINCE);

    const awards = calls.find((call) => call.table === "funding_awards");
    expect(awards?.eq).toContainEqual(["workspace_id", "workspace-1"]);
    expect(awards?.select).toBe("id, title, awarded_amount");

    const invoices = calls.find((call) => call.table === "billing_invoice_records");
    expect(invoices?.eq).toContainEqual(["workspace_id", "workspace-1"]);
    // Every column the drawdown builder reads. A missing one is a runtime
    // undefined that silently becomes "not drawn".
    expect(invoices?.select).toBe("funding_award_id, amount, status");
  });

  it("hands a failed read back as failed, not as an empty list", async () => {
    const { client } = fakeClient({
      funding_awards: { data: null, error: { message: "connection reset" } },
    });
    const rows = await loadDashboardChartRows(client, "workspace-1", SINCE);

    expect(rows.awards.failed).toBe(true);
    expect(rows.awards.pending).toBe(false);
    expect(rows.awards.rows).toEqual([]);
    // The lanes that answered are unaffected — one failure must not empty the rest.
    expect(rows.comments.failed).toBe(false);
  });

  it("calls an unapplied migration pending rather than a failure", async () => {
    const { client } = fakeClient({
      engagement_items: {
        data: null,
        error: { message: 'relation "public.engagement_items" does not exist' },
      },
    });
    const rows = await loadDashboardChartRows(client, "workspace-1", SINCE);

    expect(rows.comments.pending).toBe(true);
    expect(rows.comments.failed).toBe(false);
  });

  it("reports a read that came back at its cap as truncated", async () => {
    const { client } = fakeClient({
      engagement_items: {
        data: Array.from({ length: COMMENT_READ_CAP }, () => ({ created_at: SINCE.toISOString() })),
        error: null,
      },
    });
    const rows = await loadDashboardChartRows(client, "workspace-1", SINCE);

    expect(rows.comments.truncated).toBe(true);
  });

  /*
    The comment cap (5,000) is above PostgREST's own 1,000-row cap. A single
    `.limit(5000)` read came back with 1,000 rows, below the cap, so the figure
    drew a short month and did not say so.
  */
  it("reads every comment past PostgREST's 1,000-row cap, in a total order", async () => {
    const { client, calls } = fakeClient({
      engagement_items: {
        data: Array.from({ length: 1234 }, (_, i) => ({
          created_at: new Date(SINCE.getTime() + i * 60_000).toISOString(),
        })),
        error: null,
      },
    });
    const rows = await loadDashboardChartRows(client, "workspace-1", SINCE);

    expect(rows.comments.rows).toHaveLength(1234);
    expect(rows.comments.truncated).toBe(false);
    expect(rows.comments.failed).toBe(false);
    const comments = calls.find((call) => call.table === "engagement_items");
    expect(comments?.order).toEqual([
      ["created_at", true],
      ["id", true],
    ]);
    expect(comments?.range.length).toBeGreaterThan(0);
  });

  it("hands a comment page that fails part way back as failed, never as a short total", async () => {
    const { client } = fakeClient(
      {
        engagement_items: {
          data: Array.from({ length: 1234 }, () => ({ created_at: SINCE.toISOString() })),
          error: null,
        },
      },
      { table: "engagement_items", page: 2 }
    );
    const rows = await loadDashboardChartRows(client, "workspace-1", SINCE);

    expect(rows.comments.failed).toBe(true);
    expect(rows.comments.rows).toEqual([]);
  });

  /**
   * THE RUNS READ MOVED HERE 2026-08-13, from an inline `runsResult` on the
   * dashboard page whose error nobody read. It is the read behind four KPI
   * tiles and two charts, so a failure that renders as `[]` becomes six zeros a
   * planner believes.
   */
  it("scopes runs by workspace and selects every column the KPIs read", async () => {
    const { client, calls } = fakeClient({});
    await loadDashboardChartRows(client, "workspace-1", SINCE);

    const runs = calls.find((call) => call.table === "runs");
    expect(runs?.eq).toContainEqual(["workspace_id", "workspace-1"]);
    expect(runs?.limit).toBe(RUN_READ_CAP);
    // `summary_text` is the decoy. `buildWorkspaceKpis` reads it to decide a run
    // COMPLETED, and the client is untyped — dropping it from the projection is
    // not a type error, it silently reports every run as unfinished and the
    // completion rate as 0%.
    expect(runs?.select).toBe(RUN_READ_COLUMNS);
    for (const column of ["created_at", "metrics", "summary_text", "report_generated_count"]) {
      expect(runs?.select).toContain(column);
    }
  });

  it("hands a failed runs read back as failed, so no tile can state a zero", async () => {
    const { client } = fakeClient({
      runs: { data: null, error: { message: "permission denied for table runs" } },
    });
    const rows = await loadDashboardChartRows(client, "workspace-1", SINCE);

    expect(rows.runs.failed).toBe(true);
    expect(rows.runs.rows).toEqual([]);
    expect(rows.comments.failed).toBe(false);
  });

  it("reports a runs read that came back at its cap as truncated", async () => {
    const { client } = fakeClient({
      runs: {
        data: Array.from({ length: RUN_READ_CAP }, () => ({ created_at: SINCE.toISOString() })),
        error: null,
      },
    });
    const rows = await loadDashboardChartRows(client, "workspace-1", SINCE);

    expect(rows.runs.truncated).toBe(true);
  });

  it("issues no query at all without a workspace", async () => {
    const { client, calls } = fakeClient({});
    const rows = await loadDashboardChartRows(client, "", SINCE);

    expect(calls).toEqual([]);
    // Nothing was asked, so nothing is disbelieved: empty and successful.
    expect(rows.comments).toEqual({ rows: [], failed: false, pending: false, truncated: false });
  });
});
