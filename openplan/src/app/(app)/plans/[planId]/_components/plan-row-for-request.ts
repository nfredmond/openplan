import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The plan row for this request, read once with the signed-in user's own
 * client and shared by `[planId]/layout.tsx` and `page.tsx` through React's
 * per-request cache. Row security decides what comes back: a plan in another
 * workspace reads exactly like one that does not exist. The layout needs the
 * answer before `loading.tsx` starts the stream, so a missing plan can answer
 * 404; sharing the read means that check adds no query to the page. A link
 * prefetch runs it too; see `requireRecordRow` for that cost.
 */
export const loadPlanRowForRequest = cache(async (planId: string) => {
  const supabase = await createClient();
  return supabase
    .from("plans")
    .select(
      "id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at"
    )
    .eq("id", planId)
    .maybeSingle();
});
