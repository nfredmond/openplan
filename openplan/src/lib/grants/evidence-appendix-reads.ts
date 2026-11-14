/**
 * Reads every program's evidence appendices share: the linked project's latest
 * benefit-cost record and its engagement campaigns, through the caller's
 * RLS-scoped client. A failed read becomes an "unreadable" state with its
 * reason; it never becomes an empty record.
 */

import { buildLatestBcaScreeningByProjectId, type ProjectBcaScreeningRowLike } from "@/lib/grants/bca-evidence";
import {
  buildProjectEngagementEvidenceByProjectId,
  type ProjectEngagementCampaignRowLike,
} from "@/lib/grants/engagement-evidence";
import type { CampaignCommentCountsRead, ProjectBcaRead, ProjectEngagementRead } from "@/lib/grants/evidence-appendices";
import { loadApprovedStaffReview } from "@/lib/engagement/staff-review-finding-server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

type QueryError = { message: string } | null;
type QueryResult = { data: unknown; error: QueryError; count?: number | null };
type QueryBuilder = PromiseLike<QueryResult> & {
  select: (columns: string, options?: { count: "exact" }) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  neq: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, values: unknown[]) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => PromiseLike<QueryResult>;
};
/** The slice of the request-scoped Supabase client the appendix loaders drive. */
export type EvidenceQueryClient = {
  from: (table: string) => QueryBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<QueryResult>;
};

const ENGAGEMENT_CAMPAIGN_LIMIT = 200;

const BCA_VERSION_PROJECTION = "id, project_id, created_at, document_json, engine_version";
const BCA_SCREENING_PROJECTION = "id, project_id, result_json, engine_version, created_at";
const ENGAGEMENT_PROJECTION =
  "id, project_id, title, status, engagement_type, updated_at, ai_synthesis_json, ai_synthesized_at, representativeness_json, representativeness_computed_at";
/** Counts come from the exact count header; one row each gives the first and last dates. */
export const ENGAGEMENT_COMMENT_COUNT_PROJECTION = "created_at";

/** The latest saved workbench version, or the latest saved screening when the workbench has none. */
export async function loadProjectBcaRead(client: EvidenceQueryClient, projectId: string): Promise<ProjectBcaRead> {
  const versions = await client
    .from("project_bca_versions")
    .select(BCA_VERSION_PROJECTION)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  // An install without the workbench table falls back to saved screenings.
  if (versions.error && !looksLikePendingSchema(versions.error.message)) {
    return { status: "unreadable", reason: "Saved benefit-cost analyses could not be read. That is a failed read, not an absence of analysis." };
  }
  const latest = !versions.error && Array.isArray(versions.data) ? (versions.data[0] as Record<string, unknown> | undefined) : undefined;
  if (latest && typeof latest.id === "string" && typeof latest.project_id === "string") {
    return {
      status: "workbench",
      row: {
        id: latest.id,
        project_id: latest.project_id,
        created_at: typeof latest.created_at === "string" ? latest.created_at : null,
        engine_version: typeof latest.engine_version === "string" ? latest.engine_version : null,
        document_json: latest.document_json,
      },
    };
  }

  const screenings = await client
    .from("project_bca_screenings")
    .select(BCA_SCREENING_PROJECTION)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (screenings.error || !Array.isArray(screenings.data)) {
    return { status: "unreadable", reason: "Saved benefit-cost screenings could not be read. That is a failed read, not an absence of analysis." };
  }
  if (screenings.data.length === 0) return { status: "absent" };
  const screening = buildLatestBcaScreeningByProjectId(screenings.data as ProjectBcaScreeningRowLike[]).get(projectId);
  return screening
    ? { status: "screening", screening }
    : { status: "unreadable", reason: "The saved benefit-cost screening does not carry its computed results." };
}

type CountRead = { count: number; createdAt: string | null } | null;

async function countComments(client: EvidenceQueryClient, campaignId: string, input: { approvedOnly: boolean; ascending: boolean }): Promise<CountRead> {
  let query = client.from("engagement_items").select(ENGAGEMENT_COMMENT_COUNT_PROJECTION, { count: "exact" }).eq("campaign_id", campaignId);
  if (input.approvedOnly) query = query.eq("status", "approved");
  const result = await query.order("created_at", { ascending: input.ascending }).limit(1);
  if (result.error || !Array.isArray(result.data) || typeof result.count !== "number") return null;
  const first = result.data[0] as { created_at?: unknown } | undefined;
  return { count: result.count, createdAt: typeof first?.created_at === "string" ? first.created_at : null };
}

/**
 * Comments received and approved for one campaign, by the database's exact
 * count rather than by reading rows, so a large campaign is not capped.
 */
async function loadCampaignCommentCounts(client: EvidenceQueryClient, campaignId: string): Promise<CampaignCommentCountsRead> {
  const unreadable = { status: "unreadable", reason: "Comment counts could not be read. That is a failed read, not a count of zero." } as const;
  try {
    const [first, last, approved] = await Promise.all([
      countComments(client, campaignId, { approvedOnly: false, ascending: true }),
      countComments(client, campaignId, { approvedOnly: false, ascending: false }),
      countComments(client, campaignId, { approvedOnly: true, ascending: true }),
    ]);
    if (!first || !last || !approved || first.count !== last.count) return unreadable;
    return { status: "ready", received: first.count, approved: approved.count, firstReceivedAt: first.createdAt, lastReceivedAt: last.createdAt };
  } catch {
    return unreadable;
  }
}

/**
 * The project's non-archived campaigns, most recently updated first; a count
 * above the limit is disclosed. For the lead campaign it also reads the
 * comment counts and the approved staff review, each with its own failure
 * state, so a keyless workspace can still cite a community-input finding.
 */
export async function loadProjectEngagementRead(client: EvidenceQueryClient, projectId: string, workspaceId: string | null): Promise<ProjectEngagementRead> {
  const result = await client
    .from("engagement_campaigns")
    .select(ENGAGEMENT_PROJECTION, { count: "exact" })
    .eq("project_id", projectId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(ENGAGEMENT_CAMPAIGN_LIMIT);
  if (result.error || !Array.isArray(result.data)) {
    return { status: "unreadable", reason: "Engagement campaigns could not be read. That is a failed read, not an absence of engagement." };
  }
  const evidence = buildProjectEngagementEvidenceByProjectId(result.data as ProjectEngagementCampaignRowLike[]).get(projectId);
  if (!evidence) return { status: "absent" };
  const lead = evidence.leadCampaign;
  const [comments, staffReview] = await Promise.all([
    loadCampaignCommentCounts(client, lead.id),
    workspaceId
      ? loadApprovedStaffReview(client as unknown as Parameters<typeof loadApprovedStaffReview>[0], { campaignId: lead.id, workspaceId })
          .catch(() => ({ status: "unreadable", reason: "Saved staff reviews could not be read. That is a failed read, not an absence of review." } as const))
      : Promise.resolve({ status: "unreadable", reason: "The workspace was not known, so saved staff reviews were not read." } as const),
  ]);
  return { status: "ready", evidence, truncated: typeof result.count !== "number" || result.count > result.data.length, comments, staffReview };
}
