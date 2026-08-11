/**
 * Data loaders for the project budget & pace surface — the read side of
 * src/lib/projects/budget.ts, kept out of the page so the page stays a
 * composition layer (and under the max-lines cap).
 *
 * All three sources shipped in the same release as this loader
 * (20260727000010 client invoicing, 20260727000012 deliverable budgets +
 * spend ledger), but a deployment may migrate late, so every read carries the
 * `looksLikePendingSchema` guard and degrades to empty rows plus an explicit
 * pending flag — never a hard failure, never a silent zero presented as fact.
 *
 * THAT WAS TRUE OF THE PENDING-MIGRATION CASE ONLY, and this header used to
 * claim it for every failure. `looksLikePendingSchema` answers exactly one
 * question — is this deployment behind a migration — and every OTHER error fell
 * through it into `data ?? []`, which is `[]`, which the budget panel renders as
 * "Billed to date $0", "Direct spend $0", "Actual to date $0" and "No
 * deliverables recorded yet, so there is nothing to judge burn against." A
 * revoked grant, a changed policy or a dropped connection is not a finding about
 * an agency's money. So the loader now classifies first and RETURNS what is left
 * — `unreadable` plus the database's own words in `readFailures` — for the
 * caller to surface, the same seam `loadOpportunityPursuitContext` and
 * `loadAerialMissionsAndPackagesForProject` use. It still does not throw: one
 * unreadable source must not take down a page that can honestly render the rest.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { looksLikePendingSchema } from "@/lib/models/run-launch";
import type { BilledLineLike } from "@/lib/projects/budget";

export type ProjectBudgetQuerySupabaseLike = Pick<SupabaseClient, "from">;

export type ProjectDeliverableBudgetRow = {
  id: string;
  title: string;
  summary: string | null;
  owner_label: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
  /** Absent when the deployment has not applied 20260727000012 yet. */
  budget_amount?: number | string | null;
  percent_complete?: number | string | null;
  /**
   * The accountable teammate (20260811000006). Absent when that migration is
   * still pending — which is a different fact from `null`, and the reason the
   * pending flag beside it exists: null means "nobody is assigned", absent
   * means "this deployment cannot answer the question yet".
   */
  assignee_user_id?: string | null;
};

export type ProjectSpendEntryRow = {
  id: string;
  deliverable_id: string | null;
  entry_date: string | null;
  amount: number | string | null;
  description: string;
  vendor_label: string | null;
  created_at: string;
};

export type ProjectBudgetInputs = {
  /** All deliverables for the project (newest-updated first, capped). */
  deliverables: ProjectDeliverableBudgetRow[];
  /** Stated project budget — null when not entered OR the column is pending. */
  statedBudgetAmount: number | string | null;
  spendEntries: ProjectSpendEntryRow[];
  /**
   * client_invoice_line_items of this project's SENT or PAID client invoices,
   * flattened with each line carrying its invoice's status. Draft and void
   * invoices never reach the budget math.
   */
  billedLines: BilledLineLike[];
  pending: {
    deliverables: boolean;
    /** True when the budget columns (not the table) are still pending. */
    deliverableBudgetColumns: boolean;
    /**
     * True when `assignee_user_id` (not the table, not the budget columns) is
     * still pending. Surfaced rather than swallowed: without it the deliverable
     * list would render every row as unassigned, which is a statement about the
     * team's work rather than about the database's schema.
     */
    deliverableAssigneeColumn: boolean;
    statedBudget: boolean;
    spendEntries: boolean;
    clientInvoices: boolean;
  };
  /**
   * Sources whose read FAILED for a reason that is NOT a pending migration.
   *
   * Parallel to `pending`, and deliberately separate from it: a pending schema
   * is a known state with a known operator move ("apply the migration"), while
   * this one means the loader cannot say what the project's money is. Both
   * resolve to empty rows, so a caller must branch on THESE FLAGS and never on
   * emptiness — `deliverables.length === 0` is the same value in both cases and
   * in the honest one.
   */
  unreadable: {
    deliverables: boolean;
    statedBudget: boolean;
    spendEntries: boolean;
    clientInvoices: boolean;
  };
  /**
   * The same failures, carrying the database's own message and a page-voiced
   * label, so a caller can hand them straight to its ReadFailureLog without
   * knowing which tables this loader reads.
   */
  readFailures: ProjectBudgetReadFailure[];
};

