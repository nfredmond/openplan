/**
 * Typed report-run citation resolution (report_runs.model_run_id /
 * county_run_id), shared by the report detail and project workbench pages.
 *
 * Every read tolerates a database without the typed-evidence migration: the
 * widened select is retried with the legacy column set on a missing-column
 * error, so legacy Analysis Studio citations keep rendering unchanged.
 *
 * The Supabase client is typed loosely and query results are cast, matching
 * the repo convention (see src/lib/reports/api.ts).
 */

type QueryError = { message: string; code?: string | null } | null;

type SupabaseLike = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
  };
};

export type ReportRunCitationLink = {
  id: string;
  report_id?: string;
  run_id: string | null;
  model_run_id?: string | null;
  county_run_id?: string | null;
  sort_order?: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CitedModelRunRow = {
  id: string;
  run_title: string;
  engine_key: string;
  status: string;
  created_at?: string | null;
};

export type CitedCountyRunRow = {
  id: string;
  run_name: string | null;
  stage: string | null;
  updated_at?: string | null;
};

/** A resolved typed report citation for display: kind label + honest status. */
export type TypedRunCitation = {
  /** report_runs row id (stable list key). */
  id: string;
  kind: "model" | "county";
  runId: string;
  title: string;
  engineKey: string | null;
  /** Model-run status, or the county run's stage. */
  status: string | null;
};

export function looksLikePendingReportRunsSchema(message: string | null | undefined): boolean {
  return /column .* does not exist|relation .* does not exist|could not find the table|schema cache/i.test(
    message ?? ""
  );
}

/** Load one report's citation links, widened select first, legacy fallback. */
export async function loadReportRunCitationLinks(
  supabase: SupabaseLike,
  reportId: string
): Promise<{ links: ReportRunCitationLink[]; error: QueryError }> {
  const widened = (await supabase
    .from("report_runs")
    .select("id, run_id, model_run_id, county_run_id, sort_order")
    .eq("report_id", reportId)
    .order("sort_order", { ascending: true })) as { data: unknown; error: QueryError };

  if (!widened.error) {
    return { links: ((widened.data ?? []) as ReportRunCitationLink[]), error: null };
  }

  if (!looksLikePendingReportRunsSchema(widened.error.message)) {
    return { links: [], error: widened.error };
  }

  const legacy = (await supabase
    .from("report_runs")
    .select("id, run_id, sort_order")
    .eq("report_id", reportId)
    .order("sort_order", { ascending: true })) as { data: unknown; error: QueryError };

  return {
    links: ((legacy.data ?? []) as Array<Omit<ReportRunCitationLink, "model_run_id" | "county_run_id">>).map(
      (row) => ({ ...row, model_run_id: null, county_run_id: null })
    ),
    error: legacy.error,
  };
}

/** Load many reports' citation links (project workbench), same fallback. */
export async function loadReportRunCitationLinksForReports(
  supabase: SupabaseLike,
  reportIds: string[]
): Promise<{ links: ReportRunCitationLink[]; error: QueryError }> {
  if (reportIds.length === 0) {
    return { links: [], error: null };
  }

  const widened = (await supabase
    .from("report_runs")
    .select("report_id, run_id, model_run_id, county_run_id, created_at, updated_at")
    .in("report_id", reportIds)) as { data: unknown; error: QueryError };

  if (!widened.error) {
    return { links: ((widened.data ?? []) as ReportRunCitationLink[]), error: null };
  }

  if (!looksLikePendingReportRunsSchema(widened.error.message)) {
    return { links: [], error: widened.error };
  }

  const legacy = (await supabase
    .from("report_runs")
    .select("report_id, run_id, created_at, updated_at")
    .in("report_id", reportIds)) as { data: unknown; error: QueryError };

  return {
    links: ((legacy.data ?? []) as Array<Omit<ReportRunCitationLink, "model_run_id" | "county_run_id">>).map(
      (row) => ({ ...row, model_run_id: null, county_run_id: null })
    ),
    error: legacy.error,
  };
}

/** Batch-resolve the model/county runs behind typed citation links. Tolerates
 * a database without those modules by answering empty on pending schema. */
export async function resolveCitedRuns(
  supabase: SupabaseLike,
  links: ReportRunCitationLink[]
): Promise<{ citedModelRuns: CitedModelRunRow[]; citedCountyRuns: CitedCountyRunRow[] }> {
  const modelRunIds = Array.from(
    new Set(links.map((link) => link.model_run_id ?? null).filter((value): value is string => Boolean(value)))
  );
  const countyRunIds = Array.from(
    new Set(links.map((link) => link.county_run_id ?? null).filter((value): value is string => Boolean(value)))
  );

  const [modelRunsResult, countyRunsResult] = (await Promise.all([
    modelRunIds.length
      ? supabase.from("model_runs").select("id, run_title, engine_key, status, created_at").in("id", modelRunIds)
      : Promise.resolve({ data: [], error: null }),
    countyRunIds.length
      ? supabase.from("county_runs").select("id, run_name, stage, updated_at").in("id", countyRunIds)
      : Promise.resolve({ data: [], error: null }),
  ])) as Array<{ data: unknown; error: QueryError }>;

  return {
    citedModelRuns: looksLikePendingReportRunsSchema(modelRunsResult.error?.message) || modelRunsResult.error
      ? []
      : ((modelRunsResult.data ?? []) as CitedModelRunRow[]),
    citedCountyRuns: looksLikePendingReportRunsSchema(countyRunsResult.error?.message) || countyRunsResult.error
      ? []
      : ((countyRunsResult.data ?? []) as CitedCountyRunRow[]),
  };
}

/** Map citation links + resolved runs onto display citations, in link order. */
export function buildTypedRunCitations(
  links: ReportRunCitationLink[],
  citedModelRuns: CitedModelRunRow[],
  citedCountyRuns: CitedCountyRunRow[]
): TypedRunCitation[] {
  const modelRunById = new Map(citedModelRuns.map((run) => [run.id, run]));
  const countyRunById = new Map(citedCountyRuns.map((run) => [run.id, run]));

  return links
    .map((link): TypedRunCitation | null => {
      if (link.model_run_id) {
        const modelRun = modelRunById.get(link.model_run_id);
        if (!modelRun) return null;
        return {
          id: link.id,
          kind: "model" as const,
          runId: modelRun.id,
          title: modelRun.run_title,
          engineKey: modelRun.engine_key,
          status: modelRun.status,
        };
      }

      if (link.county_run_id) {
        const countyRun = countyRunById.get(link.county_run_id);
        if (!countyRun) return null;
        return {
          id: link.id,
          kind: "county" as const,
          runId: countyRun.id,
          title: countyRun.run_name ?? "County run",
          engineKey: null,
          status: countyRun.stage,
        };
      }

      return null;
    })
    .filter((item): item is TypedRunCitation => Boolean(item));
}

/** The succeeded model runs a report's attach control may cite: the target
 * project's runs first, workspace-scoped runs as the fallback (mirrors the
 * project workbench's availableModelRuns). Empty on any lookup failure. */
export async function loadCiteableModelRuns(
  supabase: SupabaseLike,
  { projectId, workspaceId }: { projectId: string; workspaceId: string }
): Promise<Array<{ id: string; title: string; engineKey: string; status: string }>> {
  const projectResult = (await supabase
    .from("model_runs")
    .select("id, run_title, engine_key, status")
    .eq("project_id", projectId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(50)) as { data: unknown; error: QueryError };

  let rows = projectResult.error ? [] : ((projectResult.data ?? []) as CitedModelRunRow[]);
  if (rows.length === 0) {
    const workspaceResult = (await supabase
      .from("model_runs")
      .select("id, run_title, engine_key, status")
      .eq("workspace_id", workspaceId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(50)) as { data: unknown; error: QueryError };
    rows = workspaceResult.error ? [] : ((workspaceResult.data ?? []) as CitedModelRunRow[]);
  }

  return rows.map((run) => ({ id: run.id, title: run.run_title, engineKey: run.engine_key, status: run.status }));
}
