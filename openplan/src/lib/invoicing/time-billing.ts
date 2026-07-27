/**
 * Time-to-invoice helpers — pure functions between the time-entry ledger
 * (invoicing_time_entries), the rate tables (invoicing_rate_tables /
 * invoicing_rate_entries), and draft client-invoice line items.
 *
 * Honesty rule this module exists to enforce: a rate is only ever LOOKED UP,
 * never invented. Time whose labor category resolves in no rate table is
 * grouped into rateless drafts with a null amount and an explicit needsRate
 * flag — the invoice composer must demand a manual amount for those.
 *
 * Conventions shared with invoice-records.ts / receivables.ts: record-like
 * tolerant types (snake_case, number|string|null), exported constants, no I/O.
 */

import { parseCurrencyAmount } from "./invoice-records";

export const TIME_BILLING_UNIT_LABEL = "hour";

export type RateEntryLike = {
  labor_category?: string | null;
  hourly_rate?: number | string | null;
};

export type TimeEntryLike = {
  id?: string | null;
  staff_id?: string | null;
  engagement_id?: string | null;
  deliverable_id?: string | null;
  entry_date?: string | null;
  hours?: number | string | null;
  billable?: boolean | null;
  labor_category?: string | null;
  billed_line_item_id?: string | null;
};

export type HourlyRateSource = "engagement_table" | "default_table" | "none";

export type ResolvedHourlyRate = {
  rate: number | null;
  source: HourlyRateSource;
};

export type UnbilledTimeGroupBy = "staff_category" | "deliverable";

export type DraftTimeLineItem = {
  description: string;
  /** Total hours in the group. */
  quantity: number;
  unit_label: typeof TIME_BILLING_UNIT_LABEL;
  /** The uniform hourly rate for the group, or null when none applies uniformly. */
  unit_amount: number | null;
  /** Priced total, or null when the group has no resolvable rate. */
  amount: number | null;
  /** True when the composer must demand a manual amount — a rate is NEVER invented. */
  needsRate: boolean;
  sourceTimeEntryIds: string[];
};

export type GroupUnbilledTimeOptions = {
  by: UnbilledTimeGroupBy;
  /** Rate entries from the engagement's own rate table, tried first. */
  engagementRateEntries?: RateEntryLike[] | null;
  /** Rate entries from the workspace default table, the fallback. */
  defaultRateEntries?: RateEntryLike[] | null;
  /** Optional display names for description building. */
  staffNamesById?: Record<string, string> | null;
  deliverableTitlesById?: Record<string, string> | null;
};

