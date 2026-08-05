import { parseOptionalAmount } from "@/lib/money/optional-amount";
import { parseCurrencyAmount } from "@/lib/invoicing/invoice-records";

/**
 * Deliverable budgets and project burn.
 *
 * Pure computation over record-like rows (project_deliverables budget columns,
 * project_spend_entries, and invoice lines attributed to deliverables) — no
 * I/O, mirroring src/lib/invoicing/invoice-records.ts. This is a different
 * concern from src/lib/projects/funding.ts, which computes funding-stack
 * coverage (money coming IN); this module tracks money going OUT against a
 * not-to-exceed budget.
 *
 * The honesty rules, in order of precedence:
 * - `no_budget` / `no_progress_basis` come before ANY pace verdict. A burn
 *   percentage without a budget, or a pace comparison without an entered
 *   percent_complete, would be a guess — the lib refuses instead.
 * - `over_budget` needs only a budget (actual > budget is a fact, not a pace
 *   judgment), so it outranks the missing-progress refusal.
 * - `on_pace` / ahead / behind are only ever emitted when BOTH a budget and a
 *   recorded percent_complete exist, comparing burn% to progress% within a
 *   tolerance band. Nothing here extrapolates: no run-rate, no projected
 *   completion date, no estimate-at-complete.
 */

/** Burn may drift this many percentage points from recorded progress and still count as on pace. */
export const PACE_TOLERANCE_POINTS = 10;

/**
 * Invoice statuses that count as billed (sent to the client or already paid).
 * Covers both invoicing vocabularies: the reimbursement register
 * (billing_invoice_records: submitted / approved_for_payment / paid) and the
 * receivable register (client_invoices: sent / paid).
 */
export const BILLED_LINE_SENT_STATUSES = ["sent", "submitted", "approved_for_payment", "paid"] as const;

/** Invoice statuses that are still drafts — tracked separately, never counted as billed. */
export const BILLED_LINE_DRAFT_STATUSES = ["draft", "internal_review"] as const;

export type DeliverableBudgetLike = {
  id?: string | null;
  title?: string | null;
  budget_amount?: number | string | null;
  percent_complete?: number | string | null;
};

export type SpendEntryLike = {
  deliverable_id?: string | null;
  amount?: number | string | null;
};

export type BilledLineLike = {
  deliverable_id?: string | null;
  amount?: number | string | null;
  invoice_status?: string | null;
};

export type ProjectBudgetLike = {
  budget_amount?: number | string | null;
};

export type DeliverablePaceStatus =
  | "no_budget"
  | "no_progress_basis"
  | "on_pace"
  | "billed_ahead_of_progress"
  | "billed_behind_progress"
  | "over_budget";

/** Honest short labels for each pace status — refusals stay refusals. */
export const DELIVERABLE_PACE_LABELS: Record<DeliverablePaceStatus, string> = {
  no_budget: "No budget entered",
  no_progress_basis: "No progress basis",
  on_pace: "On pace",
  billed_ahead_of_progress: "Burn ahead of progress",
  billed_behind_progress: "Billing behind progress",
  over_budget: "Over budget",
};

/**
 * Tone mapping for pace chips. The two refusal states are deliberately
 * neutral — a missing basis is not an alarm, and dressing it as one would
 * pressure planners to invent numbers.
 */
export function deliverableBudgetPaceTone(
  status: DeliverablePaceStatus
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "over_budget" || status === "billed_ahead_of_progress") return "warning";
  if (status === "on_pace") return "success";
  if (status === "billed_behind_progress") return "info";
  return "neutral";
}

export type DeliverableBudgetSummary = {
  deliverableId: string | null;
  title: string | null;
  budgetAmount: number | null;
  percentComplete: number | null;
  /** Sent/paid invoice lines only — drafts are never billed. */
  billedToDate: number;
  /** Direct spend recorded in the project ledger. */
  spendToDate: number;
  /** billedToDate + spendToDate — the decomposed total burned against the budget. */
  actualToDate: number;
  /** Draft/internal-review invoice lines, disclosed separately. */
  draftedAmount: number;
  remaining: number | null;
  burnPercent: number | null;
  paceStatus: DeliverablePaceStatus;
  paceDetail: string;
};

export type ProjectBudgetCoverage = "none" | "partial" | "complete";

