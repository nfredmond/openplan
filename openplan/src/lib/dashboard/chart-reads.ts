/**
 * The four reads the dashboard's figures need, and nothing else.
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

import { readEveryPage } from "@/lib/supabase/paged-read";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

import type { ChartReadOutcome, DashboardRunRow } from "./insights";
import type {
  AwardInvoiceRow,
  EngagementCommentRow,
  FundingAwardRow,
} from "./chart-series";

type ReadResult = { data: unknown; error: { message?: string | null } | null };

type ChartFilterChain = PromiseLike<ReadResult> & {
  eq: (column: string, value: string) => ChartFilterChain;
  gte: (column: string, value: string) => ChartFilterChain;
  order: (column: string, options: { ascending: boolean }) => ChartFilterChain;
  limit: (count: number) => ChartFilterChain;
  range: (from: number, toInclusive: number) => PromiseLike<ReadResult>;
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
/**
 * The comment cap is above PostgREST's own `max_rows` (1,000 here), which
 * truncates a single read with no error. A `.limit(5000)` therefore came back
 * with 1,000 rows, which never reached the cap, so a busy month drew short and
 * was not marked truncated. The comment read pages instead, up to the cap.
 */
const COMMENT_READ_PAGE_SIZE = 500;
export const AWARD_READ_CAP = 200;
export const INVOICE_READ_CAP = 2000;
/**
 * The runs cap was already 500 when this read lived inline on the dashboard
 * page; what it did NOT have was anywhere to say so. A workspace past 500 runs
 * had its "analysis runs per month" line and every runs-derived KPI silently
 * computed from the OLDEST 500 rows (the read is ordered ascending), which draws
 * a busy agency as one that stopped working months ago.
 */
export const RUN_READ_CAP = 500;

/**
 * The runs projection, as the KPI builder and the two runs figures need it.
 * Named because two tests assert on it: an untyped Supabase client means a
 * dropped column here surfaces at runtime as a missing number, not as a type
 * error — `summary_text` in particular is what `buildWorkspaceKpis` reads to
 * decide a run COMPLETED, so losing it would quietly report every run as
 * unfinished.
 */
export const RUN_READ_COLUMNS = "created_at, metrics, summary_text, report_generated_count";

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
  runs: ChartReadOutcome<DashboardRunRow>;
};

/** No workspace id means no read happened at all — empty-and-successful is the honest description. */
function noReadYet<Row>(): ChartReadOutcome<Row> {
  return { rows: [], failed: false, pending: false, truncated: false };
}

export function noDashboardChartRows(): DashboardChartRows {
  return {
    comments: noReadYet(),
    awards: noReadYet(),
    invoices: noReadYet(),
    runs: noReadYet(),
  };
}

/**
 * The window's comments, paged up to `COMMENT_READ_CAP`.
 *
 * The `id` tiebreak makes the order total, so comments submitted in the same
 * second cannot repeat or drop between pages. Stopping at the page ceiling
 * means more comments remain: that is `truncated`, which blocks the figure.
 */
async function readCommentsUpToCap(
  supabase: DashboardChartSupabaseLike,
  workspaceId: string,
  since: Date
): Promise<ChartReadOutcome<EngagementCommentRow>> {
  const read = await readEveryPage<EngagementCommentRow, NonNullable<ReadResult["error"]>>(
    (from, toInclusive) =>
      supabase
        .from("engagement_items")
        .select("created_at, engagement_campaigns!inner(workspace_id)")
        .eq("engagement_campaigns.workspace_id", workspaceId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, toInclusive) as PromiseLike<{
        data: EngagementCommentRow[] | null;
        error: NonNullable<ReadResult["error"]> | null;
      }>,
    { pageSize: COMMENT_READ_PAGE_SIZE, maxPages: COMMENT_READ_CAP / COMMENT_READ_PAGE_SIZE }
  );
  if (read.error) return outcome<EngagementCommentRow>({ data: null, error: read.error }, COMMENT_READ_CAP);
  return { rows: read.rows, failed: false, pending: false, truncated: !read.complete };
}

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
    return noDashboardChartRows();
  }

  const [comments, awardsResult, invoicesResult, runsResult] = await Promise.all([
    readCommentsUpToCap(supabase, workspaceId, since),
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
    // The workspace's analysis runs. This read used to sit inline on the
    // dashboard page as `runsResult`, where only `.data` was ever read — so a
    // failed query produced `[]`, and `[]` produced four KPI tiles reading zero
    // and two charts drawn flat at the baseline. It is here now for one reason:
    // this is the module that hands back an OUTCOME, and the outcome is what
    // makes "the query failed" impossible to render as "you have done nothing".
    supabase
      .from("runs")
      .select(RUN_READ_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .limit(RUN_READ_CAP),
  ]);

  return {
    comments,
    awards: outcome<FundingAwardRow>(awardsResult, AWARD_READ_CAP),
    invoices: outcome<AwardInvoiceRow>(invoicesResult, INVOICE_READ_CAP),
    runs: outcome<DashboardRunRow>(runsResult, RUN_READ_CAP),
  };
}
