import { addDays, type ComingUpItem, type ComingUpKind } from "@/lib/dashboard/coming-up";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { calendarDayOf, instantFromWallClock } from "@/lib/time/workspace-calendar";
import { isDeadlinePast } from "@/lib/work/deadlines";

/**
 * Dates My Work does not carry: when an RTP cycle's public review closes, when
 * its adoption is targeted, and when a public comment period ends. A small
 * agency's calendar is built on these, so Coming up reads them directly.
 *
 * Each date is read twice, like My Work: the window ahead, and the dates
 * already missed by a cycle or campaign that is still open. A missed date is
 * the one a "what is due" view most needs to show. The missed read looks back
 * a year, so a stale draft cycle does not fill the list with old history.
 *
 * Each read is capped; a capped or failed read is reported by label so the
 * dashboard can say so instead of showing a quiet calendar.
 *
 * Days are the workspace's. The adoption target is a DATE and is used as it
 * is. A review close and a comment period end are TIMESTAMPTZ: each is shown
 * on its day in the workspace's zone, and the window's day bounds become that
 * zone's midnights, so a period ending at 8 p.m. Pacific on the 14th (03:00
 * UTC on the 15th) is due on the 14th and is read in the window that holds
 * the 14th.
 */

type DatedRead = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  eq(column: string, value: string): DatedRead;
  in(column: string, values: readonly string[]): DatedRead;
  gte(column: string, value: string): DatedRead;
  lt(column: string, value: string): DatedRead;
  lte(column: string, value: string): DatedRead;
  order(column: string, options: { ascending: boolean }): DatedRead;
  limit(count: number): DatedRead;
};

export type WorkspaceDatesSupabaseLike = {
  from(table: string): { select(columns: string): DatedRead };
};

export type WorkspaceDatesResult = {
  /** Dates from `from` through `until`, soonest first once sorted. */
  items: ComingUpItem[];
  /** Dates before `from` on records still open, within the lookback. */
  missed: ComingUpItem[];
  failed: string[];
  capped: string[];
};

const WORKSPACE_DATES_CAP = 10;

/** How far back the missed-date read looks. */
export const MISSED_DATES_LOOKBACK_DAYS = 365;

type Row = Record<string, unknown>;
type ReadOutcome = { rows: Row[]; failed: boolean; capped: boolean };

/**
 * Calendar-day bounds as a column compares them. A DATE column takes the day
 * itself. A TIMESTAMPTZ column takes the instant the day starts in the zone;
 * a zone `Intl` rejects falls back to the day, which Postgres reads as UTC
 * midnight, the bound used before zones existed.
 */
function dayStart(day: string, instant: boolean, timeZone: string): string {
  return instant ? (instantFromWallClock(`${day}T00:00`, timeZone) ?? day) : day;
}

async function boundedRead(
  query: DatedRead,
  column: string,
  bounds: { from: string; before?: string; until?: string },
  instant: boolean,
  timeZone: string,
  ascending = true
): Promise<ReadOutcome> {
  try {
    let bounded = query.gte(column, dayStart(bounds.from, instant, timeZone));
    if (bounds.before) bounded = bounded.lt(column, dayStart(bounds.before, instant, timeZone));
    // Through the end of `until`: before the next day starts.
    if (bounds.until) bounded = bounded.lt(column, dayStart(addDays(bounds.until, 1), instant, timeZone));
    const result = await bounded.order(column, { ascending }).limit(WORKSPACE_DATES_CAP);
    // A deployment behind the migration simply has no such dates yet.
    if (result.error && looksLikePendingSchema(result.error.message)) {
      return { rows: [], failed: false, capped: false };
    }
    if (result.error) return { rows: [], failed: true, capped: false };
    const rows = (result.data ?? []) as Row[];
    return { rows, failed: false, capped: rows.length >= WORKSPACE_DATES_CAP };
  } catch {
    return { rows: [], failed: true, capped: false };
  }
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

type DateSource = {
  label: string;
  kind: ComingUpKind;
  keyPrefix: string;
  column: string;
  /** TIMESTAMPTZ rather than DATE: placed on the workspace's calendar. */
  instant: boolean;
  fallbackTitle: string;
  href: (id: string) => string;
  query: () => DatedRead;
};

export async function loadWorkspaceDates(
  supabase: WorkspaceDatesSupabaseLike,
  workspaceId: string,
  from: string,
  until: string,
  now: Date,
  timeZone: string
): Promise<WorkspaceDatesResult> {
  const openCycles = ["draft", "public_review"] as const;
  const sources: DateSource[] = [
    {
      label: "RTP public review dates",
      kind: "public-review",
      keyPrefix: "rtp-review",
      column: "public_review_close_at",
      instant: true,
      fallbackTitle: "RTP cycle",
      href: (id) => `/rtp/${id}`,
      query: () =>
        supabase
          .from("rtp_cycles")
          .select("id, title, public_review_close_at")
          .eq("workspace_id", workspaceId)
          .in("status", openCycles),
    },
    {
      label: "RTP adoption targets",
      kind: "adoption",
      keyPrefix: "rtp-adoption",
      column: "adoption_target_date",
      instant: false,
      fallbackTitle: "RTP cycle",
      href: (id) => `/rtp/${id}`,
      query: () =>
        supabase
          .from("rtp_cycles")
          .select("id, title, adoption_target_date")
          .eq("workspace_id", workspaceId)
          .in("status", openCycles),
    },
    {
      label: "comment periods",
      kind: "comment-period",
      keyPrefix: "comment-period",
      column: "participation_ends_at",
      instant: true,
      fallbackTitle: "Engagement campaign",
      href: (id) => `/engagement/${id}`,
      query: () =>
        supabase
          .from("engagement_campaigns")
          .select("id, title, participation_ends_at")
          .eq("workspace_id", workspaceId)
          .eq("status", "active"),
    },
  ];

  const missedFrom = addDays(from, -MISSED_DATES_LOOKBACK_DAYS);
  const reads = await Promise.all(
    sources.map(async (source) => {
      const [ahead, missed] = await Promise.all([
        boundedRead(source.query(), source.column, { from, until }, source.instant, timeZone),
        // Most recent first, so the cap drops the oldest misses, not the latest.
        boundedRead(source.query(), source.column, { from: missedFrom, before: from }, source.instant, timeZone, false),
      ]);
      return { source, ahead, missed };
    })
  );

  const toItems = (source: DateSource, rows: readonly Row[]): ComingUpItem[] =>
    rows.flatMap((row) => {
      const value = text(row[source.column]);
      const dueOn = calendarDayOf(value, timeZone);
      if (!dueOn) return [];
      const id = String(row.id);
      return [
        {
          key: `${source.keyPrefix}:${id}`,
          kind: source.kind,
          title: text(row.title) ?? source.fallbackTitle,
          dueOn,
          href: source.href(id),
          projectName: null,
          overdue: isDeadlinePast(value, now),
        },
      ];
    });

  return {
    items: reads.flatMap(({ source, ahead }) => toItems(source, ahead.rows)),
    missed: reads.flatMap(({ source, missed }) => toItems(source, missed.rows)),
    failed: reads.filter(({ ahead, missed }) => ahead.failed || missed.failed).map(({ source }) => source.label),
    capped: reads.filter(({ ahead, missed }) => ahead.capped || missed.capped).map(({ source }) => source.label),
  };
}
