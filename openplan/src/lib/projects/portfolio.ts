/**
 * The portfolio table's shaping — one row per project, from the batched lanes
 * `./portfolio-queries.ts` read.
 *
 * PURE. No I/O and no clock of its own (the caller passes `now`), so every rule
 * below is testable by calling a function.
 *
 * WHY A TABLE AT ALL, ABOVE THE CARDS THAT ALREADY EXIST. The /projects cards
 * answer "what is this project and what does its report packet need next"; they
 * cannot answer "which of my fourteen projects is closest to a cliff", because
 * that question is comparative and a card list is not. The table is that view,
 * and the cards stay: nothing about them was wrong.
 *
 * ── EVERY COLUMN CARRIES THE OUTCOME OF THE LANES IT DEPENDS ON.
 *
 * This is the design decision worth stating twice. A summary table is the single
 * easiest place in a product to state a falsehood, because each cell is one
 * short value with no room for a caveat: an unreadable deliverables lane renders
 * as "0 overdue" beside a project that is months late, and a truncated read
 * renders the same way. So no cell is computed from a lane that did not answer.
 * A column whose lanes are pending, failed, or truncated is `available: false`
 * and carries the planner-voiced REASON, which the table renders as "—" with the
 * sentence attached. `laneAnswered` is the one predicate that decides this, so a
 * new column cannot accidentally invent a third rule.
 *
 * ── BURN, AND WHY THE DENOMINATOR IS THE HARD PART.
 *
 * Burn is `actual ÷ budget`, and `actual` is not the risk — it is a sum of rows.
 * The risk is the denominator, because a PARTIAL budget total presented as a
 * project total makes a project look comfortable exactly when it is not: five
 * deliverables, two of them budgeted, and the burn percentage silently measures
 * spending against 40% of the plan.
 *
 * So a basis is used only when it is a COMPLETE one:
 *
 *   1. `projects.budget_amount`, when a planner has entered it. It is the whole
 *      project's not-to-exceed figure by construction, so deliverable coverage
 *      does not change what it means. This is also what the project detail page
 *      measures against (`remainingAgainstStatedBudget`), and a portfolio table
 *      that refused a number the project's own page shows would read as a bug.
 *   2. Otherwise the sum of deliverable budgets, and ONLY when
 *      `budgetCoverage === "complete"` — every deliverable carries one.
 *
 * Anything else renders "—" with the reason, never a percentage. `coverage` is
 * returned alongside either way, so the table can flag a project whose
 * deliverable budgets are patchy even when a stated budget makes the percentage
 * itself sound. (Recorded divergence from the 2026-08-11 memo, which said burn
 * renders "—" unless coverage is complete: that rule is kept exactly for basis 2
 * and relaxed for basis 1, because a stated project budget IS complete coverage
 * of the project, and refusing it would put the portfolio table in disagreement
 * with the project page over the same money.)
 *
 * NOTHING HERE EXTRAPOLATES. No run-rate, no projected completion, no
 * estimate-at-complete — the same refusal `buildProjectBudgetSnapshot` makes,
 * whose arithmetic this module calls rather than re-implements.
 */

import {
  buildProjectBudgetSnapshot,
  type ProjectBudgetCoverage,
} from "@/lib/projects/budget";
import {
  laneAnswered,
  type PortfolioLaneOutcome,
  type ProjectPortfolioInputs,
} from "@/lib/projects/portfolio-queries";
import {
  CLOSED_DELIVERABLE_STATUS,
  CLOSED_MILESTONE_STATUS,
  CLOSED_SUBMITTAL_STATUS,
  isDeadlinePast,
} from "@/lib/work/deadlines";

/** The project facts the table shows that the page already has in hand. */
export type PortfolioProjectFacts = {
  id: string;
  name: string;
  status: string;
  deliveryPhase: string;
  updatedAt: string;
};

export type PortfolioDeadlineKind = "deliverable" | "milestone" | "submittal";

export type PortfolioNextDeadline = {
  kind: PortfolioDeadlineKind;
  title: string;
  dueOn: string;
  isOverdue: boolean;
};

export type PortfolioDeadlineColumn = {
  available: boolean;
  /** Planner-voiced, non-null exactly when `available` is false. */
  unavailableReason: string | null;
  next: PortfolioNextDeadline | null;
  openDatedCount: number;
  overdueCount: number;
};

export type PortfolioBurnBasis = "stated_budget" | "deliverable_budgets";

