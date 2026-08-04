/**
 * Shared report access resolution.
 *
 * Lifted out of `src/app/api/reports/[reportId]/route.ts`, where it was a
 * private helper: the App Router forbids non-handler exports from a `route.ts`,
 * so a second route that needs the same authorization cannot import it there.
 * This mirrors `src/lib/models/api.ts`'s `loadModelAccess`, which exists for
 * exactly the same reason.
 *
 * The membership read is scoped by BOTH workspace and user, which is what keeps
 * it inside `workspace-membership-query-guard`'s rule — an unscoped
 * `workspace_members` lookup is how a "current workspace" ends up being
 * whichever row came back first.
 */

type QueryError = { message: string; code?: string } | null;

export type ReportAccessRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string | null;
  status: string | null;
  report_type: string | null;
  generated_at: string | null;
  latest_artifact_url: string | null;
  latest_artifact_kind: string | null;
};

export type ReportMembershipRow = {
  workspace_id: string;
  role: string;
};

/** The columns every report-access caller needs. Derived, never retyped. */
export const REPORT_ACCESS_COLUMNS =
  "id, workspace_id, project_id, title, status, report_type, generated_at, latest_artifact_url, latest_artifact_kind";

type QueryBuilder = {
  eq: (column: string, value: string) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: QueryError }>;
};

type QueryClientLike = {
  from: (table: string) => { select: (columns: string) => QueryBuilder };
};

export type ReportRegistryRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  rtp_cycle_id: string | null;
  engagement_campaign_id?: string | null;
  title: string;
  report_type: string;
  status: string;
  summary: string | null;
  generated_at: string | null;
  latest_artifact_kind: string | null;
  created_at: string;
  updated_at: string;
  projects:
    | { id: string; name: string }
    | Array<{ id: string; name: string }>
    | null;
  rtp_cycles:
    | { id: string; title: string; updated_at?: string | null }
    | Array<{ id: string; title: string; updated_at?: string | null }>
    | null;
  engagement_campaigns?:
    | { id: string; title: string }
    | Array<{ id: string; title: string }>
    | null;
};

const REPORT_REGISTRY_COLUMNS =
  "id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, generated_at, latest_artifact_kind, created_at, updated_at, projects(id, name), rtp_cycles(id, title, updated_at)";

const REPORT_REGISTRY_COLUMNS_WITH_CAMPAIGN = `${REPORT_REGISTRY_COLUMNS}, engagement_campaign_id, engagement_campaigns(id, title)`;

type RegistryQueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        order: (
          column: string,
          options: { ascending: boolean }
        ) => Promise<{ data: unknown; error: QueryError }>;
      };
    };
  };
};

/**
 * Load the workspace report registry, preferring the campaign-target column
 * and join. Until migration 20260727000008 is applied that column does not
 * exist, and existing project/RTP reports must keep rendering — so a
 * pending-schema error falls back to the legacy column list.
 */
export async function loadReportRegistryRows(
  supabase: unknown,
  // Required: RLS grants every workspace the user belongs to, so an
  // unscoped registry read merges workspaces (2026-08-03 review).
  workspaceId: string
): Promise<{ data: ReportRegistryRow[]; error: QueryError }> {
  const client = supabase as RegistryQueryClientLike;
  const primary = await client
    .from("reports")
    .select(REPORT_REGISTRY_COLUMNS_WITH_CAMPAIGN)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (
    primary.error &&
    /column .* does not exist|schema cache/i.test(primary.error.message ?? "")
  ) {
    const fallback = await client
      .from("reports")
      .select(REPORT_REGISTRY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    return {
      data: (fallback.data ?? []) as ReportRegistryRow[],
      error: fallback.error,
    };
  }

  return {
    data: (primary.data ?? []) as ReportRegistryRow[],
    error: primary.error,
  };
}

export async function loadReportAccess(supabase: unknown, reportId: string, userId: string) {
  const client = supabase as QueryClientLike;

  const { data: reportData, error: reportError } = await client
    .from("reports")
    .select(REPORT_ACCESS_COLUMNS)
    .eq("id", reportId)
    .maybeSingle();

  if (reportError) {
    return { report: null, membership: null, error: reportError };
  }

  const report = (reportData ?? null) as ReportAccessRow | null;
  if (!report) {
    return { report: null, membership: null, error: null };
  }

  const { data: membershipData, error: membershipError } = await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", report.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    return { report, membership: null, error: membershipError };
  }

  return {
    report,
    membership: (membershipData ?? null) as ReportMembershipRow | null,
    error: null,
  };
}
