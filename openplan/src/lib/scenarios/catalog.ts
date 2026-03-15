export const SCENARIO_SET_STATUSES = ["draft", "active", "archived"] as const;
export const SCENARIO_ENTRY_TYPES = ["baseline", "alternative"] as const;
export const SCENARIO_ENTRY_STATUSES = ["draft", "ready", "superseded"] as const;

export type ScenarioSetStatus = (typeof SCENARIO_SET_STATUSES)[number];
export type ScenarioEntryType = (typeof SCENARIO_ENTRY_TYPES)[number];
export type ScenarioEntryStatus = (typeof SCENARIO_ENTRY_STATUSES)[number];

export function titleizeScenarioValue(value: string | null | undefined): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeScenarioSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return normalized || "scenario-entry";
}

export function makeScenarioEntrySlug(label: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${normalizeScenarioSlug(label)}-${suffix}`;
}

export function scenarioStatusTone(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active" || status === "ready") return "success";
  if (status === "archived" || status === "superseded") return "warning";
  if (status === "draft") return "neutral";
  return "neutral";
}

export function scenarioComparisonStatus(
  baselineRunId: string | null | undefined,
  candidateRunId: string | null | undefined
): "ready" | "missing-run" {
  return baselineRunId && candidateRunId ? "ready" : "missing-run";
}
