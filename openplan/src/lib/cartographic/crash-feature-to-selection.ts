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
  /**
   * NULLABLE, and rendered as "not reported" rather than as a zero.
   *
   * The route used to coerce an unreadable count to 0, so a collision the source
   * supplied no casualty count for was inspected as "killed 0 · injured 0" — a
   * claim about a real crash that nobody made. Roughly 5% of one state's 2025
   * records are in that state, and 9.5% in one rural county of it.
   */
  killedCount: number | null;
  injuredCount: number | null;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
  /** Optional because the shared layer predates them; absent means unknown. */
  motorcyclistInvolved?: boolean;
  collisionType?: string | null;
  lighting?: string | null;
  weather?: string | null;
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
    (v.killedCount === null || typeof v.killedCount === "number") &&
    (v.injuredCount === null || typeof v.injuredCount === "number") &&
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

/**
 * A casualty count, or the honest absence of one.
 *
 * The one thing this must never do is print "0" for a count the source did not
 * supply — a screen saying nobody was killed in a collision whose outcome was
 * never recorded is the single most consequential thing this module could get
 * wrong.
 */
function describeCount(value: number | null): string {
  return value === null ? "not reported" : String(value);
}

/**
 * The casualty line for a map popup — the same rule as `describeCount`, in the
 * one sentence a hover produces.
 *
 * WHY IT LIVES HERE AND NOT IN THE MAP. It used to live in
 * `src/components/safety/safety-crash-map.tsx` as a private helper reading
 * `Number(props.killedCount ?? 0)`, which published "0 killed · 0 injured" for a
 * collision the source supplied no count for — roughly one record in twenty
 * statewide and one in eleven in a rural county. That is the identical mistake
 * the inspector above had, made independently, in the second of the two callers
 * that render this pair of numbers. So the rule now has one home, and it is a
 * pure module a test can reach without a Mapbox instance.
 *
 * Takes `unknown` because Mapbox feature properties are untyped at the point of
 * the hover: a value that is not a finite number is "not reported", never zero.
 *
 * THE EMPTY STRING IS WHY THIS READER IS NOT ONE LINE. `Number("")` is 0 and
 * `Number(" ")` is 0, and Mapbox stringifies feature properties, so the version
 * this replaced turned an absent count into "0 injured" for exactly the records
 * the `unknown` severity band exists to protect — the same falsehood it had just
 * been fixed for, arriving by a different route. A negative count is likewise an
 * error in the feed (observed in the wild) and not a statement that nobody was
 * hurt, so it reads as absent too, matching `readCasualtyCount` upstream.
 */
export function describeCrashCasualtyLine(killed: unknown, injured: unknown): string {
  const read = (value: unknown): number | null => {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim().length > 0
          ? Number(value.trim())
          : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.trunc(parsed);
  };
  const k = read(killed);
  const i = read(injured);
  // Both absent is not two absences — it is a collision whose outcome the source
  // never recorded, and it reads better as one statement than as a line of
  // repeated "not reported".
  if (k === null && i === null) return "No casualty count reported by the source";
  return `${describeCount(k)} killed · ${describeCount(i)} injured`;
}

export function crashFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isCrashFeatureProperties(properties)) return null;

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "severity", value: SEVERITY_LABELS[properties.severity] },
    { label: "date", value: describeWhen(properties) },
    // "not reported" is a fact about the record. A zero here would be a fact
    // about the collision, and it is one no source stated.
    { label: "killed", value: describeCount(properties.killedCount) },
    { label: "injured", value: describeCount(properties.injuredCount) },
  ];

  // The neutral dimensions, stated only when the source recorded them.
  //
  // A dimension the source does not carry arrives as null and is OMITTED rather
  // than shown blank or as "unknown": this card describes ONE collision, and it
  // cannot tell the reader whether the gap is a missing observation or a missing
  // field. The per-acquisition coverage disclosure in the Safety workbench is
  // where that distinction is drawn, because that is where the answer exists.
  for (const [label, value] of [
    ["manner", properties.collisionType],
    ["lighting", properties.lighting],
    ["weather", properties.weather],
  ] as const) {
    if (typeof value === "string" && value.length > 0 && value !== "unknown") {
      meta.push({ label, value: value.replace(/_/g, " ") });
    }
  }

  // Only stated when true. A "pedestrian: no" row would present the absence of a
  // flag as a finding that no pedestrian was involved, which is a stronger claim
  // than the source makes.
  const modes = [
    properties.pedestrianInvolved ? "pedestrian" : null,
    properties.bicyclistInvolved ? "bicyclist" : null,
    properties.motorcyclistInvolved ? "motorcyclist" : null,
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
