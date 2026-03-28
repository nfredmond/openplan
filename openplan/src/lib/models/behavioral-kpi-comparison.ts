type ComparisonRow = Record<string, unknown>;

export type BehavioralComparisonSource = {
  sourceType: "behavioral_kpi_summary" | "behavioral_evidence_packet";
  sourcePath: string | null;
  runtimeMode: string | null;
  runtimeStatus: string | null;
  availabilityStatus: string | null;
  caveats: string[];
  coverage: {
    totals: string[];
    tripVolumesByPurpose: boolean;
    modeShares: boolean;
    segmentSummaries: string[];
  };
  rows: ComparisonRow[];
};

export type BehavioralDemandComparison = {
  schema_version: string;
  comparison_type: "behavioral_demand_comparison";
  generated_at_utc: string;
  current: {
    source_type: BehavioralComparisonSource["sourceType"] | null;
    source_path: string | null;
    runtime_mode: string | null;
    runtime_status: string | null;
    availability_status: string | null;
  };
  baseline: {
    source_type: BehavioralComparisonSource["sourceType"] | null;
    source_path: string | null;
    runtime_mode: string | null;
    runtime_status: string | null;
    availability_status: string | null;
  };
  support: {
    status:
      | "behavioral_comparison_available"
      | "behavioral_comparison_partial_only"
      | "behavioral_comparison_blocked";
    supportable: boolean;
    partial: boolean;
    message: string;
    reason_codes: string[];
  };
  coverage: {
    current_kpi_keys: string[];
    baseline_kpi_keys: string[];
    comparable_kpi_keys: string[];
    current_only_kpi_keys: string[];
    baseline_only_kpi_keys: string[];
    comparable_kpi_count: number;
    current_only_count: number;
    baseline_only_count: number;
  };
  exclusions: string[];
  caveats: string[];
  comparison: {
    comparable_kpi_count: number;
    changed_kpi_count: number;
    flat_kpi_count: number;
    rows: ComparisonRow[];
  };
};

type SummaryValueRow = {
  label?: string;
  count?: number | null;
  share?: number | null;
};

type GenericRecord = Record<string, unknown>;

