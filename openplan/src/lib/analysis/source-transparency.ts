import type { StatusTone } from "@/lib/ui/status";

type DataQuality = {
  censusAvailable?: boolean;
  crashDataAvailable?: boolean;
  lodesSource?: string;
  equitySource?: string;
  aiInterpretationSource?: string;
};

export type SourceTransparencyItem = {
  key: "census" | "crashes" | "lodes" | "equity" | "ai";
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

export function buildSourceTransparency(
  metrics: Record<string, unknown>,
  explicitAiSource?: string
): SourceTransparencyItem[] {
  const dataQuality = (metrics.dataQuality ?? {}) as DataQuality;

  const lodesSource = normalizeText(dataQuality.lodesSource, "unknown");
  const equitySource = normalizeText(
    dataQuality.equitySource ?? metrics.equitySource,
    "cejst-proxy-census"
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
      status: dataQuality.crashDataAvailable ? "Live" : "Estimated",
      detail: dataQuality.crashDataAvailable
        ? "Fatal crash indicators were retrieved from the configured source for this run."
        : "Crash indicators are estimated fallback values and require manual validation.",
      tone: dataQuality.crashDataAvailable ? "success" : "info",
    },
    {
      key: "lodes",
      label: "LODES Employment",
      status: formatSourceToken(lodesSource),
      detail:
        lodesSource === "unknown"
          ? "Employment source could not be verified in this run metadata."
          : `Employment opportunity metrics were derived from ${formatSourceToken(lodesSource)}.`,
      tone: lodesSource === "unknown" ? "neutral" : "info",
    },
    {
      key: "equity",
      label: "Equity Screening",
      status: formatSourceToken(equitySource),
      detail: `Equity flags were generated using ${formatSourceToken(equitySource)} with corridor-level proxy aggregation.`,
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
