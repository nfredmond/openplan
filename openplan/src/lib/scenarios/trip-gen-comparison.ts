/**
 * M6 part 2 — pure payload builder that turns two ITE trip-generation runs'
 * KPI rows into a POST body for the EXISTING scenario-spine route
 * `/api/scenarios/[scenarioSetId]/spine/comparison-snapshots`. No fetching, no
 * clock, no RNG: the client component fetches KPI rows and this module shapes
 * them to match `createComparisonSnapshotSchema` / `indicatorDeltaSchema`
 * exactly (indicatorKey, indicatorLabel, unitLabel, delta, summary, sortOrder).
 */

import {
  ITE_TRIP_GEN_KPI_NAMES,
  ITE_TRIP_GEN_SCREENING_CAVEAT,
} from "@/lib/models/ite-trip-generation";

/** Field caps mirrored from the spine route's zod schemas so an over-long
 * label or unit can never bounce the whole snapshot with a 400. */
const SPINE_LABEL_MAX_LENGTH = 160;
const SPINE_INDICATOR_KEY_MAX_LENGTH = 120;
const SPINE_INDICATOR_LABEL_MAX_LENGTH = 160;
const SPINE_UNIT_LABEL_MAX_LENGTH = 80;
const SPINE_SUMMARY_MAX_LENGTH = 2000;
const SPINE_DELTA_SUMMARY_MAX_LENGTH = 1000;
export const SPINE_CAVEAT_MAX_LENGTH = 400;

export type TripGenComparisonEntryRef = {
  id: string;
  label: string;
};

/** The subset of a `model_run_kpis` row this builder needs. */
export type TripGenComparisonKpiRow = {
  kpi_name: string;
  kpi_label?: string | null;
  value: number | null;
  unit?: string | null;
};

/** Matches the spine route's `indicatorDeltaSchema` field names exactly. */
export type TripGenComparisonIndicatorDelta = {
  indicatorKey: string;
  indicatorLabel: string;
  unitLabel?: string;
  delta: {
    baseline: number;
    candidate: number;
    delta: number;
  };
  summary: string;
  sortOrder: number;
};