/** One unreadable budget source, in the shape `ReadFailureLog.check` accepts. */
export type ProjectBudgetReadFailure = {
  /** Plural, lower-case, no trailing period: it is rendered inside a sentence. */
  label: string;
  message: string;
};

/** Row caps: honest breadth for burn math without unbounded page loads. */
const MAX_DELIVERABLE_ROWS = 200;
const MAX_SPEND_ENTRY_ROWS = 500;
const MAX_CLIENT_INVOICE_ROWS = 200;

/**
 * Three projections, narrowing in the order the columns shipped, so a
 * deployment behind ONE migration does not lose the columns of another.
 *
 * A two-step ladder (full → legacy) would have been simpler and wrong: a
 * deployment carrying the budget columns but not yet `assignee_user_id` would
 * fall all the way back to the 2026-03 column set and render "no budget basis"
 * over budgets it actually has — a schema gap presented as a finding about an
 * agency's money.
 */
const DELIVERABLE_SELECT_LEGACY = "id, title, summary, owner_label, due_date, status, created_at";
const DELIVERABLE_SELECT_WITH_BUDGET = `${DELIVERABLE_SELECT_LEGACY}, budget_amount, percent_complete`;
const DELIVERABLE_SELECT = `${DELIVERABLE_SELECT_WITH_BUDGET}, assignee_user_id`;

type QueryResult = { data: unknown[] | null; error: { message?: string } | null };

/**
 * Classify first, then keep what is left — the rule the project page's own read
 * lanes follow (`_components/_read-lanes.ts`), restated here because a library
 * cannot reach the page's `ReadFailureLog`.
 *
 * Returns the database's own message when the read failed for anything other
 * than a pending migration, and `null` otherwise. A `null` therefore means "this
 * source answered", never "this source is empty".
 */
function unreadableReason(error: { message?: string } | null | undefined): string | null {
  if (!error) return null;
  if (looksLikePendingSchema(error.message)) return null;
  const message = error.message;
  return typeof message === "string" && message.trim() ? message.trim() : "no message reported";
}

