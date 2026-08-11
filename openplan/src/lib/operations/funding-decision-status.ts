/**
 * THE ONE deadline convention for funding opportunities — shared by the
 * workspace operations summary (`workspace-summary.ts`) and the assistant
 * grants module lane (`assistant/context.ts`).
 *
 * Why this module exists (2026-08-11): `funding_opportunities.decision_state`
 * is TEXT NOT NULL DEFAULT 'monitor' (migration 20260410000042; vocabulary
 * expanded to monitor/pursue/under_review/awarded/denied/skip in
 * 20260418000056), so `!row.decision_state` is not a row the schema can
 * produce. The assistant grants lane keyed its "undecided" and "overdue
 * decision" counters on exactly that, which made both permanently 0 in
 * production, while the workspace summary correctly keyed on
 * `decision_state === 'monitor'`. The two surfaces also disagreed on the
 * closing-soon window (30 days vs 14). Extracting the predicates here makes
 * the divergence impossible rather than merely fixed.
 *
 * "Awaiting a decision" means: an open or upcoming opportunity still marked
 * 'monitor' — nobody has made the pursue-or-skip call yet. It never means a
 * null decision_state.
 */

export const FUNDING_CLOSING_SOON_WINDOW_DAYS = 14;

const PENDING_DECISION_OPPORTUNITY_STATUSES: readonly string[] = ["open", "upcoming"];

export type FundingOpportunityDeadlineFacts = {
  opportunityStatus?: string | null;
  decisionState?: string | null;
  closesAt?: string | null;
  decisionDueAt?: string | null;
};

export function fundingDaysUntil(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 86400000);
}

/** An open or upcoming opportunity still marked 'monitor' — the pursue-or-skip call has not been made. */
export function isPendingFundingDecision(
  facts: Pick<FundingOpportunityDeadlineFacts, "opportunityStatus" | "decisionState">
): boolean {
  if (!PENDING_DECISION_OPPORTUNITY_STATUSES.includes(facts.opportunityStatus ?? "")) return false;
  return (facts.decisionState ?? "") === "monitor";
}

/** A pending decision whose recorded decision_due_at has already passed. */
export function isOverdueFundingDecision(
  facts: Pick<FundingOpportunityDeadlineFacts, "opportunityStatus" | "decisionState" | "decisionDueAt">,
  now: Date
): boolean {
  if (!isPendingFundingDecision(facts)) return false;
  const days = fundingDaysUntil(facts.decisionDueAt, now);
  return days !== null && days < 0;
}

/** An open opportunity whose close (or, failing that, decision due date) falls within the shared window. */
export function isClosingSoonFundingOpportunity(
  facts: Pick<FundingOpportunityDeadlineFacts, "opportunityStatus" | "closesAt" | "decisionDueAt">,
  now: Date
): boolean {
  if ((facts.opportunityStatus ?? "") !== "open") return false;
  const days = fundingDaysUntil(facts.closesAt ?? facts.decisionDueAt, now);
  return days !== null && days <= FUNDING_CLOSING_SOON_WINDOW_DAYS;
}
