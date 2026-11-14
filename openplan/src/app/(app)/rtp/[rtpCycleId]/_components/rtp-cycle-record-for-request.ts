import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

/**
 * The signed-in user, their current workspace and the RTP cycle row, read once
 * for this request with the user's own client and shared by
 * `[rtpCycleId]/layout.tsx` and `page.tsx` through React's per-request cache.
 *
 * The page asks in this order: no user signs in, no workspace shows the
 * "needs a workspace" notice, and only then is the row read, scoped to the
 * current workspace. `cycleResult` is `null` until the first two pass, so the
 * layout leaves those cases to the page. A cycle in another workspace reads
 * exactly like one that does not exist.
 */
export const loadRtpCycleRecordForRequest = cache(async (rtpCycleId: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, membership: null, workspace: null, cycleResult: null };

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership || !workspace) return { user, membership, workspace, cycleResult: null };

  const cycleResult = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, financial_basis_year, annual_inflation_rate, anchor_latitude, anchor_longitude, public_share_token, public_share_enabled, created_at, updated_at"
    )
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();
  return { user, membership, workspace, cycleResult };
});

/** The layout's view of the shared read: the row read, or `null` when the page decides first. */
export async function readRtpCycleRowForRequest(rtpCycleId: string) {
  return (await loadRtpCycleRecordForRequest(rtpCycleId)).cycleResult;
}
