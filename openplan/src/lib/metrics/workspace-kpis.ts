type RunRow = {
  created_at: string;
  metrics: Record<string, unknown> | null;
  summary_text: string | null;
  report_generated_count: number | null;
};

export type WorkspaceKpis = {
  totalRuns: number;
  completedRuns: number;
  runCompletionRate: number | null;
  runsWithReports: number;
  reportGenerationRate: number | null;
  firstRunAt: string | null;
  timeToFirstResultHours: number | null;
};

function toPercent(numerator: number, denominator: number): number | null {
  if (!denominator) {
    return null;
  }

  return Math.round((numerator / denominator) * 1000) / 10;
}

function toHours(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return null;
  }

  return Math.round(((end - start) / 36e5) * 10) / 10;
}

export function buildWorkspaceKpis({
  workspaceCreatedAt,
  runs,
}: {
  workspaceCreatedAt: string | null;
  runs: RunRow[];
}): WorkspaceKpis {
  const sortedRuns = [...runs].sort((a, b) => {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const totalRuns = sortedRuns.length;
  const completedRuns = sortedRuns.filter((run) => Boolean(run.metrics) && Boolean(run.summary_text)).length;
  const runsWithReports = sortedRuns.filter((run) => (run.report_generated_count ?? 0) > 0).length;

  const firstRunAt = sortedRuns[0]?.created_at ?? null;
  const timeToFirstResultHours = workspaceCreatedAt && firstRunAt ? toHours(workspaceCreatedAt, firstRunAt) : null;

  return {
    totalRuns,
    completedRuns,
    runCompletionRate: toPercent(completedRuns, totalRuns),
    runsWithReports,
    reportGenerationRate: toPercent(runsWithReports, totalRuns),
    firstRunAt,
    timeToFirstResultHours,
  };
}

export function formatTimeToFirstResult(hours: number | null): string {
  if (hours === null) {
    return "Not available";
  }

  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.round((hours / 24) * 10) / 10;
  return `${days}d`;
}
