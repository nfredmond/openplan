export type CrashSeverityFilter = "all" | "fatal" | "severe_injury" | "injury";
export type CrashUserFilter = "all" | "pedestrian" | "bicycle" | "vru";

export type MapViewState = {
  tractMetric: "minority" | "poverty" | "income" | "disadvantaged";
  showTracts: boolean;
  showCrashes: boolean;
  crashSeverityFilter: CrashSeverityFilter;
  crashUserFilter: CrashUserFilter;
  activeDatasetOverlayId: string | null;
};

export function titleizeMapViewValue(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatCrashUserFilterLabel(value: CrashUserFilter | undefined): string {
  if (value === "vru") {
    return "Ped or bike";
  }
  if (value === "pedestrian") {
    return "Ped only";
  }
  if (value === "bicycle") {
    return "Bike only";
  }
  return "All users";
}

export function normalizeMapViewState(value: unknown): Partial<MapViewState> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const state: Partial<MapViewState> = {};

  if (["minority", "poverty", "income", "disadvantaged"].includes(String(record.tractMetric))) {
    state.tractMetric = record.tractMetric as MapViewState["tractMetric"];
  }

  if (typeof record.showTracts === "boolean") state.showTracts = record.showTracts;
  if (typeof record.showCrashes === "boolean") state.showCrashes = record.showCrashes;
  if (["all", "fatal", "severe_injury", "injury"].includes(String(record.crashSeverityFilter))) {
    state.crashSeverityFilter = record.crashSeverityFilter as CrashSeverityFilter;
  }
  if (["all", "pedestrian", "bicycle", "vru"].includes(String(record.crashUserFilter))) {
    state.crashUserFilter = record.crashUserFilter as CrashUserFilter;
  }
  if (record.activeDatasetOverlayId === null || typeof record.activeDatasetOverlayId === "string") {
    state.activeDatasetOverlayId = record.activeDatasetOverlayId as string | null;
  }

  return Object.keys(state).length > 0 ? state : null;
}

export function summarizeMapViewState(
  value: Partial<MapViewState> | null | undefined
): Array<{ label: string; value: string }> {
  if (!value) {
    return [];
  }

  return [
    {
      label: "Tract theme",
      value: titleizeMapViewValue(value.tractMetric ?? "unknown"),
    },
    {
      label: "Census tracts",
      value: value.showTracts === false ? "Hidden" : "Visible",
    },
    {
      label: "SWITRS lane",
      value: value.showCrashes === false ? "Hidden" : "Visible when available",
    },
    {
      label: "Crash filter",
      value: `${titleizeMapViewValue(value.crashSeverityFilter ?? "all")} · ${formatCrashUserFilterLabel(value.crashUserFilter ?? "all")}`,
    },
    {
      label: "Project overlay",
      value: typeof value.activeDatasetOverlayId === "string" ? "Selected" : "None",
    },
  ];
}
