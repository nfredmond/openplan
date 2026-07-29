import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";
import { SEVERITY_LABELS } from "@/lib/safety/client-types";
import { isCrashSeverity, type CrashSeverity } from "@/lib/safety/sources/types";

/**
 * One acquired collision, as the shared map carries it.
 *
 * `projectId` comes from the ACQUISITION, not from the crash: a crash point has
 * no project of its own, and inventing one would attach a collision to work it
 * was never gathered for. It is the ingest that was run for a project, so the
 * link travels with the ingest and is null whenever the acquisition was
 * workspace-wide.
 */
export type CrashFeatureProperties = {
  kind: "safety_crash";
  crashId: string;
  /** The project the ACQUISITION was run for, when it was run for one. */
  projectId: string | null;
  severity: CrashSeverity;
  collisionDate: string | null;
  collisionYear: number | null;
  killedCount: number;
  injuredCount: number;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
};

type NavigateOptions = {
  navigate: (path: string) => void;
  // Optional Mapbox source id so the resulting selection carries a
  // round-trip reference the backdrop can highlight via feature-state.
  sourceId?: string;
};

export function isCrashFeatureProperties(value: unknown): value is CrashFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "safety_crash" &&
    typeof v.crashId === "string" &&
    v.crashId.length > 0 &&
    (v.projectId === null || (typeof v.projectId === "string" && v.projectId.length > 0)) &&
    isCrashSeverity(v.severity) &&
    (v.collisionDate === null || typeof v.collisionDate === "string") &&
    (v.collisionYear === null || typeof v.collisionYear === "number") &&
    typeof v.killedCount === "number" &&
    typeof v.injuredCount === "number" &&
    typeof v.pedestrianInvolved === "boolean" &&
    typeof v.bicyclistInvolved === "boolean"
  );
}

/**
 * The date a planner can act on, degrading honestly.
 *
 * A source that only supplies a year gets the year, not a fabricated January 1;
 * a source that supplies neither says so rather than showing an empty slot that
 * reads as "today".
 */
function describeWhen(properties: CrashFeatureProperties): string {
  if (properties.collisionDate && properties.collisionDate.trim().length > 0) {
    return properties.collisionDate;
  }
  if (properties.collisionYear !== null) return String(properties.collisionYear);
  return "date not reported";
}

export function crashFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isCrashFeatureProperties(properties)) return null;

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "severity", value: SEVERITY_LABELS[properties.severity] },
    { label: "date", value: describeWhen(properties) },
    { label: "killed", value: String(properties.killedCount) },
    { label: "injured", value: String(properties.injuredCount) },
  ];

  // Only stated when true. A "pedestrian: no" row would present the absence of a
  // flag as a finding that no pedestrian was involved, which is a stronger claim
  // than the source makes.
  const modes = [
    properties.pedestrianInvolved ? "pedestrian" : null,
    properties.bicyclistInvolved ? "bicyclist" : null,
  ].filter((mode): mode is string => mode !== null);
  if (modes.length > 0) {
    meta.push({ label: "involved", value: modes.join(", "), tone: "urgent" });
  }

  const selection: CartographicInspectorSelection = {
    kind: "safety_crash",
    // The title is the severity, because that is the thing a planner scans for.
    title: `${SEVERITY_LABELS[properties.severity]} collision`,
    kicker: "Reported collision",
    avatarChar: "S",
    meta,
    primaryAction: {
      label: "Open Safety",
      // Carry the acquisition's project through so the Safety workbench opens
      // scoped to the same work, rather than making the planner re-pick it.
      onClick: () =>
        navigate(
          properties.projectId ? `/safety?projectId=${encodeURIComponent(properties.projectId)}` : "/safety"
        ),
    },
  };

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.crashId };
  }

  return selection;
}
