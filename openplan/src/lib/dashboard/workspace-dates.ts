import { calendarDate, type ComingUpItem } from "@/lib/dashboard/coming-up";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

/**
 * Dates My Work does not carry: when an RTP cycle's public review closes, when
 * its adoption is targeted, and when a public comment period ends. A small
 * agency's calendar is built on these, so Coming up reads them directly.
 *
 * Each read is bounded to the window and capped; a capped or failed read is
 * reported by label so the dashboard can say so instead of showing a quiet
 * calendar.
 */

type DatedRead = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  eq(column: string, value: string): DatedRead;
  in(column: string, values: readonly string[]): DatedRead;
  gte(column: string, value: string): DatedRead;
  lte(column: string, value: string): DatedRead;
  order(column: string, options: { ascending: boolean }): DatedRead;
  limit(count: number): DatedRead;
};

export type WorkspaceDatesSupabaseLike = {
  from(table: string): { select(columns: string): DatedRead };
};

export type WorkspaceDatesResult = {
  items: ComingUpItem[];
  failed: string[];
  capped: string[];
};

const WORKSPACE_DATES_CAP = 10;

type Row = Record<string, unknown>;

async function boundedRead(
  query: DatedRead,
  column: string,
  from: string,
  until: string
): Promise<{ rows: Row[]; failed: boolean; capped: boolean }> {
  try {
    const result = await query
      .gte(column, from)
      .lte(column, `${until}T23:59:59Z`)
      .order(column, { ascending: true })
      .limit(WORKSPACE_DATES_CAP);
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

export async function loadWorkspaceDates(
  supabase: WorkspaceDatesSupabaseLike,
  workspaceId: string,
  from: string,
  until: string
): Promise<WorkspaceDatesResult> {
  const openCycles = ["draft", "public_review"] as const;
  const [reviews, adoptions, comments] = await Promise.all([
    boundedRead(
      supabase
        .from("rtp_cycles")
        .select("id, title, public_review_close_at")
        .eq("workspace_id", workspaceId)
        .in("status", openCycles),
      "public_review_close_at",
      from,
      until
    ),
    boundedRead(
      supabase
        .from("rtp_cycles")
        .select("id, title, adoption_target_date")
        .eq("workspace_id", workspaceId)
        .in("status", openCycles),
      "adoption_target_date",
      from,
      until
    ),
    boundedRead(
      supabase
        .from("engagement_campaigns")
        .select("id, title, participation_ends_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      "participation_ends_at",
      from,
      until
    ),
  ]);

  const items: ComingUpItem[] = [];
  for (const row of reviews.rows) {
    const dueOn = calendarDate(text(row.public_review_close_at));
    if (!dueOn) continue;
    items.push({
      key: `rtp-review:${String(row.id)}`,
      kind: "public-review",
      title: text(row.title) ?? "RTP cycle",
      dueOn,
      href: `/rtp/${String(row.id)}`,
      projectName: null,
      overdue: false,
    });
  }
  for (const row of adoptions.rows) {
    const dueOn = calendarDate(text(row.adoption_target_date));
    if (!dueOn) continue;
    items.push({
      key: `rtp-adoption:${String(row.id)}`,
      kind: "adoption",
      title: text(row.title) ?? "RTP cycle",
      dueOn,
      href: `/rtp/${String(row.id)}`,
      projectName: null,
      overdue: false,
    });
  }
  for (const row of comments.rows) {
    const dueOn = calendarDate(text(row.participation_ends_at));
    if (!dueOn) continue;
    items.push({
      key: `comment-period:${String(row.id)}`,
      kind: "comment-period",
      title: text(row.title) ?? "Engagement campaign",
      dueOn,
      href: `/engagement/${String(row.id)}`,
      projectName: null,
      overdue: false,
    });
  }

  const labelled = [
    ["RTP public review dates", reviews],
    ["RTP adoption targets", adoptions],
    ["comment periods", comments],
  ] as const;

  return {
    items,
    failed: labelled.filter(([, read]) => read.failed).map(([label]) => label),
    capped: labelled.filter(([, read]) => read.capped).map(([label]) => label),
  };
}
