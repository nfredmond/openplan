type ScenarioReportWritebackSelectChain<T> = {
  eq: (column: string, value: string) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string | null } | null }>;
  in: (column: string, values: string[]) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string | null } | null }>;
};

type ScenarioReportWritebackUpdateChain = {
  in: (column: string, values: string[]) => {
    eq: (column: string, value: string) => PromiseLike<{ error: { message: string; code?: string | null } | null }>;
  };
};

export type ScenarioReportWritebackSupabaseLike = {
  from: (table: string) => {
    select: <T = Record<string, unknown>>(query: string) => ScenarioReportWritebackSelectChain<T>;
    update: (values: Record<string, unknown>) => ScenarioReportWritebackUpdateChain;
  };
};

type ScenarioEntryRunRow = {
  attached_run_id: string | null;
};

type ReportRunRow = {
  report_id: string;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function touchScenarioLinkedReportPackets({
  supabase,
  scenarioSetId,
  workspaceId,
  touchedAt = new Date().toISOString(),
}: {
  supabase: ScenarioReportWritebackSupabaseLike;
  scenarioSetId: string;
  workspaceId: string;
  touchedAt?: string;
}): Promise<{ touchedReportIds: string[]; error: { message: string; code?: string | null } | null }> {
  const entriesResult = await supabase
    .from("scenario_entries")
    .select<ScenarioEntryRunRow>("attached_run_id")
    .eq("scenario_set_id", scenarioSetId);

  if (entriesResult.error) {
    return { touchedReportIds: [], error: entriesResult.error };
  }

  const runIds = uniqueStrings((entriesResult.data ?? []).map((entry) => entry.attached_run_id));
  if (runIds.length === 0) {
    return { touchedReportIds: [], error: null };
  }

  const reportRunsResult = await supabase
    .from("report_runs")
    .select<ReportRunRow>("report_id")
    .in("run_id", runIds);

  if (reportRunsResult.error) {
    return { touchedReportIds: [], error: reportRunsResult.error };
  }

  const reportIds = uniqueStrings((reportRunsResult.data ?? []).map((link) => link.report_id));
  if (reportIds.length === 0) {
    return { touchedReportIds: [], error: null };
  }

  const updateResult = await supabase
    .from("reports")
    .update({ updated_at: touchedAt })
    .in("id", reportIds)
    .eq("workspace_id", workspaceId);

  if (updateResult.error) {
    return { touchedReportIds: [], error: updateResult.error };
  }

  return { touchedReportIds: reportIds, error: null };
}

export async function markScenarioLinkedReportsBasisStale({
  supabase,
  scenarioSetId,
  workspaceId,
  runId,
  reason,
  markedAt = new Date().toISOString(),
}: {
  supabase: ScenarioReportWritebackSupabaseLike;
  scenarioSetId: string;
  workspaceId: string;
  runId: string;
  reason: string;
  markedAt?: string;
}): Promise<{ staleReportIds: string[]; error: { message: string; code?: string | null } | null }> {
  const entriesResult = await supabase
    .from("scenario_entries")
    .select<ScenarioEntryRunRow>("attached_run_id")
    .eq("scenario_set_id", scenarioSetId);

  if (entriesResult.error) {
    return { staleReportIds: [], error: entriesResult.error };
  }

  const runIds = uniqueStrings((entriesResult.data ?? []).map((entry) => entry.attached_run_id));
  if (runIds.length === 0) {
    return { staleReportIds: [], error: null };
  }

  const reportRunsResult = await supabase
    .from("report_runs")
    .select<ReportRunRow>("report_id")
    .in("run_id", runIds);

  if (reportRunsResult.error) {
    return { staleReportIds: [], error: reportRunsResult.error };
  }

  const reportIds = uniqueStrings((reportRunsResult.data ?? []).map((link) => link.report_id));
  if (reportIds.length === 0) {
    return { staleReportIds: [], error: null };
  }

  const updateResult = await supabase
    .from("reports")
    .update({
      rtp_basis_stale: true,
      rtp_basis_stale_reason: reason,
      rtp_basis_stale_run_id: runId,
      rtp_basis_stale_marked_at: markedAt,
      updated_at: markedAt,
    })
    .in("id", reportIds)
    .eq("workspace_id", workspaceId);

  if (updateResult.error) {
    return { staleReportIds: [], error: updateResult.error };
  }

  return { staleReportIds: reportIds, error: null };
}
