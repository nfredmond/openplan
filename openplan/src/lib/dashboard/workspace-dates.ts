import { addDays, calendarDate, type ComingUpItem, type ComingUpKind } from "@/lib/dashboard/coming-up";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
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

async function boundedRead(
  query: DatedRead,
  column: string,
  bounds: { from: string; before?: string; until?: string }
): Promise<ReadOutcome> {
  try {
    let bounded = query.gte(column, bounds.from);
    if (bounds.before) bounded = bounded.lt(column, bounds.before);
    if (bounds.until) bounded = bounded.lte(column, `${bounds.until}T23:59:59Z`);
    const result = await bounded.order(column, { ascending: true }).limit(WORKSPACE_DATES_CAP);
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
  fallbackTitle: string;
  href: (id: string) => string;
  query: () => DatedRead;
};

export async function loadWorkspaceDates(
  supabase: WorkspaceDatesSupabaseLike,
  workspaceId: string,
  from: string,
  until: string,
  now: Date
): Promise<WorkspaceDatesResult> {
  const openCycles = ["draft", "public_review"] as const;
  const sources: DateSource[] = [
    {
      label: "RTP public review dates",
      kind: "public-review",
      keyPrefix: "rtp-review",
      column: "public_review_close_at",
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
        boundedRead(source.query(), source.column, { from, until }),
        boundedRead(source.query(), source.column, { from: missedFrom, before: from }),
      ]);
      return { source, ahead, missed };
    })
  );

  const toItems = (source: DateSource, rows: readonly Row[]): ComingUpItem[] =>
    rows.flatMap((row) => {
      const value = text(row[source.column]);
      const dueOn = calendarDate(value);
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