/** Matches the spine route's `createComparisonSnapshotSchema`. */
export type TripGenComparisonPayload = {
  baselineEntryId: string;
  candidateEntryId: string;
  label: string;
  summary: string;
  caveats: string[];
  indicatorDeltas: TripGenComparisonIndicatorDelta[];
  metadata: Record<string, unknown>;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const clamp = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : value.slice(0, maxLength).trimEnd();

/**
 * The spine schema caps each caveat at 400 characters
 * (`z.string().trim().min(1).max(400)`), but ITE_TRIP_GEN_SCREENING_CAVEAT is
 * 411 characters. Truncating would silently drop part of the claim boundary
 * (the "verify rates before regulatory/funding/design use" sentence), so
 * instead the caveat is split AT SENTENCE BOUNDARIES into multiple
 * schema-compliant strings — the route accepts up to 25 caveats — keeping the
 * full screening caveat verbatim with every piece under the 400-char cap. A
 * single sentence longer than the cap (not the case today) is hard-truncated
 * as a last resort so the payload can never fail spine validation.
 */
export function splitCaveatForSpine(
  caveat: string,
  maxLength: number = SPINE_CAVEAT_MAX_LENGTH
): string[] {
  const trimmed = caveat.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLength) return [trimmed];

  // Sentence boundary = a period followed by whitespace. "§15064.3" is safe:
  // its inner period is not followed by whitespace.
  const sentences = trimmed.split(/(?<=\.)\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((chunk) =>
    chunk.length <= maxLength ? chunk : `${chunk.slice(0, maxLength - 1).trimEnd()}…`
  );
}

/** The screening caveat pre-split for the spine's 400-char-per-caveat cap. */
export const TRIP_GEN_COMPARISON_CAVEATS: readonly string[] = splitCaveatForSpine(
  ITE_TRIP_GEN_SCREENING_CAVEAT
);

function firstKpiByName(rows: TripGenComparisonKpiRow[]): Map<string, TripGenComparisonKpiRow> {
  const byName = new Map<string, TripGenComparisonKpiRow>();
  for (const row of rows) {
    if (!byName.has(row.kpi_name)) {
      byName.set(row.kpi_name, row);
    }
  }
  return byName;
}

const formatSigned = (value: number): string => (value >= 0 ? `+${value}` : String(value));

/**
 * Build the POST body for the spine comparison-snapshots route from two ITE
 * trip-generation runs' KPI rows. One indicatorDelta is produced per KPI that
 * is (a) inside the ITE_TRIP_GEN_KPI_NAMES namespace and (b) present with a
 * finite numeric value on BOTH sides; one-sided or null-valued KPIs are
 * skipped rather than guessed. Delta ordering is the canonical KPI-name order,
 * independent of input row order.
 */
export function buildTripGenComparisonPayload({
  baselineEntry,
  candidateEntry,
  baselineKpis,
  candidateKpis,
  label,
}: {
  baselineEntry: TripGenComparisonEntryRef;
  candidateEntry: TripGenComparisonEntryRef;
  baselineKpis: TripGenComparisonKpiRow[];
  candidateKpis: TripGenComparisonKpiRow[];
  label: string;
}): TripGenComparisonPayload {
  const baselineByName = firstKpiByName(baselineKpis);
  const candidateByName = firstKpiByName(candidateKpis);

  const indicatorDeltas: TripGenComparisonIndicatorDelta[] = [];
  for (const kpiName of ITE_TRIP_GEN_KPI_NAMES) {
    const baselineRow = baselineByName.get(kpiName);
    const candidateRow = candidateByName.get(kpiName);
    if (!baselineRow || !candidateRow) continue;

    const baselineValue = baselineRow.value;
    const candidateValue = candidateRow.value;
    if (
      typeof baselineValue !== "number" ||
      typeof candidateValue !== "number" ||
      !Number.isFinite(baselineValue) ||
      !Number.isFinite(candidateValue)
    ) {
      continue;
    }

    const delta = round2(candidateValue - baselineValue);
    const indicatorLabel = clamp(
      (baselineRow.kpi_label ?? candidateRow.kpi_label ?? kpiName).trim() || kpiName,
      SPINE_INDICATOR_LABEL_MAX_LENGTH
    );
    const unitLabel = clamp((baselineRow.unit ?? candidateRow.unit ?? "").trim(), SPINE_UNIT_LABEL_MAX_LENGTH);
    const summary = clamp(
      `${indicatorLabel}: ${baselineValue} → ${candidateValue} (${formatSigned(delta)}${unitLabel ? ` ${unitLabel}` : ""})`,
      SPINE_DELTA_SUMMARY_MAX_LENGTH
    );

    indicatorDeltas.push({
      indicatorKey: clamp(kpiName, SPINE_INDICATOR_KEY_MAX_LENGTH),
      indicatorLabel,
      ...(unitLabel ? { unitLabel } : {}),
      delta: {
        baseline: baselineValue,
        candidate: candidateValue,
        delta,
      },
      summary,
      sortOrder: indicatorDeltas.length,
    });
  }

  const trimmedLabel = label.trim();
  const resolvedLabel = clamp(
    trimmedLabel || `Trip generation — ${candidateEntry.label} vs ${baselineEntry.label}`.trim(),
    SPINE_LABEL_MAX_LENGTH
  );

  const summary = clamp(
    `Screening trip-generation comparison of "${candidateEntry.label}" against "${baselineEntry.label}" across ${indicatorDeltas.length} shared KPI${indicatorDeltas.length === 1 ? "" : "s"} (average-rate method).`,
    SPINE_SUMMARY_MAX_LENGTH
  );

  return {
    baselineEntryId: baselineEntry.id,
    candidateEntryId: candidateEntry.id,
    label: resolvedLabel,
    summary,
    caveats: [...TRIP_GEN_COMPARISON_CAVEATS],
    indicatorDeltas,
    metadata: {
      engineKey: "ite_trip_generation",
      comparisonKind: "ite_trip_generation_kpi_deltas",
      sharedKpiNames: indicatorDeltas.map((delta) => delta.indicatorKey),
    },
  };
}
