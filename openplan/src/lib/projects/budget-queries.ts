/**
 * Complete project budget inputs from one caller-scoped database snapshot.
 * The scalar JSON RPC aggregates inside PostgreSQL, before PostgREST row caps.
 * STABLE gives every source the same statement snapshot, including schema
 * fallbacks. No independent paging can mix an invoice status with later lines.
 * Failed or malformed reads carry unavailable flags; consumers must honor them.
 */
import { z } from "zod";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import type { BilledLineLike } from "@/lib/projects/budget";

export type ProjectBudgetQuerySupabaseLike = {
  rpc: (name: "project_budget_inputs_v1", args: { p_project_id: string }) => PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
};

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
  /** All caller-visible deliverables, newest-updated first with an id tie-breaker. */
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
    /** The complete-snapshot migration/RPC is not installed yet. */
    snapshot: boolean;
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

const amount = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/), z.null()]);
const deliverable = z.object({
  id: z.string().min(1), title: z.string(), summary: z.string().nullable(),
  owner_label: z.string().nullable(), due_date: z.string().nullable(), status: z.string(),
  created_at: z.string(), budget_amount: amount.optional(), percent_complete: amount.optional(),
  assignee_user_id: z.string().nullable().optional(),
});
const spend = z.object({
  id: z.string().min(1), deliverable_id: z.string().nullable(), entry_date: z.string().nullable(),
  amount, description: z.string(), vendor_label: z.string().nullable(), created_at: z.string(),
});
const invoice = z.object({
  id: z.string().min(1), status: z.enum(["sent", "paid"]),
  client_invoice_line_items: z.array(z.object({
    id: z.string().min(1), deliverable_id: z.string().nullable(), amount,
  })),
});
const sourceError = z.object({ message: z.string(), code: z.string().optional() });
function lane<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("complete", [
    z.object({ complete: z.literal(true), data, error: z.null() }),
    z.object({ complete: z.literal(false), data: z.null(), error: sourceError }),
  ]);
}
const snapshotEnvelope = z.object({
  version: z.literal(1), project_id: z.string(),
  deliverableAssigneeColumnPending: z.boolean(), deliverableBudgetColumnsPending: z.boolean(),
  deliverables: lane(z.array(deliverable)),
  statedBudget: lane(z.object({ budget_amount: amount })),
  spendEntries: lane(z.array(spend)), clientInvoices: lane(z.array(invoice)),
});

/** Repeated primary keys indicate a broken snapshot, not costs to silently deduplicate. */
function requireUniqueIds(rows: { id: string }[]) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error("Budget snapshot contains repeated source identities.");
  }
}

function unavailableInputs(error: { message?: string; code?: string }): ProjectBudgetInputs {
  const pending = error.code === "PGRST202" || error.code === "42883" || looksLikePendingSchema(error.message);
  return {
    deliverables: [], statedBudgetAmount: null, spendEntries: [], billedLines: [],
    pending: {
      // A missing snapshot does not establish that any older table/column is missing.
      snapshot: pending, deliverables: false, deliverableBudgetColumns: false, deliverableAssigneeColumn: false,
      statedBudget: false, spendEntries: false, clientInvoices: false,
    },
    unreadable: {
      deliverables: !pending, statedBudget: !pending, spendEntries: !pending, clientInvoices: !pending,
    },
    readFailures: pending ? [] : [{ label: "this project's complete budget inputs", message: error.message || "no message reported" }],
  };
}

/** A timeout, malformed response or missing RPC never falls back to capped reads. */
export async function loadProjectBudgetInputs(
  supabase: ProjectBudgetQuerySupabaseLike,
  projectId: string
): Promise<ProjectBudgetInputs> {
  try {
    const result = await supabase.rpc("project_budget_inputs_v1", { p_project_id: projectId });
    if (result.error) return unavailableInputs(result.error);
    const parsed = snapshotEnvelope.safeParse(result.data);
    if (!parsed.success || parsed.data.project_id !== projectId) {
      return unavailableInputs({ message: "Complete budget snapshot response is invalid or belongs to another project." });
    }
    const snapshot = parsed.data;
    const deliverables = snapshot.deliverables.data ?? [];
    const spendEntries = snapshot.spendEntries.data ?? [];
    const invoices = snapshot.clientInvoices.data ?? [];
    requireUniqueIds(deliverables);
    requireUniqueIds(spendEntries);
    requireUniqueIds(invoices);
    requireUniqueIds(invoices.flatMap((row) => row.client_invoice_line_items));
    if (snapshot.deliverables.complete && deliverables.some((row) =>
      (!snapshot.deliverableBudgetColumnsPending && (row.budget_amount === undefined || row.percent_complete === undefined)) ||
      (!snapshot.deliverableAssigneeColumnPending && row.assignee_user_id === undefined)
    )) {
      return unavailableInputs({ message: "Complete budget snapshot omitted required deliverable columns." });
    }

    const pending = (source: { error: { message?: string } | null }) => looksLikePendingSchema(source.error?.message);
    const failed = (source: { error: { message?: string } | null }) => Boolean(source.error) && !pending(source);
    return {
      deliverables,
      statedBudgetAmount: snapshot.statedBudget.data?.budget_amount ?? null,
      spendEntries,
      billedLines: invoices.flatMap((row) => row.client_invoice_line_items.map((line) => ({
        id: line.id, invoice_id: row.id, deliverable_id: line.deliverable_id,
        amount: line.amount, invoice_status: row.status,
      }))),
      pending: {
        snapshot: false,
        deliverables: pending(snapshot.deliverables),
        deliverableBudgetColumns: snapshot.deliverableBudgetColumnsPending,
        deliverableAssigneeColumn: snapshot.deliverableAssigneeColumnPending,
        statedBudget: pending(snapshot.statedBudget),
        spendEntries: pending(snapshot.spendEntries), clientInvoices: pending(snapshot.clientInvoices),
      },
      unreadable: {
        deliverables: failed(snapshot.deliverables), statedBudget: failed(snapshot.statedBudget),
        spendEntries: failed(snapshot.spendEntries), clientInvoices: failed(snapshot.clientInvoices),
      },
      readFailures: ([
        ["this project's deliverables", snapshot.deliverables],
        ["this project's stated budget", snapshot.statedBudget],
        ["this project's direct spend ledger", snapshot.spendEntries],
        ["client invoices billed to this project", snapshot.clientInvoices],
      ] as const).flatMap(([label, source]) => failed(source) ? [{ label, message: source.error?.message || "no message reported" }] : []),
    };
  } catch (error) {
    return unavailableInputs({ message: error instanceof Error ? error.message : "Complete budget snapshot could not be read." });
  }
}
