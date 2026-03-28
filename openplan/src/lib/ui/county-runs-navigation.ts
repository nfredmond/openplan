const COUNTY_RUNS_BASE_PATH = "/county-runs";

export function getSafeCountyRunsBackHref(backTo: string | null | undefined): string {
  if (!backTo) return COUNTY_RUNS_BASE_PATH;

  if (backTo === COUNTY_RUNS_BASE_PATH) return backTo;
  if (backTo.startsWith(`${COUNTY_RUNS_BASE_PATH}?`)) return backTo;
  if (backTo.startsWith(`${COUNTY_RUNS_BASE_PATH}#`)) return backTo;

  return COUNTY_RUNS_BASE_PATH;
}

export function buildCountyRunDetailHref(countyRunId: string, backTo: string | null | undefined): string {
  const params = new URLSearchParams();
  params.set("backTo", getSafeCountyRunsBackHref(backTo));

  return `${COUNTY_RUNS_BASE_PATH}/${countyRunId}?${params.toString()}`;
}
