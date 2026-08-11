/**
 * The read side of the portfolio table on /projects — six BATCHED reads, one per
 * lane, each grouped by `project_id`.
 *
 * WHY BATCHED, AND WHY THIS IS NOT "THE PROJECT PAGE, N TIMES". Everything the
 * portfolio table shows already exists per project: `loadProjectBudgetInputs`
 * reads one project's money, `buildProjectControlsSummary` shapes one project's
 * deadlines. Calling either in a loop over an agency's portfolio is four reads
 * per project — a hundred projects is four hundred round trips on one render.
 * So each lane is read ONCE for the whole workspace and grouped here, and the
 * per-project shaping (`./portfolio.ts`) is fed from the groups. The burn
 * arithmetic itself is NOT re-implemented: `buildProjectBudgetSnapshot` is the
 * one definition of burn in this repo and the shaping layer calls it per project
 * with these rows.
 *
 * TENANCY IS PER-LANE AND DELIBERATE, exactly as in the Document Library and
 * `/my-work`. `project_deliverables`, `project_milestones`, `project_submittals`
 * and `project_spend_entries` have NO workspace_id of their own — they are
 * scoped through `projects` by their RLS policies (20260313000012) — so each is
 * read with a `projects!inner(...)` embed and filtered on
 * `projects.workspace_id`. The `!inner` is load-bearing: a plain embed keeps the
 * child row and nulls the parent when the filter misses, which for a planner in
 * two workspaces would mix one workspace's deliverables into the other's
 * portfolio. `client_invoices` and `projects` carry `workspace_id` themselves
 * and are filtered on it directly. There is NO service-role client anywhere in
 * this module, and a test greps for one.
 *
 * THREE WAYS A LANE CAN FAIL TO ANSWER, AND ALL THREE ARE REPORTED SEPARATELY.
 *
 *   - `pending` — the deployment is behind a migration. A known state with a
 *     named operator move, not an outage.
 *   - `failed`  — anything else. The database's own words go into the
 *     `ReadFailureLog` so the page can say which columns to disbelieve.
 *   - `truncated` — the read hit its row cap. THIS IS THE ONE THAT WOULD
 *     OTHERWISE LIE. A capped read returns the first N rows across the whole
 *     workspace, so a project whose rows all fell outside the cap comes back
 *     with none — and "no open deliverables" is then rendered over a project
 *     that has forty. A truncated lane therefore makes every value derived from
 *     it unknown ("—") rather than wrong, and the page discloses the cap.
 *
 * The caller must branch on these flags and never on emptiness: an empty group
 * is the same value in all four cases, and only one of them means "this project
 * has none of these".
 */

import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * How many projects one batch covers.
 *
 * The portfolio TABLE renders this many rows, and the batched reads cover
 * exactly the projects it renders — the list's own limit, so the reads and the
 * screen can never disagree about which projects were measured. A workspace with
 * more projects than this still sees every one of them in the card list below;
 * the table says how many it summarized.
 */
export const PORTFOLIO_MAX_PROJECTS = 50;

/**
 * Row allowance per project, per lane, and the hard ceiling on any one lane.
 *
 * Generous on purpose: the cost of hitting the cap is not a slow page, it is a
 * column of "—" across the whole table, so the cap should bind only for an
 * agency whose portfolio genuinely needs pagination rather than a summary.
 */
export const PORTFOLIO_ROWS_PER_PROJECT = 40;
export const PORTFOLIO_MAX_ROWS_PER_LANE = 1000;

export const PORTFOLIO_LANE_IDS = [
  "project_budgets",
  "deliverables",
  "milestones",
  "submittals",
  "spend_entries",
  "billed_lines",
] as const;

export type PortfolioLaneId = (typeof PORTFOLIO_LANE_IDS)[number];

export type PortfolioLaneOutcome = {
  rowCount: number;
  pending: boolean;
  failed: boolean;
  truncated: boolean;
};

/** A lane is usable only when it neither failed, nor is pending, nor was cut short. */
export function laneAnswered(outcome: PortfolioLaneOutcome | undefined): boolean {
  return Boolean(outcome && !outcome.pending && !outcome.failed && !outcome.truncated);
}

export type PortfolioLane<TRow> = {
  byProjectId: Map<string, TRow[]>;
  outcome: PortfolioLaneOutcome;
};

