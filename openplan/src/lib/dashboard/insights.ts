/**
 * The figures behind the dashboard's Insights view.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. Everything here is derived from rows the
 * dashboard already loads — it issues no query of its own. Keeping the
 * derivation out of the component means the rules below can be tested against
 * real shapes rather than asserted about pixels.
 *
 * THE RULE THAT SHAPES ALL OF IT: A FIGURE THAT CANNOT BE DRAWN SAYS WHY.
 * A trend line through one point is not a trend, and a bar chart of zeros looks
 * like a measurement of zero rather than an absence of measurements. Every
 * series therefore resolves to either `points` or a `blockedReason` naming what
 * would produce it. The Insights view renders the reason; it never renders an
 * empty axis and lets the reader supply the conclusion.
 */

export type InsightPoint = {
  /** X label, already formatted for the axis. */
  label: string;
  value: number;
  /** Long-form label for the tooltip and the table view. */
  detail?: string;
  /**
   * The whole this point is a part of — only the meter form reads it (money
   * authorised, against which money drawn is the fill). Absent everywhere else.
   */
  reference?: number;
  /** Rendered instead of the raw number in the table, when the unit needs one (money). */
  formattedValue?: string;
};

/**
 * WHY A KIND AND NOT JUST A SENTENCE.
 *
 * "There is nothing to plot yet" and "we asked the database and it would not
 * answer" are opposite facts, and a reader who cannot tell them apart will
 * treat the second as the first — which is exactly how a broken read becomes a
 * confident zero. The sentence differs, and so does the way the figure is
 * drawn: `unreadable` is a warning, everything else is information.
 *
 *  - `empty`        — the read succeeded and there are no rows yet.
 *  - `insufficient` — there are rows, but not enough to make this shape honest
 *                     (two points is not a trend).
 *  - `unreadable`   — the read failed. Nothing here is a measurement.
 *  - `pending`      — the read failed because this deployment is behind a
 *                     migration. A named operator move fixes it.
 *  - `truncated`    — more rows exist than were read, so any total drawn from
 *                     them would be an undercount presented as a count.
 *  - `impossible`   — the read succeeded and handed back a value that cannot
 *                     exist (a negative count of queued work). Something
 *                     upstream is counting wrong, and clamping it to zero would
 *                     render that bug as "nothing is queued".
 */
export type InsightBlockedKind =
  | "empty"
  | "insufficient"
  | "unreadable"
  | "pending"
  | "truncated"
  | "impossible";

export type InsightSeries = {
  points: InsightPoint[];
  /** Null when the series can be drawn. Otherwise the sentence to show instead. */
  blockedReason: string | null;
  /** Null exactly when `blockedReason` is null. */
  blockedKind: InsightBlockedKind | null;
  /** Largest value, for axis scaling. Zero when blocked. */
  max: number;
  /**
   * A caveat that travels WITH a drawable series — rows the figure could not
   * include and why. It is not a blocking reason: the figure is honest, but
   * incomplete in a way the reader has to know about.
   */
  footnote?: string;
};

/**
 * WHAT ONE CAPPED READ CAME BACK WITH — the shape every figure in this module
 * is built from, and the reason none of them can draw a failure as a zero.
 *
 * IT LIVES HERE, NOT IN `chart-reads.ts`, because the rule belongs to the
 * FIGURES. `chart-reads.ts` only knows how to ask a database; this file is
 * where "rows plus why there might be none" is turned into either a drawing or
 * a sentence. Every builder below takes one of these rather than a bare array —
 * an array cannot say whether it is empty because nothing happened or because
 * the query fell over, and that distinction is the whole honesty argument.
 *
 * `pending` distinguishes "this deployment is behind a migration" from "the
 * read failed": the first has a named operator move and the second does not.
 */
export type ChartReadOutcome<Row> = {
  rows: readonly Row[];
  failed: boolean;
  pending: boolean;
  /** True when the read returned exactly its cap, so more rows exist behind it. */
  truncated: boolean;
};

/**
 * A blocking reason for a read that did not answer. Kept in ONE place so no two
 * figures can drift into wording a failed read differently — a planner who
 * learns what "could not be read" looks like on one figure must recognise it on
 * every other.
 */
