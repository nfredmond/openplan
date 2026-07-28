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
    statedBudget: boolean;
    spendEntries: boolean;
    clientInvoices: boolean;
  };
};

/** Row caps: honest breadth for burn math without unbounded page loads. */
const MAX_DELIVERABLE_ROWS = 200;
const MAX_SPEND_ENTRY_ROWS = 500;
const MAX_CLIENT_INVOICE_ROWS = 200;

const DELIVERABLE_SELECT_LEGACY = "id, title, summary, owner_label, due_date, status, created_at";
const DELIVERABLE_SELECT = `${DELIVERABLE_SELECT_LEGACY}, budget_amount, percent_complete`;

type QueryResult = { data: unknown[] | null; error: { message?: string } | null };

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
  const deliverableBudgetColumnsPending = looksLikePendingSchema(deliverablesResult.error?.message);
  if (deliverableBudgetColumnsPending) {
    deliverablesResult = await selectDeliverables(DELIVERABLE_SELECT_LEGACY);
  }
  const deliverablesPending = looksLikePendingSchema(deliverablesResult.error?.message);
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
  const statedBudgetPending =
    looksLikePendingSchema(statedBudgetResult.error?.message) || Boolean(statedBudgetResult.error);
  const statedBudgetAmount = statedBudgetPending ? null : statedBudgetResult.data?.budget_amount ?? null;

  const spendEntriesResult = (await supabase
    .from("project_spend_entries")
    .select("id, deliverable_id, entry_date, amount, description, vendor_label, created_at")
    .eq("project_id", projectId)
    .order("entry_date", { ascending: false })
    .limit(MAX_SPEND_ENTRY_ROWS)) as QueryResult;
  const spendEntriesPending = looksLikePendingSchema(spendEntriesResult.error?.message);
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

  return {
    deliverables,
    statedBudgetAmount,
    spendEntries,
    billedLines,
    pending: {
      deliverables: deliverablesPending,
      deliverableBudgetColumns: deliverableBudgetColumnsPending,
      statedBudget: statedBudgetPending,
      spendEntries: spendEntriesPending,
      clientInvoices: clientInvoicesPending,
    },
  };
}
