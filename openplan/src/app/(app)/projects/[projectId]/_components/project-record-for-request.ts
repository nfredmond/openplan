import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

/**
 * The signed-in user, their current workspace membership and the project row,
 * read once for this request with the user's own client and shared by
 * `[projectId]/layout.tsx` and `page.tsx` through React's per-request cache.
 *
 * The page asks in this order: no user signs in, no workspace shows the
 * "needs a workspace" notice, and only then is the row read. `projectResult`
 * is `null` until the first two pass, so the layout leaves those cases to the
 * page. Row security decides the row: a project in another workspace reads
 * exactly like one that does not exist (`.single()` reports both as PGRST116).
 */
export const loadProjectRecordForRequest = cache(async (projectId: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, membership: null, projectResult: null };

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership) return { user, membership: null, projectResult: null };

  const projectResult = await supabase
    .from("projects")
    .select(
      "id, workspace_id, name, summary, status, plan_type, delivery_phase, estimated_cost_amount::text, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_source_document_id, estimated_cost_recorded_at, created_at, updated_at, rtp_posture, rtp_posture_updated_at, jurisdiction_context, latitude, longitude, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_geometry_geojson, place_set_at"
    )
    .eq("id", projectId)
    .single();
  return { user, membership, projectResult };
});

/** The layout's view of the shared read: the row read, or `null` when the page decides first. */
export async function readProjectRowForRequest(projectId: string) {
  return (await loadProjectRecordForRequest(projectId)).projectResult;
}
