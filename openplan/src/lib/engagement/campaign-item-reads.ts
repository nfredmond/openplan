import type { SupabaseClient } from "@supabase/supabase-js";

import { readEveryPageAsResult } from "@/lib/supabase/paged-read";

/**
 * EVERY COMMENT ON A SET OF CAMPAIGNS, READ PAST POSTGREST'S ROW CAP.
 *
 * PostgREST stops a response at `max_rows` (1,000 on this deployment) and
 * reports no error. The plan, program, report and RTP pages each read a
 * campaign's comments in one request and counted what came back, so a campaign
 * above 1,000 comments showed 1,000 with nothing looking wrong. Those reads now
 * come through here.
 *
 * The order is `created_at`, then `id`. The `id` tiebreak makes it total:
 * comments submitted in the same second have no defined order between two page
 * requests otherwise, so one could be read twice and another never.
 *
 * The result has the `{ data, error }` shape of the single read it replaces, so
 * each caller's read-failure check is unchanged. A read that fails part way or
 * stops at the page ceiling returns `data: null` and an error, never a prefix.
 */

export type CampaignItemReadError = { message: string; code?: string | null };

type CampaignItemPage<Row> = { data: Row[] | null; error: CampaignItemReadError | null };

/** The slice of a Supabase client this read uses. */
export type CampaignItemReadClient = Pick<SupabaseClient, "from">;

/** The two fields the plan and program status counts use. */
export const CAMPAIGN_ITEM_STATUS_COLUMNS = "campaign_id, status";

/** The fields `summarizeEngagementItems` reads on the report and RTP pages. */
export const CAMPAIGN_ITEM_SUMMARY_COLUMNS =
  "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at";

/**
 * Read every engagement comment on `campaignIds` with the given projection.
 *
 * An empty id list is answered without a request: no campaign means no
 * comments, which is a real empty answer rather than a failed read.
 */
export async function readEveryCampaignItem<Row>(
  client: CampaignItemReadClient,
  campaignIds: readonly string[],
  columns: string
): Promise<{ data: Row[] | null; error: CampaignItemReadError | null }> {
  if (campaignIds.length === 0) return { data: [], error: null };
  const ids = [...campaignIds];
  return readEveryPageAsResult<Row, CampaignItemReadError>(
    (from, toInclusive) =>
      client
        .from("engagement_items")
        .select(columns)
        .in("campaign_id", ids)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, toInclusive) as PromiseLike<CampaignItemPage<Row>>,
    "the comment read could not be completed, so any count from it would understate the campaigns"
  );
}