export type PortfolioProjectBudgetRow = { id: string; budget_amount?: number | string | null };
export type PortfolioDeliverableRow = {
  id: string;
  project_id: string;
  title: string | null;
  status: string | null;
  due_date: string | null;
  budget_amount?: number | string | null;
  percent_complete?: number | string | null;
};
export type PortfolioMilestoneRow = {
  id: string;
  project_id: string;
  title: string | null;
  status: string | null;
  target_date: string | null;
};
export type PortfolioSubmittalRow = {
  id: string;
  project_id: string;
  title: string | null;
  status: string | null;
  due_date: string | null;
};
export type PortfolioSpendRow = {
  project_id: string;
  deliverable_id: string | null;
  amount: number | string | null;
};
export type PortfolioBilledLineRow = {
  project_id: string;
  deliverable_id: string | null;
  amount: number | string | null;
  invoice_status: string | null;
};

export type ProjectPortfolioInputs = {
  /** The project ids the batch covered — the table's own row set. */
  projectIds: readonly string[];
  /** True when the workspace has more projects than one batch covers. */
  projectsTruncated: boolean;
  projectBudgets: PortfolioLane<PortfolioProjectBudgetRow>;
  deliverables: PortfolioLane<PortfolioDeliverableRow>;
  milestones: PortfolioLane<PortfolioMilestoneRow>;
  submittals: PortfolioLane<PortfolioSubmittalRow>;
  spendEntries: PortfolioLane<PortfolioSpendRow>;
  billedLines: PortfolioLane<PortfolioBilledLineRow>;
  /**
   * True when `project_deliverables.budget_amount` / `percent_complete` are not
   * on this deployment yet — a different fact from "no budgets entered", and the
   * reason the burn column can say which of the two it is.
   */
  deliverableBudgetColumnsPending: boolean;
  reads: ReadFailureLog;
  rowLimitPerLane: number;
};

/** The slice of a supabase-js chain this module uses. Structural: clients are untyped by design. */
type PortfolioReadResult = { data: unknown; error: { message?: string | null } | null };

type PortfolioQuery = PromiseLike<PortfolioReadResult> & {
  eq(column: string, value: string): PortfolioQuery;
  in(column: string, values: readonly string[]): PortfolioQuery;
  order(column: string, options: { ascending: boolean }): PortfolioQuery;
  limit(count: number): PortfolioQuery;
};

type PortfolioReadClient = {
  from(table: string): { select(columns: string): PortfolioQuery };
};

export type LoadProjectPortfolioOptions = {
  workspaceId: string;
  /** The workspace's project ids, in the order the page lists them. Capped here, not by the caller. */
  projectIds: readonly string[];
  maxProjects?: number;
};

function rowLimitFor(projectCount: number): number {
  return Math.min(PORTFOLIO_MAX_ROWS_PER_LANE, Math.max(projectCount, 1) * PORTFOLIO_ROWS_PER_PROJECT);
}

type LaneSpec = {
  id: PortfolioLaneId;
  table: string;
  select: string;
  workspaceFilterColumn: string;
  /** Column the rows are grouped by. `projects` groups by its own id. */
  groupColumn: string;
  orderColumn: string;
  orderAscending: boolean;
  /** Restrict to a value set (client invoices: billed statuses only). */
  inFilter?: { column: string; values: readonly string[] };
};

/**
 * Invoice statuses whose lines count as billed, in the receivable vocabulary.
 * `buildProjectBudgetSnapshot` keeps the billed-vs-draft rule; this filter only
 * avoids dragging void and draft invoices across the wire.
 */
const BILLED_INVOICE_STATUSES = ["sent", "paid"] as const;

const PROJECT_EMBED = "projects!inner(id, workspace_id)";

