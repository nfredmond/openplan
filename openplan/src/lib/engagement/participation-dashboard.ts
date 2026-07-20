/**
 * E3 — pure shaping helpers for the participation dashboard. The heavy stats
 * already live in `summary.ts` (counts) and `hotspots.ts` (spatial clusters);
 * this only adds the intake time-series the dashboard renders as a sparkline.
 * Pure/deterministic so the buckets are unit-testable.
 */

export type DailyIntakeBucket = { date: string; count: number };

export type IntakeTrend = {
  buckets: DailyIntakeBucket[];
  total: number;
  peak: number;
  windowDays: number;
};

type IntakeItemLike = { created_at?: string | null; updated_at?: string | null };

function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Bucket items into per-day counts over the trailing `days` window (default 21),
 * keyed on `created_at ?? updated_at`. Days with no intake are present with a
 * zero count so the sparkline has an even x-axis. `now` is injectable for tests.
 */
export function buildDailyIntake(items: IntakeItemLike[], options?: { days?: number; now?: Date }): IntakeTrend {
  const windowDays = Math.max(1, options?.days ?? 21);
  const now = options?.now ?? new Date();

  // The window is the last `windowDays` UTC days, ending today (inclusive).
  const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const buckets: DailyIntakeBucket[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const day = new Date(endMs - i * 86_400_000);
    const key = toUtcDateKey(day);
    indexByDate.set(key, buckets.length);
    buckets.push({ date: key, count: 0 });
  }

  let total = 0;
  for (const item of items) {
    const raw = item.created_at ?? item.updated_at;
    if (!raw) continue;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = toUtcDateKey(parsed);
    const idx = indexByDate.get(key);
    if (idx === undefined) continue; // outside the window
    buckets[idx].count += 1;
    total += 1;
  }

  const peak = buckets.reduce((max, b) => Math.max(max, b.count), 0);
  return { buckets, total, peak, windowDays };
}