export function blockedRead<Row>(
  outcome: ChartReadOutcome<Row>,
  subject: string
): InsightSeries | null {
  if (outcome.pending) {
    return blocked(
      `This deployment has not applied the migration that creates the ${subject} table, so there is nothing to read yet. Applying the pending migrations turns this figure on.`,
      "pending"
    );
  }
  if (outcome.failed) {
    return blocked(
      `The ${subject} could not be read, so nothing is drawn here. This is a failed query, not an empty workspace — do not read it as zero. Reload, and tell whoever runs this deployment if it keeps happening.`,
      "unreadable"
    );
  }
  if (outcome.truncated) {
    return blocked(
      `There are more ${subject} in this workspace than this figure reads in one go, so any total drawn here would be short. It is left blank rather than shown low.`,
      "truncated"
    );
  }
  return null;
}

export type DashboardRunRow = {
  created_at?: string | null;
  metrics?: unknown;
  summary_text?: string | null;
  report_generated_count?: number | null;
};

export type DashboardLaneCount = {
  label: string;
  value: number;
  /** What the number counts, shown in the tooltip and the table. */
  detail: string;
};

/** A trend needs at least two observations. One point is a reading, not a trend. */
const MIN_TREND_POINTS = 2;

export function blocked(reason: string, kind: InsightBlockedKind): InsightSeries {
  return { points: [], blockedReason: reason, blockedKind: kind, max: 0 };
}

export function series(points: InsightPoint[], footnote?: string): InsightSeries {
  return {
    points,
    blockedReason: null,
    blockedKind: null,
    max: points.reduce(
      (highest, point) => Math.max(highest, point.value, point.reference ?? 0),
      0
    ),
    ...(footnote ? { footnote } : {}),
  };
}