function asRecord(value: unknown): GenericRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as GenericRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function titleCase(value: string) {
  return value
    .split(/[_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dedupeStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function normalizeSummaryValues(value: unknown): SummaryValueRow[] {
  return Array.isArray(value)
    ? value.map((item) => {
        const row = asRecord(item) ?? {};
        return {
          label: asString(row.label) ?? undefined,
          count: asNumber(row.count),
          share: asNumber(row.share),
        };
      })
    : [];
}

function coverageFromSummary(summary: GenericRecord) {
  const coverage = asRecord(summary.coverage) ?? {};
  return {
    totals: asStringArray(coverage.totals),
    tripVolumesByPurpose: Boolean(coverage.trip_volumes_by_purpose),
    modeShares: Boolean(coverage.mode_shares),
    segmentSummaries: asStringArray(coverage.segment_summaries),
  };
}

function pushRow(
  rows: ComparisonRow[],
  {
    category,
    name,
    label,
    value,
    unit,
    geometryRef = null,
  }: {
    category: string;
    name: string;
    label: string;
    value: number | null;
    unit: string | null;
    geometryRef?: string | null;
  }
) {
  rows.push({
    kpi_category: category,
    kpi_name: name,
    kpi_label: label,
    value,
    unit,
    geometry_ref: geometryRef,
  });
}

function flattenBehavioralKpiSummary(summary: GenericRecord): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const totals = asRecord(summary.totals) ?? {};
  for (const metric of ["households", "persons", "tours", "trips"]) {
    pushRow(rows, {
      category: "totals",
      name: `total_${metric}`,
      label: titleCase(metric),
      value: asNumber(totals[metric]),
      unit: "count",
    });
  }

  const tripPurpose = asRecord(summary.trip_volumes_by_purpose) ?? {};
  for (const item of normalizeSummaryValues(tripPurpose.values)) {
    const label = item.label ?? "(missing)";
    pushRow(rows, {
      category: "trip_purpose",
      name: "trip_purpose_count",
      label: `Trip purpose trips · ${label}`,
      value: item.count ?? null,
      unit: "trips",
      geometryRef: label,
    });
    pushRow(rows, {
      category: "trip_purpose",
      name: "trip_purpose_share_pct",
      label: `Trip purpose share · ${label}`,
      value: item.share !== null && item.share !== undefined ? item.share * 100 : null,
      unit: "%",
      geometryRef: label,
    });
  }

  const modeShares = asRecord(summary.mode_shares) ?? {};
  for (const item of normalizeSummaryValues(modeShares.values)) {
    const label = item.label ?? "(missing)";
    pushRow(rows, {
      category: "mode_share",
      name: "mode_share_count",
      label: `Mode trips · ${label}`,
      value: item.count ?? null,
      unit: "trips",
      geometryRef: label,
    });
    pushRow(rows, {
      category: "mode_share",
      name: "mode_share_pct",
      label: `Mode share · ${label}`,
      value: item.share !== null && item.share !== undefined ? item.share * 100 : null,
      unit: "%",
      geometryRef: label,
    });
  }

  const segmentSummaries = Array.isArray(summary.segment_summaries) ? summary.segment_summaries : [];
  for (const segmentSummary of segmentSummaries) {
    const item = asRecord(segmentSummary) ?? {};
    const targetKind = asString(item.target_kind) ?? "segment";
    const segment = asString(item.segment) ?? "group";
    for (const value of normalizeSummaryValues(item.values)) {
      const label = value.label ?? "(missing)";
      pushRow(rows, {
        category: `segment_${targetKind}`,
        name: `${segment}_count`,
        label: `${titleCase(targetKind)} ${titleCase(segment)} count · ${label}`,
        value: value.count ?? null,
        unit: "count",
        geometryRef: `${targetKind}:${segment}:${label}`,
      });
      pushRow(rows, {
        category: `segment_${targetKind}`,
        name: `${segment}_share_pct`,
        label: `${titleCase(targetKind)} ${titleCase(segment)} share · ${label}`,
        value: value.share !== null && value.share !== undefined ? value.share * 100 : null,
        unit: "%",
        geometryRef: `${targetKind}:${segment}:${label}`,
      });
    }
  }

  return rows;
}

function normalizeBehavioralSummary(summary: GenericRecord, sourceType: BehavioralComparisonSource["sourceType"], sourcePath: string | null) {
  return {
    sourceType,
    sourcePath,
    runtimeMode: asString(asRecord(summary.source)?.runtime_mode),
    runtimeStatus: asString(asRecord(summary.source)?.runtime_status),
    availabilityStatus: asString(asRecord(summary.availability)?.status),
    caveats: asStringArray(summary.caveats),
    coverage: coverageFromSummary(summary),
    rows: flattenBehavioralKpiSummary(summary),
  } satisfies BehavioralComparisonSource;
}

export function normalizeBehavioralComparisonSource(payload: unknown): BehavioralComparisonSource | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  if (asString(record.summary_type) === "activitysim_behavioral_kpi_summary") {
    return normalizeBehavioralSummary(record, "behavioral_kpi_summary", null);
  }

  if (asString(record.packet_type) === "behavioral_demand_evidence_packet") {
    const source = asRecord(record.source);
    const prototypeChain = asRecord(record.prototype_chain);
    const behavioralKpis = asRecord(prototypeChain?.behavioral_kpis);
    const runtime = asRecord(prototypeChain?.runtime);
    if (!behavioralKpis) {
      return null;
    }

    const syntheticSummary: GenericRecord = {
      summary_type: "activitysim_behavioral_kpi_summary",
      source: {
        runtime_mode: asString(runtime?.mode),
        runtime_status: asString(runtime?.status),
      },
      availability: {
        status: asString(behavioralKpis.availability_status),
        reasons: asStringArray(behavioralKpis.availability_reasons),
      },
      coverage: asRecord(behavioralKpis.coverage) ?? {},
      totals: asRecord(behavioralKpis.totals) ?? {},
      trip_volumes_by_purpose: asRecord(behavioralKpis.trip_volumes_by_purpose) ?? {},
      mode_shares: asRecord(behavioralKpis.mode_shares) ?? {},
      segment_summaries: Array.isArray(behavioralKpis.segment_summaries) ? behavioralKpis.segment_summaries : [],
      caveats: asStringArray(record.caveats),
    };
    return normalizeBehavioralSummary(
      syntheticSummary,
      "behavioral_evidence_packet",
      asString(source?.behavioral_manifest_path) ?? asString(source?.input_path)
    );
  }

  return null;
}

function sourceIsBlocked(source: BehavioralComparisonSource | null) {
  if (!source) {
    return true;
  }
  return (
    source.availabilityStatus === "not_enough_behavioral_outputs" ||
    source.runtimeMode === "preflight_only" ||
    source.runtimeStatus === "blocked"
  );
}

function sourceIsPartial(source: BehavioralComparisonSource | null) {
  if (!source) {
    return false;
  }
  return source.availabilityStatus === "partial_behavioral_outputs" || source.runtimeStatus === "failed";
}

function rowKey(row: ComparisonRow) {
  const name = asString(row.kpi_name) ?? "kpi";
  const geometryRef = asString(row.geometry_ref) ?? "";
  return `${name}::${geometryRef}`;
}

export function buildBehavioralDemandComparison(
  currentSource: BehavioralComparisonSource | null,
  baselineSource: BehavioralComparisonSource | null
): BehavioralDemandComparison {
  const currentRows = currentSource?.rows ?? [];
  const baselineRows = baselineSource?.rows ?? [];
  const currentMap = new Map(currentRows.map((row) => [rowKey(row), row]));
  const baselineMap = new Map(baselineRows.map((row) => [rowKey(row), row]));
  const currentKeys = Array.from(currentMap.keys()).sort();
  const baselineKeys = Array.from(baselineMap.keys()).sort();
  const sharedKeys = currentKeys.filter((key) => baselineMap.has(key));
  const sharedComparableKeys = sharedKeys.filter((key) => {
    const current = currentMap.get(key) ?? {};
    const baseline = baselineMap.get(key) ?? {};
    return asNumber(current.value) !== null && asNumber(baseline.value) !== null;
  });
  const currentOnlyKeys = currentKeys.filter((key) => !baselineMap.has(key));
  const baselineOnlyKeys = baselineKeys.filter((key) => !currentMap.has(key));

  const comparisonRows = sharedComparableKeys.map((key) => {
    const current = currentMap.get(key) ?? {};
    const baseline = baselineMap.get(key) ?? {};
    const currentValue = asNumber(current.value);
    const baselineValue = asNumber(baseline.value);
    const absoluteDelta =
      currentValue !== null && baselineValue !== null ? currentValue - baselineValue : null;
    const percentDelta =
      currentValue !== null && baselineValue !== null && baselineValue !== 0
        ? Math.round((((currentValue - baselineValue) / Math.abs(baselineValue)) * 100) * 100) / 100
        : null;

    return {
      ...current,
      baseline_value: baselineValue,
      absolute_delta: absoluteDelta,
      percent_delta: percentDelta,
    };
  });

  const changedCount = comparisonRows.filter((row) => asNumber(row.absolute_delta) !== null && asNumber(row.absolute_delta) !== 0).length;
  const flatCount = comparisonRows.filter((row) => asNumber(row.absolute_delta) === 0).length;
  const exclusions: string[] = [];
  if (currentOnlyKeys.length > 0) {
    exclusions.push(
      `Current run has ${currentOnlyKeys.length} behavioral KPI row${currentOnlyKeys.length === 1 ? "" : "s"} without a baseline match.`
    );
  }
  if (baselineOnlyKeys.length > 0) {
    exclusions.push(
      `Baseline run has ${baselineOnlyKeys.length} behavioral KPI row${baselineOnlyKeys.length === 1 ? "" : "s"} without a current-run match.`
    );
  }

  const blockedReasons: string[] = [];
  if (!currentSource || !baselineSource) {
    blockedReasons.push("missing_behavioral_artifacts");
  }
  if (sourceIsBlocked(currentSource) || sourceIsBlocked(baselineSource)) {
    blockedReasons.push("preflight_or_not_enough_outputs");
  }
  if (!blockedReasons.length && sharedComparableKeys.length === 0) {
    blockedReasons.push("no_shared_behavioral_kpis");
  }

  const partial = !blockedReasons.length && (sourceIsPartial(currentSource) || sourceIsPartial(baselineSource));
  const supportStatus = blockedReasons.length
    ? "behavioral_comparison_blocked"
    : partial
      ? "behavioral_comparison_partial_only"
      : "behavioral_comparison_available";

  const supportMessage = blockedReasons.includes("missing_behavioral_artifacts")
    ? "Behavioral comparison is not supportable from the current managed-run artifacts yet."
    : blockedReasons.includes("preflight_or_not_enough_outputs")
      ? "Behavioral comparison is not supportable yet because one or both runs only reached preflight-only, blocked, or not-enough-output posture."
      : blockedReasons.includes("no_shared_behavioral_kpis")
        ? "Behavioral comparison is not supportable because the two runs do not share any comparable behavioral KPI coverage."
        : partial
          ? "Behavioral comparison is limited to shared partial outputs only. Treat the deltas as prototype artifact differences, not full behavioral parity."
          : "Behavioral comparison reflects only the shared prototype KPI rows discovered on both runs.";

  const caveats = dedupeStrings([
    ...(currentSource?.caveats ?? []),
    ...(baselineSource?.caveats ?? []),
    partial ? "At least one run produced only partial behavioral outputs, so comparison is partial-output only." : null,
    blockedReasons.includes("preflight_or_not_enough_outputs")
      ? "At least one run remains preflight-only, blocked, or otherwise lacks comparison-ready behavioral outputs, so deltas are intentionally withheld."
      : null,
    sharedComparableKeys.length > 0 && (currentOnlyKeys.length > 0 || baselineOnlyKeys.length > 0)
      ? "Only the shared behavioral KPI rows are compared; uncovered rows are excluded instead of being imputed."
      : null,
    "Behavioral-demand comparison remains prototype-only and does not establish calibration quality, behavioral realism, or client-ready forecasting claims.",
  ]);

  return {
    schema_version: "openplan.behavioral_demand_comparison.v0",
    comparison_type: "behavioral_demand_comparison",
    generated_at_utc: new Date().toISOString(),
    current: {
      source_type: currentSource?.sourceType ?? null,
      source_path: currentSource?.sourcePath ?? null,
      runtime_mode: currentSource?.runtimeMode ?? null,
      runtime_status: currentSource?.runtimeStatus ?? null,
      availability_status: currentSource?.availabilityStatus ?? null,
    },
    baseline: {
      source_type: baselineSource?.sourceType ?? null,
      source_path: baselineSource?.sourcePath ?? null,
      runtime_mode: baselineSource?.runtimeMode ?? null,
      runtime_status: baselineSource?.runtimeStatus ?? null,
      availability_status: baselineSource?.availabilityStatus ?? null,
    },
    support: {
      status: supportStatus,
      supportable: blockedReasons.length === 0,
      partial,
      message: supportMessage,
      reason_codes: blockedReasons,
    },
    coverage: {
      current_kpi_keys: currentKeys,
      baseline_kpi_keys: baselineKeys,
      comparable_kpi_keys: sharedComparableKeys,
      current_only_kpi_keys: currentOnlyKeys,
      baseline_only_kpi_keys: baselineOnlyKeys,
      comparable_kpi_count: sharedComparableKeys.length,
      current_only_count: currentOnlyKeys.length,
      baseline_only_count: baselineOnlyKeys.length,
    },
    exclusions,
    caveats,
    comparison: {
      comparable_kpi_count: sharedComparableKeys.length,
      changed_kpi_count: changedCount,
      flat_kpi_count: flatCount,
      rows: blockedReasons.length ? [] : comparisonRows,
    },
  };
}
