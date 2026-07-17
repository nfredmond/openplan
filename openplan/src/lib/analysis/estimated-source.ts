/**
 * Pure decision logic for labeling estimated / fallback data sources.
 *
 * The analysis pipeline substitutes estimates when external sources fail
 * (crashes: "fars-estimate", transit: "estimate", employment: "acs-estimate").
 * Provenance is recorded in metrics.sourceSnapshots; these helpers decide when
 * a headline metric must carry a visible "Estimated" indicator.
 */

export const ESTIMATED_BADGE_LABEL = "Estimated";

export type SourceSnapshotLike = { source?: string | null } | null | undefined;

/** True when a source snapshot records an estimated / fallback provider. */
export function isEstimatedSource(snapshot: SourceSnapshotLike): boolean {
  const source = snapshot?.source;
  if (typeof source !== "string") {
    return false;
  }

  const normalized = source.trim().toLowerCase();
  return normalized === "estimate" || normalized.endsWith("-estimate");
}

export const ESTIMATED_SOURCE_NOTES = {
  crashes: "Crash source API unavailable — area-based estimate.",
  transit: "Transit stop inventory unavailable — area-based estimate.",
  lodes: "LODES employment not yet ingested — ACS-based estimate.",
} as const;

export type EstimatedDomain = keyof typeof ESTIMATED_SOURCE_NOTES;

export function estimatedSourceNote(domain: EstimatedDomain): string {
  return ESTIMATED_SOURCE_NOTES[domain];
}

export type EstimatedDomainFlags = Record<EstimatedDomain, boolean>;

type MetricsLike = {
  sourceSnapshots?: {
    crashes?: SourceSnapshotLike;
    transit?: SourceSnapshotLike;
    lodes?: SourceSnapshotLike;
  } | null;
  dataQuality?: {
    crashDataAvailable?: boolean;
    lodesSource?: string;
  } | null;
} | null;

/**
 * Resolve which metric domains are backed by estimated sources for a run.
 * Prefers metrics.sourceSnapshots; falls back to metrics.dataQuality for
 * historical runs persisted before source snapshots were recorded.
 */
export function resolveEstimatedDomains(metrics: MetricsLike | undefined): EstimatedDomainFlags {
  const snapshots = metrics?.sourceSnapshots ?? {};
  const dataQuality = metrics?.dataQuality ?? {};

  const crashes =
    typeof snapshots.crashes?.source === "string"
      ? isEstimatedSource(snapshots.crashes)
      : dataQuality.crashDataAvailable === false;

  const transit = isEstimatedSource(snapshots.transit);

  const lodes =
    typeof snapshots.lodes?.source === "string"
      ? isEstimatedSource(snapshots.lodes)
      : isEstimatedSource({ source: dataQuality.lodesSource });

  return { crashes, transit, lodes };
}

/**
 * One-line note for composite metrics (e.g. the accessibility score) whose
 * inputs include estimated transit and/or employment values.
 */
export function describeEstimatedAccessibilityInputs(
  flags: Pick<EstimatedDomainFlags, "transit" | "lodes">
): string | null {
  const parts: string[] = [];
  if (flags.transit) parts.push("transit stops");
  if (flags.lodes) parts.push("employment");

  if (parts.length === 0) {
    return null;
  }

  return `Includes estimated inputs (${parts.join(", ")}) — source data unavailable or not yet ingested.`;
}
