/** Test transport fixture only. This does not execute or model PostgreSQL/RLS. */
export type BudgetAnswer = { data: unknown; error: { message?: string; code?: string } | null };

export function projectBudgetSnapshotFixture(
  answers: Partial<Record<string, BudgetAnswer>> = {},
  pending = { assignee: false, budget: false },
  projectId = "project-1"
) {
  const source = (table: string, empty: unknown) => {
    const result = answers[table] ?? { data: empty, error: null };
    return result.error
      ? { complete: false, data: null, error: result.error }
      : { complete: true, data: result.data, error: null };
  };
  return {
    version: 1, project_id: projectId,
    deliverableAssigneeColumnPending: pending.assignee,
    deliverableBudgetColumnsPending: pending.budget,
    deliverables: source("project_deliverables", []),
    statedBudget: source("projects", { budget_amount: null }),
    spendEntries: source("project_spend_entries", []),
    clientInvoices: source("client_invoices", []),
  };
}

export function budgetDeliverable(id: string) {
  return {
    id, title: `Deliverable ${id}`, summary: null, owner_label: null, due_date: null,
    status: "in_progress", created_at: "2026-10-16", budget_amount: 1000,
    percent_complete: 50, assignee_user_id: null,
  };
}
export function budgetSpend(id: string, deliverable_id: string | null = null) {
  return { id, deliverable_id, entry_date: "2026-10-16", amount: 1,
    description: "Direct cost", vendor_label: null, created_at: "2026-10-16" };
}