const LANE_SPECS: readonly LaneSpec[] = [
  {
    id: "project_budgets",
    table: "projects",
    select: "id, budget_amount",
    workspaceFilterColumn: "workspace_id",
    groupColumn: "id",
    orderColumn: "updated_at",
    orderAscending: false,
  },
  {
    id: "deliverables",
    table: "project_deliverables",
    // Every deliverable, not only the open ones: budget COVERAGE is a statement
    // about all of them, and a completed deliverable's budget is still spent.
    select: `id, project_id, title, status, due_date, budget_amount, percent_complete, ${PROJECT_EMBED}`,
    workspaceFilterColumn: "projects.workspace_id",
    groupColumn: "project_id",
    orderColumn: "due_date",
    orderAscending: true,
  },
  {
    id: "milestones",
    table: "project_milestones",
    select: `id, project_id, title, status, target_date, ${PROJECT_EMBED}`,
    workspaceFilterColumn: "projects.workspace_id",
    groupColumn: "project_id",
    orderColumn: "target_date",
    orderAscending: true,
  },
  {
    id: "submittals",
    table: "project_submittals",
    select: `id, project_id, title, status, due_date, ${PROJECT_EMBED}`,
    workspaceFilterColumn: "projects.workspace_id",
    groupColumn: "project_id",
    orderColumn: "due_date",
    orderAscending: true,
  },
  {
    id: "spend_entries",
    table: "project_spend_entries",
    select: `project_id, deliverable_id, amount, ${PROJECT_EMBED}`,
    workspaceFilterColumn: "projects.workspace_id",
    groupColumn: "project_id",
    orderColumn: "entry_date",
    orderAscending: false,
  },
  {
    id: "billed_lines",
    // client_invoices carries its own workspace_id, so no embed is needed —
    // and none is used. An embed that is not load-bearing is a join a reader
    // has to reason about for nothing.
    table: "client_invoices",
    select: "id, project_id, status, client_invoice_line_items(deliverable_id, amount)",
    workspaceFilterColumn: "workspace_id",
    groupColumn: "project_id",
    orderColumn: "invoice_date",
    orderAscending: false,
    inFilter: { column: "status", values: BILLED_INVOICE_STATUSES },
  },
];

/** The select strings, exported so a projection assertion can read them without a live database. */
export const PORTFOLIO_LANE_SELECTS: Readonly<Record<PortfolioLaneId, string>> = Object.freeze(
  Object.fromEntries(LANE_SPECS.map((spec) => [spec.id, spec.select])) as Record<PortfolioLaneId, string>
);

/** The deliverable projection without the columns 20260727000012 added, for a deployment behind it. */
const DELIVERABLE_SELECT_WITHOUT_BUDGET = `id, project_id, title, status, due_date, ${PROJECT_EMBED}`;

async function readLane(
  client: PortfolioReadClient,
  spec: LaneSpec,
  workspaceId: string,
  rowLimit: number,
  selectOverride?: string
): Promise<PortfolioReadResult> {
  try {
    let query = client
      .from(spec.table)
      .select(selectOverride ?? spec.select)
      .eq(spec.workspaceFilterColumn, workspaceId);
    if (spec.inFilter) query = query.in(spec.inFilter.column, spec.inFilter.values);
    return await query.order(spec.orderColumn, { ascending: spec.orderAscending }).limit(rowLimit);
  } catch (error) {
    // A thrown read (network, malformed response) is still a failed read, not
    // an empty lane; shape it like one so the classification below sees it.
    return { data: null, error: { message: error instanceof Error ? error.message : "read threw" } };
  }
}

