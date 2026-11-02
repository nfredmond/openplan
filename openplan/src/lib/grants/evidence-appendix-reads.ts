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
import type { ProjectBcaRead, ProjectEngagementRead } from "@/lib/grants/evidence-appendices";
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
export type EvidenceQueryClient = { from: (table: string) => QueryBuilder };

const ENGAGEMENT_CAMPAIGN_LIMIT = 200;

const BCA_VERSION_PROJECTION = "id, project_id, created_at, document_json, engine_version";
const BCA_SCREENING_PROJECTION = "id, project_id, result_json, engine_version, created_at";
const ENGAGEMENT_PROJECTION =
  "id, project_id, title, status, updated_at, ai_synthesis_json, ai_synthesized_at, representativeness_json, representativeness_computed_at";

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

/** The project's non-archived campaigns, most recently updated first; a count above the limit is disclosed. */
export async function loadProjectEngagementRead(client: EvidenceQueryClient, projectId: string): Promise<ProjectEngagementRead> {
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
  return { status: "ready", evidence, truncated: typeof result.count !== "number" || result.count > result.data.length };
}
