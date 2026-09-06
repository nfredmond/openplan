import {
  isInternalOrPrivateEngagementNote,
  isPublicEngagementComment,
  type EngagementCommentMatrixItemLike,
} from "@/lib/engagement/comment-matrix";
import { getPublicPortalState } from "@/lib/engagement/public-portal";
import { loadProjectCampaignsForEvidence } from "@/lib/engagement/campaign-projects";
import { readEveryPage } from "@/lib/supabase/paged-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectGeoPackageEngagementGeometry } from "@/lib/projects/project-geopackage";

function engagementItemForPrivacy(row: Record<string, unknown>): EngagementCommentMatrixItemLike {
  const metadata = row.metadata_json;
  return {
    id: String(row.id),
    campaign_id: typeof row.campaign_id === "string" ? row.campaign_id : null,
    category_id: typeof row.category_id === "string" ? row.category_id : null,
    title: typeof row.title === "string" ? row.title : null,
    body: typeof row.body === "string" ? row.body : null,
    submitted_by: typeof row.submitted_by === "string" ? row.submitted_by : null,
    status: typeof row.status === "string" ? row.status : null,
    source_type: typeof row.source_type === "string" ? row.source_type : null,
    metadata_json: metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : null,
    moderation_notes: typeof row.moderation_notes === "string" ? row.moderation_notes : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** Only geometry already reachable as public input may leave the workspace. */
export function isPublishableProjectEngagementGeometry(row: Record<string, unknown>): boolean {
  const item = engagementItemForPrivacy(row);
  return item.status === "approved"
    && isPublicEngagementComment(item)
    && !isInternalOrPrivateEngagementNote(item);
}

export function isPublicProjectEngagementCampaign(row: Record<string, unknown>): boolean {
  return getPublicPortalState({
    status: typeof row.status === "string" ? row.status : null,
    share_token: typeof row.share_token === "string" ? row.share_token : null,
    allow_public_submissions: typeof row.allow_public_submissions === "boolean" ? row.allow_public_submissions : null,
    submissions_closed_at: typeof row.submissions_closed_at === "string" ? row.submissions_closed_at : null,
  }).isPubliclyReachable;
}

/** Share complete, publication-filtered geometry between direct and retained project exports. */
export async function loadPublishableProjectEngagementGeometry(
  supabaseValue: unknown,
  project: { id: string; workspace_id: string },
): Promise<{ data: ProjectGeoPackageEngagementGeometry[] | null; error: { message: string } | null }> {
  const client = supabaseValue as SupabaseClient;
  const campaigns = await loadProjectCampaignsForEvidence(client, project);
  if (campaigns.error) return { data: null, error: campaigns.error };
  const campaignIds = (campaigns.data ?? []).filter(isPublicProjectEngagementCampaign).map((row) => String(row.id));
  const items = new Map<string, ProjectGeoPackageEngagementGeometry>();
  for (let start = 0; start < campaignIds.length; start += 200) {
    const batch = campaignIds.slice(start, start + 200);
    const read = await readEveryPage<Record<string, unknown>>((from, to) => client
      .from("engagement_items")
      .select("id, campaign_id, category_id, title, body, submitted_by, status, source_type, metadata_json, moderation_notes, geometry, longitude, latitude, created_at, updated_at")
      .in("campaign_id", batch).eq("status", "approved")
      .order("id", { ascending: true }).range(from, to));
    if (!read.complete) return { data: null, error: { message: "Publishable engagement geometry could not be fully read." } };
    for (const row of read.rows.filter(isPublishableProjectEngagementGeometry)) {
      if (typeof row.created_at !== "string") return { data: null, error: { message: "An engagement record is missing its recorded date." } };
      items.set(String(row.id), {
        id: String(row.id), geometry: row.geometry,
        longitude: typeof row.longitude === "number" ? row.longitude : null,
        latitude: typeof row.latitude === "number" ? row.latitude : null,
        sourceType: typeof row.source_type === "string" ? row.source_type : "unknown",
        createdAt: row.created_at,
      });
    }
  }
  return { data: [...items.values()], error: null };
}