function readOverallScore(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== "object") return null;
  const value = (metrics as { overallScore?: unknown }).overallScore;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function monthKey(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  // Four-digit year: "Aug 26" reads as the 26th of August, which is the one
  // thing an axis label on a MONTHLY series must not look like.
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Analysis runs per calendar month.
 *
 * Months with no runs are filled with zero rather than skipped: a gap drawn as a
 * straight line between two distant months invents activity that did not happen,
 * which is the charting version of the caveat this product keeps elsewhere.
 *
 * IT TAKES THE READ'S OUTCOME, NOT ITS ROWS, and that is not a refactor. This
 * figure used to be handed `runsResult.data ?? []` — so a workspace whose runs
 * query FAILED was drawn a flat line at zero, identical in every pixel to a
 * workspace that had genuinely never run anything. A shape is more persuasive
 * than a number, and that is the most damaging thing a chart can do.
 */
export function runsPerMonth(read: ChartReadOutcome<DashboardRunRow>): InsightSeries {
  const readBlock = blockedRead(read, "analysis runs");
  if (readBlock) return readBlock;

  const runs = read.rows;
  const dated = runs
    .map((run) => (typeof run.created_at === "string" ? monthKey(run.created_at) : null))
    .filter((key): key is string => key !== null);

  if (dated.length === 0) {
    return blocked("No analysis runs are recorded yet, so there is no history to plot.", "empty");
  }

  const counts = new Map<string, number>();
  for (const key of dated) counts.set(key, (counts.get(key) ?? 0) + 1);

  const keys = [...counts.keys()].sort();
  const [firstYear, firstMonth] = keys[0].split("-").map(Number);
  const [lastYear, lastMonth] = keys[keys.length - 1].split("-").map(Number);

  const filled: InsightPoint[] = [];
  for (let year = firstYear, month = firstMonth; year < lastYear || (year === lastYear && month <= lastMonth); ) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const value = counts.get(key) ?? 0;
    filled.push({
      label: monthLabel(key),
      value,
      detail: `${value} run${value === 1 ? "" : "s"} in ${monthLabel(key)}`,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  if (filled.length < MIN_TREND_POINTS) {
    const only = filled[0];
    return blocked(
      `All ${only.value} run${only.value === 1 ? "" : "s"} so far fall in ${only.label}. ` +
        "A trend needs runs in at least two months.",
      "insufficient"
    );
  }

  return series(filled);
}

/**
 * Composite score of the most recent runs, newest last.
 *
 * Runs whose composite is absent are DROPPED rather than plotted as zero — a
 * zero bar reads as "this corridor scored nothing", which is a finding, and the
 * absence of a score is not one.
 *
 * Same rule as `runsPerMonth` for the read itself: a failed query blocks the
 * figure rather than emptying it.
 */
export function recentOverallScores(
  read: ChartReadOutcome<DashboardRunRow>,
  limit = 12
): InsightSeries {
  const readBlock = blockedRead(read, "analysis runs");
  if (readBlock) return readBlock;

  const runs = read.rows;
  const scored = runs
    .map((run, index): InsightPoint | null => {
      const score = readOverallScore(run.metrics);
      if (score === null) return null;
      const when =
        typeof run.created_at === "string" && !Number.isNaN(new Date(run.created_at).getTime())
          ? new Date(run.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : `Run ${index + 1}`;
      return { label: when, value: score, detail: `Composite ${score}/100 · ${when}` };
    })
    .filter((point): point is InsightPoint => point !== null);

  if (scored.length === 0) {
    return blocked(
      "No run has recorded a composite score yet. Scores appear once an analysis run completes.",
      "empty"
    );
  }

  return series(scored.slice(-limit));
}

/**
 * Where the workspace's attention is being asked for, by lane.
 *
 * Lanes with nothing outstanding are kept at zero on purpose: here the zero IS
 * the measurement — "nothing queued in Grants" is a real, useful reading — and
 * dropping empty lanes would make the chart's shape depend on which lanes
 * happened to be busy.
 *
 * THE CLAMP IS GONE, AND DELETING IT IS THE POINT (2026-08-13). This function
 * used to write `Math.max(0, lane.value)`. A lane count is the size of a queue,
 * so a negative one is not a small error to tidy up — it cannot happen, and its
 * appearance means something upstream is counting wrong. Clamping it produced
 * all-zero lanes, which fell straight into the branch below and told the planner
 * "Every lane is clear — nothing is queued", turning a counting bug into a
 * reassuring sentence. That is precisely the failure this module exists to
 * refuse, so an impossible value now blocks the figure and says what it saw.
 * Non-finite values (a NaN from a subtraction of two missing counts) go the same
 * way, for the same reason.
 */
export function lanePressure(lanes: readonly DashboardLaneCount[]): InsightSeries {
  if (lanes.length === 0) {
    return blocked("No workspace lanes reported a queue, so there is nothing to compare.", "empty");
  }

  const impossible = lanes.filter((lane) => !Number.isFinite(lane.value) || lane.value < 0);
  if (impossible.length > 0) {
    const named = impossible.map((lane) => `${lane.label} (${lane.value})`).join(", ");
    return blocked(
      `${named} reported a count that cannot exist — a queue cannot hold fewer than nothing. Something upstream is counting wrong, so nothing is drawn here. This is a fault, not an empty queue: do not read it as "no open work".`,
      "impossible"
    );
  }

  const points = lanes.map((lane) => ({
    label: lane.label,
    value: lane.value,
    detail: lane.detail,
  }));

  if (points.every((point) => point.value === 0)) {
    return blocked(
      "Every lane is clear — nothing is queued in RTP, grants, engagement, modeling or aerial right now.",
      "empty"
    );
  }

  return series(points);
}

/** Reports generated across all runs — a single headline, not a chart. */
export function reportsGenerated(runs: readonly DashboardRunRow[]): number {
  return runs.reduce((total, run) => total + Math.max(0, run.report_generated_count ?? 0), 0);
}

/** Median composite score, or null when nothing has scored. Median, not mean: one screening outlier should not move the headline. */
export function medianOverallScore(runs: readonly DashboardRunRow[]): number | null {
  const scores = runs
    .map((run) => readOverallScore(run.metrics))
    .filter((score): score is number => score !== null)
    .sort((a, b) => a - b);

  if (scores.length === 0) return null;
  const middle = Math.floor(scores.length / 2);
  return scores.length % 2 === 0
    ? Math.round((scores[middle - 1] + scores[middle]) / 2)
    : scores[middle];
}