export type PortfolioBurnColumn = {
  available: boolean;
  unavailableReason: string | null;
  burnPercent: number | null;
  actualToDate: number | null;
  budgetAmount: number | null;
  basis: PortfolioBurnBasis | null;
  /**
   * Deliverable-budget coverage, whenever the deliverables lane answered —
   * including when a stated budget carried the percentage. It is what lets the
   * table flag "this number is sound, the deliverable budgets under it are not".
   */
  coverage: ProjectBudgetCoverage | null;
};

export type ProjectPortfolioRow = PortfolioProjectFacts & {
  deadlines: PortfolioDeadlineColumn;
  burn: PortfolioBurnColumn;
};

export type ProjectPortfolioSummary = {
  rows: ProjectPortfolioRow[];
  /** Sentences the table prints about its own limits. Empty when it has none. */
  disclosures: string[];
};

/** Why a lane could not answer, in a planner's words rather than a database's. */
function laneReason(outcome: PortfolioLaneOutcome | undefined, subject: string): string | null {
  // ONE predicate decides whether a lane may be used, so a new column cannot
  // invent a third rule; the branches below only choose the wording.
  if (laneAnswered(outcome)) return null;
  if (!outcome) return `${subject} were not read.`;
  if (outcome.pending) {
    return `${subject} are not available on this deployment yet — a migration has not been applied. This is not a finding that there are none.`;
  }
  if (outcome.failed) {
    return `${subject} could not be read, so this is unavailable rather than zero.`;
  }
  if (outcome.truncated) {
    return `${subject} were read up to this page's row cap, so a per-project figure cannot be stated. Open the project for its own totals.`;
  }
  return null;
}

/** The first reason among several lanes, or null when all of them answered. */
function firstReason(reasons: Array<string | null>): string | null {
  return reasons.find((reason): reason is string => Boolean(reason)) ?? null;
}

type DatedCandidate = { kind: PortfolioDeadlineKind; title: string; dueOn: string };

function buildDeadlineColumn(
  inputs: ProjectPortfolioInputs,
  projectId: string,
  now: Date
): PortfolioDeadlineColumn {
  const reason = firstReason([
    laneReason(inputs.deliverables.outcome, "This workspace's deliverables"),
    laneReason(inputs.milestones.outcome, "This workspace's milestones"),
    laneReason(inputs.submittals.outcome, "This workspace's submittals"),
  ]);

  // ALL THREE OR NONE. A "next deadline" computed from two of three lanes is
  // not a smaller answer, it is a wrong one: the true next item may be the one
  // in the lane that failed, and the cell has no room to say so.
  if (reason) {
    return { available: false, unavailableReason: reason, next: null, openDatedCount: 0, overdueCount: 0 };
  }

  const candidates: DatedCandidate[] = [];

  for (const row of inputs.deliverables.byProjectId.get(projectId) ?? []) {
    if (row.status === CLOSED_DELIVERABLE_STATUS || !row.due_date) continue;
    candidates.push({ kind: "deliverable", title: row.title ?? "(untitled deliverable)", dueOn: row.due_date });
  }
  for (const row of inputs.milestones.byProjectId.get(projectId) ?? []) {
    if (row.status === CLOSED_MILESTONE_STATUS || !row.target_date) continue;
    candidates.push({ kind: "milestone", title: row.title ?? "(untitled milestone)", dueOn: row.target_date });
  }
  for (const row of inputs.submittals.byProjectId.get(projectId) ?? []) {
    if (row.status === CLOSED_SUBMITTAL_STATUS || !row.due_date) continue;
    candidates.push({ kind: "submittal", title: row.title ?? "(untitled submittal)", dueOn: row.due_date });
  }

  const sorted = [...candidates].sort(
    (left, right) => new Date(left.dueOn).getTime() - new Date(right.dueOn).getTime()
  );
  const overdueCount = sorted.filter((item) => isDeadlinePast(item.dueOn, now)).length;
  const first = sorted[0] ?? null;

  return {
    available: true,
    unavailableReason: null,
    // SOONEST, NOT OVERDUE-FIRST. The queue on /my-work sorts overdue to the
    // top because a person works it top-down; one cell showing "next" means the
    // next date on the calendar, and re-ordering it would make a project with an
    // old miss appear to have nothing coming up.
    next: first ? { ...first, isOverdue: isDeadlinePast(first.dueOn, now) } : null,
    openDatedCount: sorted.length,
    overdueCount,
  };
}

function unavailableBurn(reason: string, coverage: ProjectBudgetCoverage | null): PortfolioBurnColumn {
  return {
    available: false,
    unavailableReason: reason,
    burnPercent: null,
    actualToDate: null,
    budgetAmount: null,
    basis: null,
    coverage,
  };
}