function groupRows<TRow extends Record<string, unknown>>(
  rows: TRow[],
  groupColumn: string,
  keep: ReadonlySet<string>
): Map<string, TRow[]> {
  const grouped = new Map<string, TRow[]>();
  for (const row of rows) {
    const key = row[groupColumn];
    if (typeof key !== "string" || !keep.has(key)) continue;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return grouped;
}

function emptyLane<TRow>(outcome: PortfolioLaneOutcome): PortfolioLane<TRow> {
  return { byProjectId: new Map<string, TRow[]>(), outcome };
}

/** Read the six lanes in parallel and group each by project. */
export async function loadProjectPortfolioInputs(
  supabase: unknown,
  options: LoadProjectPortfolioOptions
): Promise<ProjectPortfolioInputs> {
  const client = supabase as PortfolioReadClient;
  const maxProjects = options.maxProjects ?? PORTFOLIO_MAX_PROJECTS;
  const projectIds = options.projectIds.slice(0, maxProjects);
  const keep = new Set(projectIds);
  const rowLimit = rowLimitFor(projectIds.length);
  const reads = new ReadFailureLog();

  const readLabels: Record<PortfolioLaneId, string> = {
    project_budgets: "project budgets",
    deliverables: "project deliverables",
    milestones: "project milestones",
    submittals: "project submittals",
    spend_entries: "project spend ledgers",
    billed_lines: "client invoices billed to these projects",
  };

  if (projectIds.length === 0) {
    const idle: PortfolioLaneOutcome = { rowCount: 0, pending: false, failed: false, truncated: false };
    return {
      projectIds,
      projectsTruncated: false,
      projectBudgets: emptyLane(idle),
      deliverables: emptyLane(idle),
      milestones: emptyLane(idle),
      submittals: emptyLane(idle),
      spendEntries: emptyLane(idle),
      billedLines: emptyLane(idle),
      deliverableBudgetColumnsPending: false,
      reads,
      rowLimitPerLane: rowLimit,
    };
  }

  const results = await Promise.all(
    LANE_SPECS.map((spec) => readLane(client, spec, options.workspaceId, rowLimit))
  );

  // The deliverable lane alone has a projection ladder: `budget_amount` and
  // `percent_complete` arrived in 20260727000012, and a deployment behind it
  // must still get its deadline counts rather than losing the whole lane.
  const deliverableIndex = LANE_SPECS.findIndex((spec) => spec.id === "deliverables");
  let deliverableBudgetColumnsPending = looksLikePendingSchema(results[deliverableIndex].error?.message);
  if (deliverableBudgetColumnsPending) {
    results[deliverableIndex] = await readLane(
      client,
      LANE_SPECS[deliverableIndex],
      options.workspaceId,
      rowLimit,
      DELIVERABLE_SELECT_WITHOUT_BUDGET
    );
    // A second failure means the TABLE is missing, not the columns; the lane's
    // own pending flag covers that and this one must not claim otherwise.
    if (looksLikePendingSchema(results[deliverableIndex].error?.message)) {
      deliverableBudgetColumnsPending = false;
    }
  }

  const lanes = new Map<PortfolioLaneId, PortfolioLane<Record<string, unknown>>>();

  LANE_SPECS.forEach((spec, index) => {
    const result = results[index];
    // Classify first (a pending migration has a truer thing to say than "could
    // not be read"), collect what is left.
    const pending = looksLikePendingSchema(result.error?.message);
    const failed = pending ? false : reads.check(readLabels[spec.id], result);
    const rows = pending || failed ? [] : ((result.data ?? []) as Array<Record<string, unknown>>);
    lanes.set(spec.id, {
      byProjectId: groupRows(rows, spec.groupColumn, keep),
      outcome: {
        rowCount: rows.length,
        pending,
        failed,
        // `>=` rather than `===`: a client that returned more than asked for is
        // still a read this module cannot prove was complete.
        truncated: rows.length >= rowLimit,
      },
    });
  });

  const lane = <TRow>(id: PortfolioLaneId): PortfolioLane<TRow> =>
    (lanes.get(id) ?? emptyLane({ rowCount: 0, pending: false, failed: true, truncated: false })) as PortfolioLane<TRow>;

  // Billed lines arrive nested inside their invoice; flatten to one row per
  // line, each stamped with its invoice's status, which is the shape
  // `buildProjectBudgetSnapshot` takes.
  const invoiceLane = lane<
    { project_id: string; status: string | null; client_invoice_line_items: unknown }
  >("billed_lines");
  const billedByProject = new Map<string, PortfolioBilledLineRow[]>();
  for (const [projectId, invoices] of invoiceLane.byProjectId) {
    const flattened: PortfolioBilledLineRow[] = [];
    for (const invoice of invoices) {
      const lines = Array.isArray(invoice.client_invoice_line_items)
        ? (invoice.client_invoice_line_items as Array<{
            deliverable_id?: string | null;
            amount?: number | string | null;
          }>)
        : [];
      for (const line of lines) {
        flattened.push({
          project_id: projectId,
          deliverable_id: line.deliverable_id ?? null,
          amount: line.amount ?? null,
          invoice_status: invoice.status ?? null,
        });
      }
    }
    billedByProject.set(projectId, flattened);
  }

  return {
    projectIds,
    projectsTruncated: options.projectIds.length > projectIds.length,
    projectBudgets: lane<PortfolioProjectBudgetRow>("project_budgets"),
    deliverables: lane<PortfolioDeliverableRow>("deliverables"),
    milestones: lane<PortfolioMilestoneRow>("milestones"),
    submittals: lane<PortfolioSubmittalRow>("submittals"),
    spendEntries: lane<PortfolioSpendRow>("spend_entries"),
    billedLines: { byProjectId: billedByProject, outcome: invoiceLane.outcome },
    deliverableBudgetColumnsPending,
    reads,
    rowLimitPerLane: rowLimit,
  };
}