export type UnbilledTimeSummary = {
  hours: number;
  entryCount: number;
  staffCount: number;
  oldestEntryDate: string | null;
};

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCategory(category: string | null | undefined): string | null {
  const trimmed = typeof category === "string" ? category.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function findRate(entries: RateEntryLike[] | null | undefined, category: string): number | null {
  for (const entry of entries ?? []) {
    const entryCategory = normalizeCategory(entry.labor_category);
    if (entryCategory !== null && entryCategory.toLowerCase() === category.toLowerCase()) {
      const rate = parseCurrencyAmount(entry.hourly_rate);
      return rate >= 0 ? rate : null;
    }
  }
  return null;
}

/**
 * Resolve an hourly rate for a labor category: the engagement's own rate
 * table wins over the workspace default table; no match anywhere (or no
 * category at all) is an explicit 'none', never a guessed number.
 */
export function resolveHourlyRate({
  laborCategory,
  engagementRateEntries,
  defaultRateEntries,
}: {
  laborCategory: string | null | undefined;
  engagementRateEntries?: RateEntryLike[] | null;
  defaultRateEntries?: RateEntryLike[] | null;
}): ResolvedHourlyRate {
  const category = normalizeCategory(laborCategory);
  if (category === null) {
    return { rate: null, source: "none" };
  }

  const engagementRate = findRate(engagementRateEntries, category);
  if (engagementRate !== null) {
    return { rate: engagementRate, source: "engagement_table" };
  }

  const defaultRate = findRate(defaultRateEntries, category);
  if (defaultRate !== null) {
    return { rate: defaultRate, source: "default_table" };
  }

  return { rate: null, source: "none" };
}

export function isUnbilledTimeEntry(entry: TimeEntryLike): boolean {
  return entry.billable !== false && !entry.billed_line_item_id;
}

function entryHours(entry: TimeEntryLike): number {
  const hours = parseCurrencyAmount(entry.hours);
  return hours > 0 ? hours : 0;
}

type WorkingGroup = {
  description: string;
  hours: number;
  amount: number;
  rate: number | null;
  rateIsUniform: boolean;
  sourceTimeEntryIds: string[];
};

/**
 * Group unbilled time entries into draft line-item shapes.
 *
 * - by 'staff_category': one group per (staff, labor category) pair — the
 *   classic "Senior Planner, J. Doe — 12.5 hours @ $180" invoice line.
 * - by 'deliverable': one group per deliverable (plus a general group for
 *   time with none), priced per entry from each entry's own category.
 *
 * On either axis, entries whose category resolves NO rate are split into
 * their own rateless drafts (amount null, needsRate true) so a priced group
 * never hides unpriced hours inside it.
 */
export function groupUnbilledTime(
  entries: TimeEntryLike[] | null | undefined,
  options: GroupUnbilledTimeOptions
): DraftTimeLineItem[] {
  const groups = new Map<string, WorkingGroup>();

  for (const entry of entries ?? []) {
    if (!isUnbilledTimeEntry(entry)) {
      continue;
    }

    const hours = entryHours(entry);
    if (hours <= 0) {
      continue;
    }

    const category = normalizeCategory(entry.labor_category);
    const resolved = resolveHourlyRate({
      laborCategory: category,
      engagementRateEntries: options.engagementRateEntries,
      defaultRateEntries: options.defaultRateEntries,
    });
    const rated = resolved.rate !== null;

    let axisKey: string;
    let description: string;

    if (options.by === "staff_category") {
      const staffId = entry.staff_id ?? "unknown";
      const staffName = (entry.staff_id && options.staffNamesById?.[entry.staff_id]) || null;
      axisKey = `staff:${staffId}::${(category ?? "").toLowerCase()}`;
      const categoryLabel = category ?? "Uncategorized time";
      description = staffName ? `${categoryLabel} — ${staffName}` : categoryLabel;
    } else {
      const deliverableId = entry.deliverable_id ?? null;
      axisKey = `deliverable:${deliverableId ?? "none"}`;
      description = deliverableId
        ? options.deliverableTitlesById?.[deliverableId] ?? "Deliverable"
        : "General (no deliverable)";
    }

    // Rateless entries never share a draft with priced ones.
    const key = `${axisKey}::${rated ? "rated" : "rateless"}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        description,
        hours,
        amount: rated ? hours * resolved.rate! : 0,
        rate: resolved.rate,
        rateIsUniform: true,
        sourceTimeEntryIds: entry.id ? [entry.id] : [],
      });
      continue;
    }

    existing.hours += hours;
    if (rated) {
      existing.amount += hours * resolved.rate!;
      if (existing.rate !== resolved.rate) {
        existing.rateIsUniform = false;
      }
    }
    if (entry.id) {
      existing.sourceTimeEntryIds.push(entry.id);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const rated = group.rate !== null;
    return {
      description: group.description,
      quantity: roundHours(group.hours),
      unit_label: TIME_BILLING_UNIT_LABEL,
      unit_amount: rated && group.rateIsUniform ? group.rate : null,
      amount: rated ? roundCurrency(group.amount) : null,
      needsRate: !rated,
      sourceTimeEntryIds: group.sourceTimeEntryIds,
    };
  });
}

export function summarizeUnbilledTime(entries: TimeEntryLike[] | null | undefined): UnbilledTimeSummary {
  let hours = 0;
  let entryCount = 0;
  const staffIds = new Set<string>();
  let oldestEntryDate: string | null = null;
  let oldestEntryMs = Number.POSITIVE_INFINITY;

  for (const entry of entries ?? []) {
    if (!isUnbilledTimeEntry(entry)) {
      continue;
    }

    const entryHoursValue = entryHours(entry);
    if (entryHoursValue <= 0) {
      continue;
    }

    hours += entryHoursValue;
    entryCount += 1;
    if (entry.staff_id) {
      staffIds.add(entry.staff_id);
    }

    if (entry.entry_date) {
      const ms = new Date(entry.entry_date).getTime();
      if (!Number.isNaN(ms) && ms < oldestEntryMs) {
        oldestEntryMs = ms;
        oldestEntryDate = entry.entry_date;
      }
    }
  }

  return {
    hours: roundHours(hours),
    entryCount,
    staffCount: staffIds.size,
    oldestEntryDate,
  };
}