export type ProjectBudgetSnapshot = {
  statedBudget: number | null;
  /** null until at least one deliverable carries a budget — never an implied zero total. */
  deliverableBudgetTotal: number | null;
  budgetCoverage: ProjectBudgetCoverage;
  billedToDate: number;
  spendToDate: number;
  actualToDate: number;
  remainingAgainstStatedBudget: number | null;
  deliverables: DeliverableBudgetSummary[];
  attention: string[];
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Parse an optional numeric column: null/undefined/unparseable/negative → null, never 0. */
/** percent_complete is a progress basis only when it is a real 0–100 value. */
function parsePercentComplete(value: number | string | null | undefined): number | null {
  const parsed = parseOptionalAmount(value);
  if (parsed === null || parsed > 100) return null;
  return parsed;
}

function isSentStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && (BILLED_LINE_SENT_STATUSES as readonly string[]).includes(status);
}

function isDraftStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && (BILLED_LINE_DRAFT_STATUSES as readonly string[]).includes(status);
}

function sumAmounts(values: Array<number | string | null | undefined>): number {
  return roundCurrency(values.reduce<number>((total, value) => total + parseCurrencyAmount(value), 0));
}

function formatAmount(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function buildDeliverableBudgetSummary(
  deliverable: DeliverableBudgetLike,
  spendEntries: SpendEntryLike[] | null | undefined,
  billedLines: BilledLineLike[] | null | undefined
): DeliverableBudgetSummary {
  const deliverableId = typeof deliverable.id === "string" && deliverable.id ? deliverable.id : null;
  const title = typeof deliverable.title === "string" && deliverable.title ? deliverable.title : null;

  // Attribution is strictly by deliverable id. A line pointing at some other
  // deliverable — or at nothing — is never counted here.
  const ownSpend = deliverableId
    ? (spendEntries ?? []).filter((entry) => entry.deliverable_id === deliverableId)
    : [];
  const ownLines = deliverableId
    ? (billedLines ?? []).filter((line) => line.deliverable_id === deliverableId)
    : [];

  const budgetAmount = parseOptionalAmount(deliverable.budget_amount);
  const percentComplete = parsePercentComplete(deliverable.percent_complete);

  const billedToDate = sumAmounts(ownLines.filter((line) => isSentStatus(line.invoice_status)).map((line) => line.amount));
  const draftedAmount = sumAmounts(ownLines.filter((line) => isDraftStatus(line.invoice_status)).map((line) => line.amount));
  const spendToDate = sumAmounts(ownSpend.map((entry) => entry.amount));
  const actualToDate = roundCurrency(billedToDate + spendToDate);

  const remaining = budgetAmount === null ? null : roundCurrency(budgetAmount - actualToDate);
  const burnPercent =
    budgetAmount !== null && budgetAmount > 0 ? roundPercent((actualToDate / budgetAmount) * 100) : null;

  let paceStatus: DeliverablePaceStatus;
  let paceDetail: string;

  if (budgetAmount === null) {
    paceStatus = "no_budget";
    paceDetail = "No budget entered for this deliverable, so burn cannot be judged.";
  } else if (actualToDate > budgetAmount) {
    paceStatus = "over_budget";
    paceDetail = `Actual to date ${formatAmount(actualToDate)} exceeds the ${formatAmount(budgetAmount)} budget.`;
  } else if (percentComplete === null || burnPercent === null) {
    // burnPercent is null here only for a zero budget — a degenerate basis
    // that supports no burn percentage, so no pace verdict either.
    paceStatus = "no_progress_basis";
    paceDetail =
      percentComplete === null
        ? "No percent complete recorded, so burn cannot be compared against progress."
        : "A zero budget yields no burn percentage, so pace cannot be judged.";
  } else {
    const drift = roundPercent(burnPercent - percentComplete);
    if (drift > PACE_TOLERANCE_POINTS) {
      paceStatus = "billed_ahead_of_progress";
      paceDetail = `Burned ${burnPercent}% of budget at ${percentComplete}% complete — burn is running ahead of recorded progress.`;
    } else if (drift < -PACE_TOLERANCE_POINTS) {
      paceStatus = "billed_behind_progress";
      paceDetail = `Burned ${burnPercent}% of budget at ${percentComplete}% complete — billing is trailing recorded progress.`;
    } else {
      paceStatus = "on_pace";
      paceDetail = `Burned ${burnPercent}% of budget at ${percentComplete}% complete — within ${PACE_TOLERANCE_POINTS} points.`;
    }
  }

  return {
    deliverableId,
    title,
    budgetAmount,
    percentComplete,
    billedToDate,
    spendToDate,
    actualToDate,
    draftedAmount,
    remaining,
    burnPercent,
    paceStatus,
    paceDetail,
  };
}

export function buildProjectBudgetSnapshot({
  project,
  deliverables,
  spendEntries,
  billedLines,
}: {
  project: ProjectBudgetLike | null | undefined;
  deliverables: DeliverableBudgetLike[] | null | undefined;
  spendEntries?: SpendEntryLike[] | null;
  billedLines?: BilledLineLike[] | null;
}): ProjectBudgetSnapshot {
  const deliverableRecords = deliverables ?? [];
  const spendRecords = spendEntries ?? [];
  const billedRecords = billedLines ?? [];

  const summaries = deliverableRecords.map((deliverable) =>
    buildDeliverableBudgetSummary(deliverable, spendRecords, billedRecords)
  );

  const knownDeliverableIds = new Set(
    summaries.map((summary) => summary.deliverableId).filter((id): id is string => id !== null)
  );

  // A billed line's only tie to this project (in this shape) is its
  // deliverable attribution. A line naming a deliverable this project does
  // not have cannot be attributed and is ignored — counting it would invent
  // burn. A line with NO deliverable is project-level billing and counts at
  // the project level only.
  const unknownBilledLines = billedRecords.filter(
    (line) => line.deliverable_id != null && !knownDeliverableIds.has(line.deliverable_id)
  );
  const attributableBilledLines = billedRecords.filter(
    (line) => line.deliverable_id == null || knownDeliverableIds.has(line.deliverable_id)
  );

  const billedToDate = sumAmounts(
    attributableBilledLines.filter((line) => isSentStatus(line.invoice_status)).map((line) => line.amount)
  );

  // Spend entries are rows of the project's own ledger (project_id-scoped in
  // the schema), so every entry counts at the project level even when its
  // deliverable attribution is missing or stale.
  const spendToDate = sumAmounts(spendRecords.map((entry) => entry.amount));
  const actualToDate = roundCurrency(billedToDate + spendToDate);

  const statedBudget = parseOptionalAmount(project?.budget_amount);
  const budgetedSummaries = summaries.filter((summary) => summary.budgetAmount !== null);
  const deliverableBudgetTotal =
    budgetedSummaries.length > 0
      ? roundCurrency(budgetedSummaries.reduce((total, summary) => total + (summary.budgetAmount ?? 0), 0))
      : null;

  const budgetCoverage: ProjectBudgetCoverage =
    budgetedSummaries.length === 0
      ? "none"
      : budgetedSummaries.length === summaries.length
        ? "complete"
        : "partial";

  const remainingAgainstStatedBudget = statedBudget === null ? null : roundCurrency(statedBudget - actualToDate);

  const attention: string[] = [];

  for (const summary of summaries) {
    if (summary.paceStatus === "over_budget" || summary.paceStatus === "billed_ahead_of_progress") {
      attention.push(`${summary.title ?? "Untitled deliverable"}: ${summary.paceDetail}`);
    }
  }

  if (statedBudget !== null && actualToDate > statedBudget) {
    attention.push(
      `Actual to date ${formatAmount(actualToDate)} exceeds the stated project budget ${formatAmount(statedBudget)}.`
    );
  }

  if (statedBudget !== null && deliverableBudgetTotal !== null && deliverableBudgetTotal > statedBudget) {
    attention.push(
      `Deliverable budgets total ${formatAmount(deliverableBudgetTotal)}, more than the stated project budget ${formatAmount(statedBudget)}.`
    );
  }

  if (budgetCoverage === "partial") {
    attention.push(
      `${budgetedSummaries.length} of ${summaries.length} deliverables have budgets — the deliverable budget total is a partial figure, not a project total.`
    );
  }

  if (unknownBilledLines.length > 0) {
    attention.push(
      unknownBilledLines.length === 1
        ? "1 billed line references deliverables outside this project and was ignored."
        : `${unknownBilledLines.length} billed lines reference deliverables outside this project and were ignored.`
    );
  }

  return {
    statedBudget,
    deliverableBudgetTotal,
    budgetCoverage,
    billedToDate,
    spendToDate,
    actualToDate,
    remainingAgainstStatedBudget,
    deliverables: summaries,
    attention,
  };
}