export async function loadProjectBudgetInputs(
  supabase: ProjectBudgetQuerySupabaseLike,
  projectId: string
): Promise<ProjectBudgetInputs> {
  // Deliverables: primary select includes the budget columns; a deployment
  // that has not applied 20260727000012 retries with the legacy column set so
  // the deliverable list itself keeps working (rows then simply carry no
  // budget basis, and the pace lib refuses verdicts instead of guessing).
  const selectDeliverables = async (columns: string): Promise<QueryResult> =>
    (await supabase
      .from("project_deliverables")
      .select(columns)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(MAX_DELIVERABLE_ROWS)) as QueryResult;

  let deliverablesResult = await selectDeliverables(DELIVERABLE_SELECT);
  const deliverableAssigneeColumnPending = looksLikePendingSchema(deliverablesResult.error?.message);
  if (deliverableAssigneeColumnPending) {
    deliverablesResult = await selectDeliverables(DELIVERABLE_SELECT_WITH_BUDGET);
  }
  const deliverableBudgetColumnsPending = looksLikePendingSchema(deliverablesResult.error?.message);
  if (deliverableBudgetColumnsPending) {
    deliverablesResult = await selectDeliverables(DELIVERABLE_SELECT_LEGACY);
  }
  const deliverablesPending = looksLikePendingSchema(deliverablesResult.error?.message);
  const deliverablesUnreadable = unreadableReason(deliverablesResult.error);
  const deliverables = deliverablesPending
    ? []
    : ((deliverablesResult.data ?? []) as ProjectDeliverableBudgetRow[]);

  // Stated project budget: its own tolerant read so a pending projects.budget_amount
  // column can never take down the page's main project select.
  const statedBudgetResult = (await supabase
    .from("projects")
    .select("budget_amount")
    .eq("id", projectId)
    .maybeSingle()) as { data: { budget_amount?: number | string | null } | null; error: { message?: string } | null };
  // A PERMISSION FAILURE IS NOT A PENDING MIGRATION. This read used to widen
  // `pending` to `|| Boolean(error)`, which filed every failure as "the column
  // is not there yet" — so a revoked policy on `projects` produced the panel's
  // setup copy and an operator was sent to run a migration that was not the
  // problem. The classifier owns exactly its own case; everything else is
  // unreadable and says so.
  const statedBudgetPending = looksLikePendingSchema(statedBudgetResult.error?.message);
  const statedBudgetUnreadable = unreadableReason(statedBudgetResult.error);
  // Still null on ANY error: "Not entered" is what the panel prints for null,
  // and a budget nobody could read must not become a number either way.
  const statedBudgetAmount = statedBudgetResult.error ? null : statedBudgetResult.data?.budget_amount ?? null;

  const spendEntriesResult = (await supabase
    .from("project_spend_entries")
    .select("id, deliverable_id, entry_date, amount, description, vendor_label, created_at")
    .eq("project_id", projectId)
    .order("entry_date", { ascending: false })
    .limit(MAX_SPEND_ENTRY_ROWS)) as QueryResult;
  const spendEntriesPending = looksLikePendingSchema(spendEntriesResult.error?.message);
  const spendEntriesUnreadable = unreadableReason(spendEntriesResult.error);
  const spendEntries = spendEntriesPending ? [] : ((spendEntriesResult.data ?? []) as ProjectSpendEntryRow[]);

  // Billed lines: this project's client invoices in sent/paid status, each
  // line stamped with its invoice's status so the budget lib can keep its
  // billed-vs-draft honesty rules.
  const clientInvoicesResult = (await supabase
    .from("client_invoices")
    .select("id, status, client_invoice_line_items(id, deliverable_id, amount)")
    .eq("project_id", projectId)
    .in("status", ["sent", "paid"])
    .limit(MAX_CLIENT_INVOICE_ROWS)) as QueryResult;
  const clientInvoicesPending = looksLikePendingSchema(clientInvoicesResult.error?.message);
  const clientInvoicesUnreadable = unreadableReason(clientInvoicesResult.error);
  const billedLines: BilledLineLike[] = clientInvoicesPending
    ? []
    : ((clientInvoicesResult.data ?? []) as Array<{
        status: string;
        client_invoice_line_items:
          | Array<{ deliverable_id: string | null; amount: number | string | null }>
          | null;
      }>).flatMap((invoice) =>
        (invoice.client_invoice_line_items ?? []).map((line) => ({
          deliverable_id: line.deliverable_id,
          amount: line.amount,
          invoice_status: invoice.status,
        }))
      );

  // Labels are the loader's job, not the caller's: it is the only thing that
  // knows which tables it read, and a caller naming them would drift the moment
  // a source moved. Plural and lower-case because the page renders them inside
  // "This page could not read …".
  const readFailures = (
    [
      ["this project's deliverables", deliverablesUnreadable],
      ["this project's stated budget", statedBudgetUnreadable],
      ["this project's direct spend ledger", spendEntriesUnreadable],
      ["client invoices billed to this project", clientInvoicesUnreadable],
    ] as const
  ).flatMap(([label, message]) => (message ? [{ label, message }] : []));

  return {
    deliverables,
    statedBudgetAmount,
    spendEntries,
    billedLines,
    pending: {
      deliverables: deliverablesPending,
      deliverableBudgetColumns: deliverableBudgetColumnsPending,
      // A budget-column fallback necessarily dropped the assignee too, so it
      // reports pending as well — otherwise the panel would say the assignee
      // question was answered by a projection that never asked it.
      deliverableAssigneeColumn: deliverableAssigneeColumnPending || deliverableBudgetColumnsPending,
      statedBudget: statedBudgetPending,
      spendEntries: spendEntriesPending,
      clientInvoices: clientInvoicesPending,
    },
    unreadable: {
      deliverables: Boolean(deliverablesUnreadable),
      statedBudget: Boolean(statedBudgetUnreadable),
      spendEntries: Boolean(spendEntriesUnreadable),
      clientInvoices: Boolean(clientInvoicesUnreadable),
    },
    readFailures,
  };
}
