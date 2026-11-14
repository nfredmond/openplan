import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The program row for this request, read once with the signed-in user's own
 * client and shared by `[programId]/layout.tsx` and `page.tsx` through React's
 * per-request cache. Row security decides what comes back: a program in
 * another workspace reads exactly like one that does not exist. The layout
 * needs the answer before `loading.tsx` starts the stream, so a missing program
 * can answer 404; sharing the read means that check adds no query to the
 * overview page.
 */
export const loadProgramRowForRequest = cache(async (programId: string) => {
  const supabase = await createClient();
  return supabase
    .from("programs")
    .select(
      "id, workspace_id, project_id, title, program_type, status, cycle_name, funding_classification, sponsor_agency, owner_label, cadence_label, fiscal_year_start, fiscal_year_end, nomination_due_at, adoption_target_at, summary, created_at, updated_at"
    )
    .eq("id", programId)
    .maybeSingle();
});
