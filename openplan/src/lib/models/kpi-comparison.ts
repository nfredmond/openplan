export type ModelRunKpiComparisonItem = {
  key: string;
  category: string;
  name: string;
  label: string;
  unit: string | null;
  geometryRef: string | null;
  currentValue: number | null;
  baselineValue: number | null;
  absoluteDelta: number | null;
  percentDelta: number | null;
  changed: boolean;
};

export type ModelRunKpiComparisonCategory = {
  category: string;
  totalCount: number;
  comparableCount: number;
  changedCount: number;
  topChanges: ModelRunKpiComparisonItem[];
};

export type ModelRunKpiComparisonSummary = {
  totalCount: number;
  comparableCount: number;
  changedCount: number;
  flatCount: number;
  missingBaselineCount: number;
  categories: ModelRunKpiComparisonCategory[];
  highlights: ModelRunKpiComparisonItem[];
  largestChange: ModelRunKpiComparisonItem | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function comparisonSortValue(item: ModelRunKpiComparisonItem) {
  if (item.percentDelta !== null) {
    return Math.abs(item.percentDelta);
  }

  if (item.absoluteDelta !== null) {
    return Math.abs(item.absoluteDelta);
  }

  return -1;
}

function compareItems(a: ModelRunKpiComparisonItem, b: ModelRunKpiComparisonItem) {
  return (
    comparisonSortValue(b) - comparisonSortValue(a) ||
    a.category.localeCompare(b.category) ||
    a.label.localeCompare(b.label)
  );
}

export function normalizeModelRunKpiComparisonItems(rows: Array<Record<string, unknown>>): ModelRunKpiComparisonItem[] {
  return rows.map((row, index) => {
    const name = asString(row.kpi_name) ?? `kpi-${index + 1}`;
    const geometryRef = asString(row.geometry_ref);
    const absoluteDelta = asNumber(row.absolute_delta);

    return {
      key: `${name}::${geometryRef ?? ""}`,
      category: asString(row.kpi_category) ?? "general",
      name,
      label: asString(row.kpi_label) ?? name,
      unit: asString(row.unit),
      geometryRef,
      currentValue: asNumber(row.value),
      baselineValue: asNumber(row.baseline_value),
      absoluteDelta,
      percentDelta: asNumber(row.percent_delta),
      changed: absoluteDelta !== null && absoluteDelta !== 0,
    } satisfies ModelRunKpiComparisonItem;
  });
}

export function buildModelRunKpiComparisonSummary(rows: Array<Record<string, unknown>>): ModelRunKpiComparisonSummary {
  const items = normalizeModelRunKpiComparisonItems(rows);
  const changedItems = items.filter((item) => item.changed).sort(compareItems);
  const flatCount = items.filter((item) => item.absoluteDelta === 0).length;
  const comparableCount = items.filter((item) => item.absoluteDelta !== null).length;
  const missingBaselineCount = items.filter((item) => item.baselineValue === null).length;

  const categoryMap = new Map<string, ModelRunKpiComparisonItem[]>();
  for (const item of items) {
    const existing = categoryMap.get(item.category) ?? [];
    existing.push(item);
    categoryMap.set(item.category, existing);
  }

  const categories = Array.from(categoryMap.entries())
    .map(([category, categoryItems]) => {
      const sorted = [...categoryItems].sort(compareItems);
      return {
        category,
        totalCount: categoryItems.length,
        comparableCount: categoryItems.filter((item) => item.absoluteDelta !== null).length,
        changedCount: categoryItems.filter((item) => item.changed).length,
        topChanges: sorted.filter((item) => item.changed).slice(0, 3),
      } satisfies ModelRunKpiComparisonCategory;
    })
    .sort((a, b) => b.changedCount - a.changedCount || b.comparableCount - a.comparableCount || a.category.localeCompare(b.category));

  return {
    totalCount: items.length,
    comparableCount,
    changedCount: changedItems.length,
    flatCount,
    missingBaselineCount,
    categories,
    highlights: changedItems.slice(0, 4),
    largestChange: changedItems[0] ?? null,
  } satisfies ModelRunKpiComparisonSummary;
}

export function formatModelRunKpiValue(value: number | null, unit?: string | null) {
  if (value === null) {
    return "N/A";
  }

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);

  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatModelRunKpiDelta(delta: number | null, unit?: string | null) {
  if (delta === null) {
    return "N/A";
  }

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(delta) >= 100 ? 0 : 2,
    signDisplay: "always",
  }).format(delta);

  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatModelRunKpiPercentDelta(delta: number | null) {
  if (delta === null) {
    return null;
  }

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(delta) >= 100 ? 0 : 2,
    signDisplay: "always",
  }).format(delta);

  return `${formatted}%`;
}
