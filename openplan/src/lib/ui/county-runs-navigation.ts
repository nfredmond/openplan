const COUNTY_RUNS_BASE_PATH = "/county-runs";

const COUNTY_RUNS_VIEW_LABELS: Record<string, string> = {
  all: "All runs",
  "needs-attention": "Needs attention",
  "best-validated": "Best validated",
  "prototype-blocked": "Prototype blocked",
  "evidence-ready": "Evidence-ready",
  "comparison-ready": "Comparison-ready",
};

const COUNTY_RUNS_SORT_LABELS: Record<string, string> = {
  "updated-desc": "Recently updated",
  "stage-desc": "Most complete stage",
  "final-gap-asc": "Lowest final gap",
  "median-ape-asc": "Lowest median APE",
};

const COUNTY_RUNS_BEHAVIORAL_LABELS: Record<string, string> = {
  all: "All behavioral states",
  "evidence-ready": "Evidence-ready",
  "comparison-ready": "Comparison-ready",
  "preflight-only": "Preflight only",
  "runtime-failed": "Runtime failed",
  "lane-requested": "Lane requested",
};

const COUNTY_RUNS_RUNTIME_STATUS_LABELS: Record<string, string> = {
  all: "All runtime statuses",
  behavioral_runtime_succeeded: "Runtime succeeded",
  behavioral_runtime_blocked: "Runtime blocked",
  behavioral_runtime_failed: "Runtime failed",
};

const COUNTY_RUNS_RUNTIME_MODE_LABELS: Record<string, string> = {
  all: "All runtime modes",
  preflight_only: "Preflight only",
  containerized_activitysim: "Containerized ActivitySim",
};

export function getSafeCountyRunsBackHref(backTo: string | null | undefined): string {
  if (!backTo) return COUNTY_RUNS_BASE_PATH;

  if (backTo === COUNTY_RUNS_BASE_PATH) return backTo;
  if (backTo.startsWith(`${COUNTY_RUNS_BASE_PATH}?`)) return backTo;
  if (backTo.startsWith(`${COUNTY_RUNS_BASE_PATH}#`)) return backTo;

  return COUNTY_RUNS_BASE_PATH;
}

export function getCountyRunsBackContextLabel(backTo: string | null | undefined): string | null {
  const safeBackHref = getSafeCountyRunsBackHref(backTo);
  const queryIndex = safeBackHref.indexOf("?");
  if (queryIndex === -1) return null;

  const params = new URLSearchParams(safeBackHref.slice(queryIndex + 1).split("#", 1)[0] ?? "");
  if (![...params.keys()].length) return null;

  const view = COUNTY_RUNS_VIEW_LABELS[params.get("view") ?? "all"] ?? COUNTY_RUNS_VIEW_LABELS.all;
  const sort = COUNTY_RUNS_SORT_LABELS[params.get("sort") ?? "updated-desc"] ?? COUNTY_RUNS_SORT_LABELS["updated-desc"];
  const behavioral = params.get("behavioral");
  const runtimeStatus = params.get("runtimeStatus");
  const runtimeMode = params.get("runtimeMode");

  const parts = [`View: ${view}`, `Sort: ${sort}`];

  if (behavioral && behavioral !== "all") {
    parts.push(`Behavioral: ${COUNTY_RUNS_BEHAVIORAL_LABELS[behavioral] ?? behavioral}`);
  }
  if (runtimeStatus && runtimeStatus !== "all") {
    parts.push(`Runtime: ${COUNTY_RUNS_RUNTIME_STATUS_LABELS[runtimeStatus] ?? runtimeStatus}`);
  }
  if (runtimeMode && runtimeMode !== "all") {
    parts.push(`Mode: ${COUNTY_RUNS_RUNTIME_MODE_LABELS[runtimeMode] ?? runtimeMode}`);
  }

  return parts.join(" · ");
}

export function buildCountyRunDetailHref(countyRunId: string, backTo: string | null | undefined): string {
  const params = new URLSearchParams();
  params.set("backTo", getSafeCountyRunsBackHref(backTo));

  return `${COUNTY_RUNS_BASE_PATH}/${countyRunId}?${params.toString()}`;
}
