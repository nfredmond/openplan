import {
  isInternalOrPrivateEngagementNote,
  isPublicEngagementComment,
  type EngagementCommentMatrixItemLike,
} from "@/lib/engagement/comment-matrix";
import { getPublicPortalState } from "@/lib/engagement/public-portal";

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
