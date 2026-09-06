import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { readEveryPage } from "@/lib/supabase/paged-read";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One campaign, several projects (migration 20260810000003).
 *
 * `engagement_campaigns.project_id` remains the LEAD project;
 * `engagement_campaign_projects` carries the FULL set the campaign covers,
 * INCLUDING the lead — a database trigger keeps the lead's row present, and
 * the campaign PATCH route maintains the rest through the helpers here. This
 * module is the one place the set arithmetic lives, so the route and its tests
 * cannot disagree about what "the full set" means.
 *
 * RTP comment-response linkage retains its own lead-project semantics.
 * Project evidence exports use the full coverage set through the paged reader
 * below; they refuse incomplete coverage instead of falling back silently.
 */

/** The most projects one campaign may cover in a single request. */
export const MAX_CAMPAIGN_PROJECT_LINKS = 100;

/**
 * The full set of project ids a campaign should cover after a write.
 *
 * The lead is ALWAYS a member when one exists — a caller cannot unlink the
 * lead through the set, only by changing the lead itself. Order and duplicates
 * in the request are the caller's noise, not state.
 */
export function desiredCampaignProjectIds(input: {
  leadProjectId: string | null;
  requestedProjectIds: string[];
}): string[] {
  const desired = new Set(input.requestedProjectIds);
  if (input.leadProjectId) desired.add(input.leadProjectId);
  return [...desired].sort();
}

/**
 * What has to change to move the stored set to the desired one.
 *
 * Pure diff, no writes: the route deletes `toRemove` and inserts `toAdd`, and
 * rows already right are never touched — a sync that rewrote every row would
 * churn created_at/created_by provenance on links nobody changed.
 */
export function diffCampaignProjectLinks(current: string[], desired: string[]): {
  toAdd: string[];
  toRemove: string[];
} {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  return {
    toAdd: [...desiredSet].filter((id) => !currentSet.has(id)).sort(),
    toRemove: [...currentSet].filter((id) => !desiredSet.has(id)).sort(),
  };
}

/**
 * The PostgREST `.or()` filter for "campaigns that cover this project":
 * campaigns leading with it, plus campaigns covering it through the join
 * table. The lead branch stays even though the trigger implies the join row —
 * campaigns written before the migration's backfill ran on a given deployment
 * have no join rows yet, and a filter that quietly dropped them would shrink a
 * project's engagement lane on upgrade night.
 */
export function campaignCoverageOrFilter(projectId: string, coveringCampaignIds: string[]): string {
  if (coveringCampaignIds.length === 0) return `project_id.eq.${projectId}`;
  return `project_id.eq.${projectId},id.in.(${coveringCampaignIds.join(",")})`;
}

/**
 * Structural client shape, exported so callers can cast the real (deeply
 * generic) supabase-js client down to it — assigning the real client directly
 * trips TS2589 (excessive type instantiation), the recurring
 * client-into-SupabaseLike hazard this repo has hit before.
 */
export type CampaignProjectsSupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>;
    };
  };
};

export type CampaignCoverageRead = {
  /** Campaign ids covering the project through the join table. */
  campaignIds: string[];
  /**
   * True when the read failed for a real reason (permissions, connection).
   * The caller must disclose that joined campaigns may be missing — an
   * undisclosed failure here silently shrinks a project's engagement lane.
   */
  failed: boolean;
  /**
   * True when the join table does not exist yet (deploy-before-migrate
   * window). NOT a failure: lead-only coverage is exactly the behaviour this
   * deployment had yesterday, so callers fall back to it silently.
   */
  pendingSchema: boolean;
  /** The database's own message when `failed`, for a page's ReadFailureLog. */
  errorMessage: string | null;
};

type CampaignsQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      or: (filter: string) => {
        order: (
          column: string,
          options: { ascending: boolean }
        ) => {
          limit: (
            count: number
          ) => PromiseLike<{ data: unknown[] | null; error: { message?: string | null } | null }>;
        };
      };
    };
  };
};

/** What the project page's engagement lane renders — one projection, one place. */
export const PROJECT_ENGAGEMENT_LANE_SELECT = "id, title, status, updated_at, created_at";

/**
 * The project page's engagement lane read: campaigns covering the project as
 * LEAD or through the join table, newest first.
 *
 * Owns the coverage read AND its disclosure: a REAL coverage failure goes to
 * the page's ReadFailureLog (structural `reads` param), because a lane that
 * silently shrank to lead-linked campaigns would present a partial list as
 * the project's whole engagement record. The client arrives as `unknown` and
 * is cast internally — assigning the deeply generic supabase-js client to a
 * structural type at every call site trips TS2589.
 */
export async function loadEngagementCampaignsCoveringProject(
  client: unknown,
  projectId: string,
  reads: {
    check: (
      label: string,
      result: { data: unknown; error: { message?: string | null } | null }
    ) => boolean;
  },
  options: { limit?: number } = {}
): Promise<{ data: unknown[] | null; error: { message?: string | null } | null }> {
  const coverage = await loadCampaignIdsCoveringProject(
    client as CampaignProjectsSupabaseLike,
    projectId
  );
  if (coverage.failed) {
    reads.check("campaigns covering this project", {
      data: null,
      error: { message: coverage.errorMessage ?? "no message reported" },
    });
  }
  return (client as CampaignsQueryClient)
    .from("engagement_campaigns")
    .select(PROJECT_ENGAGEMENT_LANE_SELECT)
    .or(campaignCoverageOrFilter(projectId, coverage.campaignIds))
    .order("updated_at", { ascending: false })
    .limit(options.limit ?? 6);
}

