/**
 * WHICH FIGURES EXIST, AND WHICH ONES THIS PERSON WANTS TO SEE.
 *
 * WHY THE PERSON PICKS. Nathaniel's call (2026-08-13): guessing which number a
 * planner watches is exactly the kind of guess this product keeps getting
 * wrong. A grants administrator wants drawdown; an engagement lead wants
 * comments arriving; a modeller wants runs. So the catalog is fixed and small,
 * and the SELECTION is theirs.
 *
 * FIVE FIGURES, NO MORE. A dashboard that shows everything shows nothing. Each
 * entry below answers a question a planner actually asks out loud, and every
 * one of them is drawn from rows this workspace really has — there is no
 * placeholder and no sample data anywhere in this module.
 *
 * THE DEFAULT IS ALL FIVE, NEVER A BLANK SLATE. A first-time reader should see
 * what the dashboard can do before being asked to choose; a figure with nothing
 * behind it says so in one line rather than drawing an empty axis, so five
 * "nothing here yet" sentences is an honest and short first run. Trimming is
 * the point of the picker, not the price of entry.
 */

/**
 * ALSO THE DISPLAY ORDER. The three half-width figures come first so they pair
 * up cleanly in a two-column grid, and the two full-width lists follow.
 */
export const DASHBOARD_CHART_IDS = [
  "runs-per-month",
  "comments-received",
  "composite-scores",
  "award-drawdown",
  "open-work",
] as const;

export type DashboardChartId = (typeof DASHBOARD_CHART_IDS)[number];

/** How the figure is drawn. The form follows the data's job, not the author's mood. */
export type DashboardChartForm = "area" | "bars" | "rows" | "meter";

export type DashboardChartDescriptor = {
  id: DashboardChartId;
  /** The figure's own heading. */
  title: string;
  /** The question it answers, in the picker. Short, plain, no jargon. */
  question: string;
  /** The caveat-carrying sentence under the heading. */
  caption: string;
  form: DashboardChartForm;
  /** Column heading for the number in the table view. */
  valueLabel: string;
  /**
   * Whether the figure takes the full width. The two time series sit side by
   * side; a list of named things needs the width for its labels.
   */
  fullWidth: boolean;
};

export const DASHBOARD_CHARTS: readonly DashboardChartDescriptor[] = [
  {
    id: "runs-per-month",
    title: "Analysis runs per month",
    question: "How much analysis are we doing?",
    caption: "Every corridor run recorded in this workspace, by the month it was launched.",
    form: "area",
    valueLabel: "Runs",
    fullWidth: false,
  },
  {
    id: "comments-received",
    title: "Comments coming in",
    question: "Is the public actually responding?",
    caption:
      "A running total of comments across this workspace's campaigns, week by week. Hover a point to see how many arrived that week — a flat stretch means a quiet week, not a missing one.",
    form: "area",
    valueLabel: "Comments so far",
    fullWidth: false,
  },
  {
    id: "composite-scores",
    title: "Composite score by run",
    question: "How are our corridors scoring?",
    caption:
      "Screening-grade composite for each scored run, oldest first. Not a forecast, and not comparable across different study areas.",
    form: "bars",
    valueLabel: "Composite",
    fullWidth: false,
  },
  {
    id: "award-drawdown",
    title: "Money drawn against money awarded",
    question: "How much of each award have we actually claimed?",
    caption:
      "For each award, the bar is what has been invoiced to the funder — submitted, approved for payment, or paid — inside what the award authorised. Money still sitting in a draft invoice is not counted.",
    form: "meter",
    valueLabel: "Drawn",
    fullWidth: true,
  },
  {
    id: "open-work",
    title: "Where the open work sits",
    question: "What is waiting on us, and in which part of the work?",
    caption: "Open items by area of work, from the same numbers the board above reads.",
    form: "rows",
    valueLabel: "Open items",
    fullWidth: true,
  },
];

/** Shown to someone who has never chosen. Never empty — see the module note. */
export const DEFAULT_DASHBOARD_CHART_IDS: readonly DashboardChartId[] = DASHBOARD_CHART_IDS;

/**
 * WHERE THE CHOICE IS KEPT: this browser's local storage, keyed by user and
 * workspace.
 *
 * This is a deliberate choice between two options, made 2026-08-13 after
 * checking (again) that there is no user-preferences table or column anywhere
 * in this schema — the dashboard view switch and the getting-started card both
 * reached the same conclusion and both use local storage.
 *
 * THE COST, STATED PLAINLY: the selection does NOT follow the person to another
 * machine or another browser. They will pick again on their laptop. The
 * alternative was a migration adding a per-member preferences column, and it
 * was rejected because this is a display preference with no consequence — no
 * number changes, no record is written, and nothing downstream reads it. A
 * schema change is irreversible against a hosted database, and a column added
 * for one list of chart ids would be the third mechanism in this app for
 * remembering what a browser prefers. When a real preferences store arrives
 * (workspace defaults, notification settings — things where being wrong on a
 * second machine actually costs something), this moves into it and the parser
 * below is the only thing that has to change.
 */
export function dashboardChartStorageKey(userId: string, workspaceId: string): string {
  return `openplan:dashboard-charts:${userId}:${workspaceId}`;
}

const SEPARATOR = ",";

/**
 * Stored text → the ids to draw.
 *
 * `null` (nothing stored) means "never chosen", which is the DEFAULT set — not
 * an empty dashboard. An empty STRING is different: it is a person who
 * deliberately turned everything off, and that choice is honoured.
 * Unrecognized ids are dropped rather than rejected, so a figure retired in a
 * later release does not strand somebody on a blank dashboard.
 */
export function parseDashboardChartSelection(stored: string | null): DashboardChartId[] {
  if (stored === null) return [...DEFAULT_DASHBOARD_CHART_IDS];
  const known = new Set<string>(DASHBOARD_CHART_IDS);
  const chosen = stored
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part): part is DashboardChartId => known.has(part));
  // Catalog order, not the order they were clicked: the dashboard's layout is a
  // designed sequence, and letting click order rearrange it would put a
  // full-width list between the two side-by-side time series.
  return DASHBOARD_CHART_IDS.filter((id) => chosen.includes(id));
}

export function serializeDashboardChartSelection(ids: readonly DashboardChartId[]): string {
  return DASHBOARD_CHART_IDS.filter((id) => ids.includes(id)).join(SEPARATOR);
}
