import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadReportDetailRow } from "./_helpers";

/**
 * The report row for this request, read once with the signed-in user's own
 * client and shared by `[reportId]/layout.tsx` and `page.tsx` through React's
 * per-request cache. Row security decides what comes back: a report in
 * another workspace reads exactly like one that does not exist, `data: null`
 * with no error. No service-role client is involved.
 *
 * The layout needs the row before `loading.tsx` starts the stream so a missing
 * report can answer 404 (see the layout). Sharing the read means that check
 * adds no query: the page reuses the same answer.
 */
export const loadReportDetailRowForRequest = cache(async (reportId: string) => {
  const supabase = await createClient();
  return loadReportDetailRow(supabase, reportId);
});