/** Which campaigns cover this project, read from the join table. */
export async function loadCampaignIdsCoveringProject(
  supabase: CampaignProjectsSupabaseLike,
  projectId: string
): Promise<CampaignCoverageRead> {
  const { data, error } = await supabase
    .from("engagement_campaign_projects")
    .select("campaign_id")
    .eq("project_id", projectId);

  if (error) {
    const pendingSchema = looksLikePendingSchema(error.message);
    return {
      campaignIds: [],
      failed: !pendingSchema,
      pendingSchema,
      errorMessage: error.message ?? null,
    };
  }

  return {
    campaignIds: ((data ?? []) as Array<{ campaign_id: string }>).map((row) => row.campaign_id),
    failed: false,
    pendingSchema: false,
    errorMessage: null,
  };
}

export const PROJECT_CAMPAIGN_EVIDENCE_SELECT =
  "id, status, share_token, allow_public_submissions, submissions_closed_at, updated_at";

/** Read report awareness only after the campaign's project coverage is known. */
export async function loadCoveredProjectReports(
  supabaseValue: unknown,
  workspaceId: string,
  coverage: Awaited<ReturnType<typeof loadCampaignReportProjects>>,
) {
  if (coverage.error || coverage.data.length === 0) return { data: [], error: coverage.error };
  return (supabaseValue as SupabaseClient).from("reports")
    .select("id, project_id, title, report_type, status, generated_at, updated_at, latest_artifact_kind")
    .in("project_id", coverage.data.map((project) => project.id))
    .eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
}

/** Read the full campaign set for a project export, retaining caller RLS. */
export async function loadProjectCampaignsForEvidence(
  supabaseValue: unknown,
  project: { id: string; workspace_id: string },
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const client = supabaseValue as SupabaseClient;
  const [lead, linked] = await Promise.all([
    readEveryPage<Record<string, unknown>>((from, to) => client
      .from("engagement_campaigns")
      .select(PROJECT_CAMPAIGN_EVIDENCE_SELECT)
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .order("id", { ascending: true }).range(from, to)),
    readEveryPage<Record<string, unknown>>((from, to) => client
      .from("engagement_campaign_projects")
      .select(`campaign_id, engagement_campaigns!inner(${PROJECT_CAMPAIGN_EVIDENCE_SELECT})`)
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .eq("engagement_campaigns.workspace_id", project.workspace_id)
      .order("campaign_id", { ascending: true }).range(from, to)),
  ]);
  if (!lead.complete || !linked.complete) {
    return { data: null, error: { message: "The complete project campaign coverage could not be read." } };
  }
  const campaigns = new Map<string, Record<string, unknown>>();
  for (const row of [...lead.rows, ...linked.rows.map((link) => link.engagement_campaigns)]) {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof (row as Record<string, unknown>).id !== "string") {
      return { data: null, error: { message: "A covered campaign record could not be resolved." } };
    }
    const campaign = row as Record<string, unknown>;
    const prior = campaigns.get(campaign.id as string);
    // A campaign changed between the lead and coverage reads. Do not choose
    // one publication state arbitrarily for an external export.
    if (prior && PROJECT_CAMPAIGN_EVIDENCE_SELECT.split(",").some((field) => prior[field.trim()] !== campaign[field.trim()])) {
      return { data: null, error: { message: "Campaign coverage changed during the read; retry the export." } };
    }
    campaigns.set(campaign.id as string, campaign);
  }
  return { data: [...campaigns.values()], error: null };
}

/** Permitted report targets for a campaign, with the complete coverage read. */
export async function loadCampaignReportProjects(
  supabaseValue: unknown,
  campaign: { id: string; workspace_id: string; project_id: string | null },
): Promise<{ data: Array<{ id: string; name: string }>; error: { message: string } | null }> {
  const client = supabaseValue as SupabaseClient;
  const linked = await readEveryPage<Record<string, unknown>>((from, to) => client
    .from("engagement_campaign_projects")
    .select("project_id, projects!inner(id, name)")
    .eq("workspace_id", campaign.workspace_id)
    .eq("campaign_id", campaign.id)
    .eq("projects.workspace_id", campaign.workspace_id)
    .order("project_id", { ascending: true }).range(from, to));
  if (!linked.complete) return { data: [], error: { message: "The campaign's covered projects could not be read." } };
  const projects = new Map<string, { id: string; name: string }>();
  for (const row of linked.rows) {
    const project = row.projects as { id?: unknown; name?: unknown } | null;
    if (!project || typeof project.id !== "string" || typeof project.name !== "string") {
      return { data: [], error: { message: "A covered project could not be resolved." } };
    }
    projects.set(project.id, { id: project.id, name: project.name });
  }
  if (campaign.project_id && !projects.has(campaign.project_id)) {
    const lead = await client.from("projects").select("id, name")
      .eq("id", campaign.project_id).eq("workspace_id", campaign.workspace_id).maybeSingle();
    if (lead.error || !lead.data) return { data: [], error: { message: "The campaign's lead project could not be read." } };
    projects.set(lead.data.id, lead.data);
  }
  return { data: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)), error: null };
}