function buildBurnColumn(inputs: ProjectPortfolioInputs, projectId: string): PortfolioBurnColumn {
  const reason = firstReason([
    laneReason(inputs.projectBudgets.outcome, "Project budgets"),
    laneReason(inputs.deliverables.outcome, "This workspace's deliverables"),
    laneReason(inputs.spendEntries.outcome, "This workspace's direct spend ledgers"),
    laneReason(inputs.billedLines.outcome, "Client invoices billed to these projects"),
  ]);
  if (reason) return unavailableBurn(reason, null);

  if (inputs.deliverableBudgetColumnsPending) {
    return unavailableBurn(
      "Deliverable budgets are not available on this deployment yet — a migration has not been applied. This is not a finding that no budgets were entered.",
      null
    );
  }

  const deliverables = inputs.deliverables.byProjectId.get(projectId) ?? [];
  const snapshot = buildProjectBudgetSnapshot({
    project: { budget_amount: inputs.projectBudgets.byProjectId.get(projectId)?.[0]?.budget_amount ?? null },
    deliverables,
    spendEntries: inputs.spendEntries.byProjectId.get(projectId) ?? [],
    billedLines: inputs.billedLines.byProjectId.get(projectId) ?? [],
  });

  const coverage = snapshot.budgetCoverage;
  const statedBudget = snapshot.statedBudget;

  const basisAmount =
    statedBudget !== null && statedBudget > 0
      ? { amount: statedBudget, basis: "stated_budget" as const }
      : coverage === "complete" && snapshot.deliverableBudgetTotal !== null && snapshot.deliverableBudgetTotal > 0
        ? { amount: snapshot.deliverableBudgetTotal, basis: "deliverable_budgets" as const }
        : null;

  if (!basisAmount) {
    const detail =
      coverage === "partial"
        ? "Some of this project's deliverables carry a budget and some do not, so their total is a partial figure rather than a project budget. Enter a project budget, or budget the remaining deliverables."
        : "No project budget is entered and no deliverable carries one, so there is nothing to measure spending against.";
    return unavailableBurn(detail, coverage);
  }

  return {
    available: true,
    unavailableReason: null,
    burnPercent: Math.round((snapshot.actualToDate / basisAmount.amount) * 10000) / 100,
    actualToDate: snapshot.actualToDate,
    budgetAmount: basisAmount.amount,
    basis: basisAmount.basis,
    coverage,
  };
}

export const PORTFOLIO_BURN_BASIS_LABELS: Record<PortfolioBurnBasis, string> = {
  stated_budget: "of the project budget",
  deliverable_budgets: "of the deliverable budgets",
};

/**
 * One row per project, in the order the caller listed them.
 *
 * Projects the batch did not cover are simply absent — the caller capped the
 * list, and `describePortfolioDisclosures` is what says so on screen.
 */
export function buildProjectPortfolioSummary({
  projects,
  inputs,
  now,
}: {
  projects: readonly PortfolioProjectFacts[];
  inputs: ProjectPortfolioInputs;
  now: Date;
}): ProjectPortfolioSummary {
  const covered = new Set(inputs.projectIds);
  const rows = projects
    .filter((project) => covered.has(project.id))
    .map((project) => ({
      ...project,
      deadlines: buildDeadlineColumn(inputs, project.id, now),
      burn: buildBurnColumn(inputs, project.id),
    }));

  return {
    rows,
    disclosures: describePortfolioDisclosures(inputs, rows.length),
  };
}

/**
 * What the table says about its own limits — the caps, in the plain terms a
 * planner can act on.
 *
 * A cap that binds silently is the same defect as a failed read rendered as
 * zero: the reader has no way to know the summary is partial. So both caps
 * announce themselves, and only when they actually bind.
 */
export function describePortfolioDisclosures(
  inputs: ProjectPortfolioInputs,
  renderedRowCount: number
): string[] {
  const disclosures: string[] = [];

  if (inputs.projectsTruncated) {
    disclosures.push(
      `This table summarizes the ${renderedRowCount} most recently updated projects. Every project is still listed below.`
    );
  }

  const truncatedLanes = Object.entries({
    deliverables: inputs.deliverables.outcome,
    milestones: inputs.milestones.outcome,
    submittals: inputs.submittals.outcome,
    "spend ledgers": inputs.spendEntries.outcome,
    "client invoices": inputs.billedLines.outcome,
  })
    .filter(([, outcome]) => outcome.truncated)
    .map(([label]) => label);

  if (truncatedLanes.length > 0) {
    disclosures.push(
      `This workspace has more ${truncatedLanes.join(", ")} than one page can summarize (${inputs.rowLimitPerLane} rows each), so the affected columns show “—” rather than a figure that could be wrong. Open a project for its own totals.`
    );
  }

  return disclosures;
}
