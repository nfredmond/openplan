import { Wallet } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectSpendEntryForm } from "@/components/projects/project-spend-entry-form";
import {
  DELIVERABLE_PACE_LABELS,
  deliverableBudgetPaceTone,
  type ProjectBudgetSnapshot,
} from "@/lib/projects/budget";
import { fmtCurrency } from "./_helpers";

export type ProjectBudgetPanelPendingSchema = {
  deliverableBudgetColumns: boolean;
  spendEntries: boolean;
  clientInvoices: boolean;
};

type ProjectBudgetPanelProps = {
  projectId: string;
  snapshot: ProjectBudgetSnapshot;
  pendingSchema: ProjectBudgetPanelPendingSchema;
  deliverableOptions: Array<{ id: string; title: string }>;
};

/**
 * Budget & pace panel — money going OUT against entered budgets. Everything
 * here is decomposed fact (billed client-invoice lines + direct spend) or an
 * explicit refusal; nothing extrapolates. Coverage copy names how many
 * deliverables actually carry budgets so a partial total is never read as a
 * project total.
 */
export function ProjectBudgetPanel({
  projectId,
  snapshot,
  pendingSchema,
  deliverableOptions,
}: ProjectBudgetPanelProps) {
  const budgetedCount = snapshot.deliverables.filter((summary) => summary.budgetAmount !== null).length;
  const deliverableCount = snapshot.deliverables.length;
  const coverageCopy =
    deliverableCount === 0
      ? "No deliverables recorded yet."
      : snapshot.budgetCoverage === "none"
        ? `0 of ${deliverableCount} deliverables budgeted.`
        : snapshot.budgetCoverage === "complete"
          ? `All ${deliverableCount} deliverables budgeted.`
          : `${budgetedCount} of ${deliverableCount} deliverables budgeted.`;

  return (
    <article id="project-budget-pace" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Budget &amp; pace</p>
            <h2 className="module-section-title">Burn against entered budgets</h2>
            <p className="module-section-description">
              Billed client-invoice lines plus direct spend, compared to the budgets and percent-complete planners
              actually entered. No run-rates, no projections — a deliverable without a basis gets a refusal, not a guess.
            </p>
          </div>
        </div>
      </div>

      {pendingSchema.deliverableBudgetColumns ? (
        <div className="module-alert mt-5 text-sm">
          Deliverable budget fields will appear after the deliverable-budgets migration is applied to the database.
        </div>
      ) : null}
      {pendingSchema.spendEntries ? (
        <div className="module-alert mt-5 text-sm">
          The project spend ledger will appear after the spend-ledger migration is applied to the database.
        </div>
      ) : null}
      {pendingSchema.clientInvoices ? (
        <div className="module-alert mt-5 text-sm">
          Billed client-invoice lines will appear after the client invoicing migration is applied to the database.
        </div>
      ) : null}

      <div className="module-summary-grid cols-5 mt-5">
        <div className="module-summary-card">
          <p className="module-summary-label">Stated project budget</p>
          <p className="module-summary-value text-base leading-tight">
            {snapshot.statedBudget !== null ? fmtCurrency(snapshot.statedBudget) : "Not entered"}
          </p>
          <p className="module-summary-detail">
            {snapshot.remainingAgainstStatedBudget !== null
              ? `${fmtCurrency(snapshot.remainingAgainstStatedBudget)} remaining against the stated budget.`
              : "Enter a project budget to see remaining against it."}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Deliverable budgets</p>
          <p className="module-summary-value text-base leading-tight">
            {snapshot.deliverableBudgetTotal !== null ? fmtCurrency(snapshot.deliverableBudgetTotal) : "None entered"}
          </p>
          <p className="module-summary-detail">{coverageCopy}</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Billed to date</p>
          <p className="module-summary-value text-base leading-tight">{fmtCurrency(snapshot.billedToDate)}</p>
          <p className="module-summary-detail">Sent or paid client-invoice lines attributed to this project.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Direct spend</p>
          <p className="module-summary-value text-base leading-tight">{fmtCurrency(snapshot.spendToDate)}</p>
          <p className="module-summary-detail">Ledger entries recorded on this project.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Actual to date</p>
          <p className="module-summary-value text-base leading-tight">{fmtCurrency(snapshot.actualToDate)}</p>
          <p className="module-summary-detail">Billed plus direct spend — the total burned so far.</p>
        </div>
      </div>

      {snapshot.attention.length > 0 ? (
        <div className="module-alert mt-5 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            {snapshot.attention.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr] mt-5">
        <div>
          {snapshot.deliverables.length === 0 ? (
            <div className="module-empty-state text-sm">
              No deliverables recorded yet, so there is nothing to judge burn against.
            </div>
          ) : (
            <div className="module-record-list">
              {snapshot.deliverables.map((summary, index) => (
                <div key={summary.deliverableId ?? `deliverable-${index}`} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={deliverableBudgetPaceTone(summary.paceStatus)}>
                        {DELIVERABLE_PACE_LABELS[summary.paceStatus]}
                      </StatusBadge>
                      {summary.budgetAmount !== null ? (
                        <StatusBadge tone="neutral">Budget {fmtCurrency(summary.budgetAmount)}</StatusBadge>
                      ) : null}
                      {summary.percentComplete !== null ? (
                        <StatusBadge tone="info">{summary.percentComplete}% complete</StatusBadge>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="module-record-title">{summary.title ?? "Untitled deliverable"}</h3>
                      <p className="module-record-summary">{summary.paceDetail}</p>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      Billed {fmtCurrency(summary.billedToDate)} · Spend {fmtCurrency(summary.spendToDate)} · Actual {fmtCurrency(summary.actualToDate)}
                      {summary.remaining !== null ? ` · Remaining ${fmtCurrency(summary.remaining)}` : ""}
                      {summary.draftedAmount > 0 ? ` · Drafted (not billed) ${fmtCurrency(summary.draftedAmount)}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <ProjectSpendEntryForm projectId={projectId} deliverableOptions={deliverableOptions} />
      </div>

      <p className="mt-4 text-[0.73rem] text-muted-foreground">
        Draft client invoices are disclosed separately and never counted as billed.
      </p>
    </article>
  );
}
