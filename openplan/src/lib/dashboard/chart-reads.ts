/**
 * The three reads the dashboard's newer figures need, and nothing else.
 *
 * WHY A SEPARATE MODULE FROM `chart-series.ts`. That file must stay pure so its
 * refusals can be tested by calling a function. This one is the only place the
 * charts touch a database, and its whole job is to hand the builders an OUTCOME
 * — rows plus whether the read failed, whether the deployment is behind a
 * migration, and whether the cap was hit — instead of a bare array. An array
 * cannot tell a builder that it is empty because nothing happened rather than
 * because the query fell over, and that distinction is the entire honesty
 * argument of these charts.
 *
 * TENANCY. `funding_awards` and `billing_invoice_records` carry a
 * `workspace_id`. `engagement_items` does NOT: it is scoped through its
 * campaign, so the read filters `engagement_campaigns.workspace_id` through an
 * `!inner` embed — the same pattern, and the same load-bearing `!inner`, as
 * `src/lib/my-work/sources.ts`. A plain embed keeps the child row and nulls the
 * parent when the filter misses, which would count another workspace's comments
 * on this workspace's chart. Every read here uses the CALLER's RLS client;
 * there is no service-role client in this module.
 */

import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

import type {
  AwardInvoiceRow,
  ChartReadOutcome,
  EngagementCommentRow,
  FundingAwardRow,
} from "./chart-series";

type ReadResult = { data: unknown; error: { message?: string | null } | null };

type ChartFilterChain = PromiseLike<ReadResult> & {
  eq: (column: string, value: string) => ChartFilterChain;
  gte: (column: string, value: string) => ChartFilterChain;
  order: (column: string, options: { ascending: boolean }) => ChartFilterChain;
  limit: (count: number) => ChartFilterChain;
};

export type DashboardChartSupabaseLike = {
  from: (table: string) => { select: (query: string) => ChartFilterChain };
};

/**
 * Per-read caps. Deliberately generous and deliberately FINITE: a workspace can
 * hold tens of thousands of comments, and an uncapped read on a dashboard is
 * how a page falls over on an agency's busiest campaign. Hitting the cap is not
 * hidden — it becomes `truncated`, and a truncated read blocks the figure
 * rather than drawing a short total.
 */
export const COMMENT_READ_CAP = 5000;
export const AWARD_READ_CAP = 200;
export const INVOICE_READ_CAP = 2000;

function outcome<Row>(result: ReadResult, cap: number): ChartReadOutcome<Row> {
  const pending = looksLikePendingSchema(result.error?.message ?? null);
  const failed = !pending && result.error !== null;
  const rows = pending || failed ? [] : ((result.data ?? []) as Row[]);
  return { rows, failed, pending, truncated: rows.length >= cap };
}

export type DashboardChartRows = {
  comments: ChartReadOutcome<EngagementCommentRow>;
  awards: ChartReadOutcome<FundingAwardRow>;
  invoices: ChartReadOutcome<AwardInvoiceRow>;
};

/**
 * `since` bounds the comment read to the window the figure actually draws, so
 * the cap is spent on rows the chart can use. The caller passes it (and the
 * clock behind it) rather than this module reading `Date.now()`, so the read
 * and the series that consumes it cannot disagree about where the window
 * starts.
 */
export async function loadDashboardChartRows(
  supabase: DashboardChartSupabaseLike,
  workspaceId: string,
  since: Date
): Promise<DashboardChartRows> {
  if (!workspaceId) {
    const empty = <Row>(): ChartReadOutcome<Row> => ({
      rows: [],
      failed: false,
      pending: false,
      truncated: false,
    });
    return { comments: empty(), awards: empty(), invoices: empty() };
  }

  const [commentsResult, awardsResult, invoicesResult] = await Promise.all([
    supabase
      .from("engagement_items")
      .select("created_at, engagement_campaigns!inner(workspace_id)")
      .eq("engagement_campaigns.workspace_id", workspaceId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(COMMENT_READ_CAP),
    supabase
      .from("funding_awards")
      .select("id, title, awarded_amount")
      .eq("workspace_id", workspaceId)
      .order("awarded_amount", { ascending: false })
      .limit(AWARD_READ_CAP),
    supabase
      .from("billing_invoice_records")
      .select("funding_award_id, amount, status")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(INVOICE_READ_CAP),
  ]);

  return {
    comments: outcome<EngagementCommentRow>(commentsResult, COMMENT_READ_CAP),
    awards: outcome<FundingAwardRow>(awardsResult, AWARD_READ_CAP),
    invoices: outcome<AwardInvoiceRow>(invoicesResult, INVOICE_READ_CAP),
  };
}
