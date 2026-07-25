import { ESTIMATED_SOURCE_NOTES, resolveEstimatedDomains } from "@/lib/analysis/estimated-source";
import type { StatusTone } from "@/lib/ui/status";

type DataQuality = {
  censusAvailable?: boolean;
  crashDataAvailable?: boolean;
  lodesSource?: string;
  equitySource?: string;
  aiInterpretationSource?: string;
};

export type SourceTransparencyItem = {
  key: "census" | "crashes" | "transit" | "lodes" | "equity" | "ai";
  label: string;
  status: string;
  detail: string;
  tone: StatusTone;
};

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function formatSourceToken(value: string): string {
  return value
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveAiSource(dataQuality: DataQuality, explicitAiSource?: string): string {
  if (typeof explicitAiSource === "string" && explicitAiSource.trim().length > 0) {
    return explicitAiSource;
  }

  return normalizeText(dataQuality.aiInterpretationSource, "fallback");
}

type SourceSnapshots = {
  crashes?: { source?: string };
  transit?: { source?: string };
  lodes?: { source?: string };
};

export function buildSourceTransparency(
  metrics: Record<string, unknown>,
  explicitAiSource?: string
): SourceTransparencyItem[] {
  const dataQuality = (metrics.dataQuality ?? {}) as DataQuality;
  const sourceSnapshots = (metrics.sourceSnapshots ?? {}) as SourceSnapshots;
  const estimatedDomains = resolveEstimatedDomains({
    sourceSnapshots,
    dataQuality,
  });

  const lodesSource = normalizeText(dataQuality.lodesSource ?? sourceSnapshots.lodes?.source, "unknown");
  const transitSource = normalizeText(sourceSnapshots.transit?.source, "unknown");
  const crashProvenanceKnown =
    typeof sourceSnapshots.crashes?.source === "string" ||
    typeof dataQuality.crashDataAvailable === "boolean";
  const equitySource = normalizeText(
    dataQuality.equitySource ?? metrics.equitySource,
    "proxy-census"
  );
  const aiSource = resolveAiSource(dataQuality, explicitAiSource).toLowerCase();

  return [
    {
      key: "census",
      label: "Census / ACS 5-Year",
      status: dataQuality.censusAvailable ? "Live" : "Unavailable",
      detail: dataQuality.censusAvailable
        ? "Population and demographic indicators are sourced from Census tables."
        : "Census source check failed for this run; treat demographic outputs as provisional.",
      tone: dataQuality.censusAvailable ? "success" : "warning",
    },
    {
      key: "crashes",
      label: "Crash Safety Data",
      status: !crashProvenanceKnown ? "Unknown" : estimatedDomains.crashes ? "Estimated" : "Live",
      detail: !crashProvenanceKnown
        ? "Crash source could not be verified in this run metadata."
        : estimatedDomains.crashes
          ? `${ESTIMATED_SOURCE_NOTES.crashes} Crash indicators require manual validation before release.`
          : "Fatal crash indicators were retrieved from the configured source for this run.",
      tone: !crashProvenanceKnown ? "neutral" : estimatedDomains.crashes ? "info" : "success",
    },
    {
      key: "transit",
      label: "Transit Stop Inventory",
      // Three states, and they are not interchangeable. "Estimated" survives
      // only for runs stored while the area-based fallback existed; new runs
      // report "Unavailable" and carry no stop counts at all.
      status:
        transitSource === "unknown"
          ? "Unknown"
          : transitSource === "unavailable"
            ? "Unavailable"
            : estimatedDomains.transit
              ? "Estimated"
              : formatSourceToken(transitSource),
      detail:
        transitSource === "unknown"
          ? "Transit stop source could not be verified in this run metadata."
          : transitSource === "unavailable"
            ? "No transit source answered for this area, so stop counts and density were not measured and the accessibility score carries no transit term. This is not a finding that the area has no transit."
            : estimatedDomains.transit
              ? `${ESTIMATED_SOURCE_NOTES.transit} Stop counts and density are approximations.`
              : `Transit stop counts were retrieved from ${formatSourceToken(transitSource)}.`,
      tone:
        transitSource === "unknown"
          ? "neutral"
          : transitSource === "unavailable"
            ? "warning"
            : estimatedDomains.transit
              ? "warning"
              : "info",
    },
    {
      key: "lodes",
      label: "LODES Employment",
      status:
        lodesSource === "unknown"
          ? "Unknown"
          : estimatedDomains.lodes
            ? "Estimated"
            : formatSourceToken(lodesSource),
      detail:
        lodesSource === "unknown"
          ? "Employment source could not be verified in this run metadata."
          : estimatedDomains.lodes
            ? ESTIMATED_SOURCE_NOTES.lodes
            : `Employment opportunity metrics were derived from ${formatSourceToken(lodesSource)}.`,
      tone: lodesSource === "unknown" ? "neutral" : "info",
    },
    {
      key: "equity",
      label: "Equity Screening",
      status: formatSourceToken(equitySource),
      detail: `Equity flags are an ACS income + burden PROXY (${formatSourceToken(equitySource)}, corridor-level tract aggregation) — a screening proxy, NOT the federal CEJST/Justice40 or California SB 535 disadvantaged-community designation.`,
      tone: "info",
    },
    {
      key: "ai",
      label: "AI Narrative Layer",
      status: aiSource === "ai" ? "AI-assisted" : "Deterministic fallback",
      detail:
        aiSource === "ai"
          ? "Narrative drafting used the AI interpretation layer; human review is required before release."
          : "Narrative fell back to deterministic summary logic because AI output was unavailable.",
      tone: aiSource === "ai" ? "info" : "warning",
    },
  ];
}
