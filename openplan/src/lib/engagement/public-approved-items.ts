import type { SupabaseClient } from "@supabase/supabase-js";
import { readEveryPage } from "@/lib/supabase/paged-read";

export const PUBLIC_ITEM_COLUMNS = "id, configuration_version_id, category_id, title, body, submitted_by, latitude, longitude, geometry, photo_path, votes_count, parent_item_id, created_at";
type Cursor = { id: string; created_at: string };

// Offset positions shift when moderation adds or removes rows. Advance past the
// last received ordering key instead. New approvals before that key appear on
// the next refresh; exports use their separate immutable snapshot.
export async function readPublicApprovedItems<Row extends Cursor>(client: Pick<SupabaseClient, "from">, campaignId: string) {
  let cursor: Cursor | undefined;
  const result = await readEveryPage<Row>(async (from, to) => {
    let query = client.from("engagement_items").select(PUBLIC_ITEM_COLUMNS)
      .eq("campaign_id", campaignId).eq("status", "approved")
      .order("created_at", { ascending: false }).order("id", { ascending: true });
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
    const page = await query.range(0, to - from);
    if (page.error) return { data: null, error: page.error };
    const rows = (page.data ?? []) as Row[];
    const last = rows.at(-1);
    if (last && (!last.id || !last.created_at || (last.id === cursor?.id && last.created_at === cursor.created_at))) {
      return { data: null, error: { message: "The contribution list did not advance. Refresh to retry." } };
    }
    if (last) cursor = { id: last.id, created_at: last.created_at };
    return { data: rows, error: null };
  });
  return { data: result.complete ? result.rows : [], error: result.complete ? null : result.error ?? { message: "The complete contribution list could not be loaded." } };
}
