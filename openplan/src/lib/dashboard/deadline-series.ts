import type { InsightSeries } from "@/lib/dashboard/insights";

/**
 * "Deadlines by month" as a chart series. It counts the same dated items the
 * Coming up rail lists, so the chart and the list cannot disagree.
 *
 * A failed source blocks the chart, because a month drawn short of a source
 * reads as a quiet month. A capped source draws the chart with a footnote,
 * because every bar is then a floor, not a count.
 */
export function deadlinesByMonthSeries(
  buckets: ReadonlyArray<{ month: string; label: string; count: number }>,
  failed: boolean,
  capped: boolean
): InsightSeries {
  if (failed) {
    return {
      points: [],
      blockedReason: "Some deadline sources could not be read, so a monthly count would undercount.",
      blockedKind: "unreadable",
      max: 0,
    };
  }
  if (buckets.every((bucket) => bucket.count === 0)) {
    return {
      points: [],
      blockedReason: "Nothing is due in the next three months.",
      blockedKind: "empty",
      max: 0,
    };
  }
  const points = buckets.map((bucket) => ({
    label: bucket.label,
    value: bucket.count,
    detail: `${bucket.count} due in ${bucket.label}`,
  }));
  return {
    points,
    blockedReason: null,
    blockedKind: null,
    max: Math.max(...points.map((point) => point.value)),
    footnote: capped ? "At least this many: some sources returned more items than were read." : undefined,
  };
}
