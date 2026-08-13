import { describe, expect, it } from "vitest";

import {
  COMMENT_READ_CAP,
  loadDashboardChartRows,
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
};

function fakeClient(
  results: Record<string, { data: unknown; error: { message: string } | null }>
): { client: DashboardChartSupabaseLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

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
            then<T>(resolve: (value: { data: unknown; error: { message: string } | null }) => T) {
              return Promise.resolve(
                results[table] ?? { data: [], error: null }
              ).then(resolve);
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

  it("issues no query at all without a workspace", async () => {
    const { client, calls } = fakeClient({});
    const rows = await loadDashboardChartRows(client, "", SINCE);

    expect(calls).toEqual([]);
    // Nothing was asked, so nothing is disbelieved: empty and successful.
    expect(rows.comments).toEqual({ rows: [], failed: false, pending: false, truncated: false });
  });
});
