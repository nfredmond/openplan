import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import type { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * Compatibility re-export. `page.tsx` still has nine lanes that classify inline
 * rather than through `laneOutcome`, and pulls the predicate from here. Point
 * them at `@/lib/supabase/pending-schema` and delete this line.
 */
export { looksLikePendingSchema };

/**
 * Classify first, then collect what is left — in one call, for the ~20 read
 * lanes of the project control room.
 *
 * WHY THIS EXISTS. Every lane on that page was written as
 *
 *     const rows = looksLikePendingSchema(x.error?.message) ? [] : (x.data ?? []);
 *
 * which KEEPS the error and then throws it away. It answers exactly one
 * question — is this deployment behind a migration — and every other failure, a
 * revoked grant, a changed policy, a dropped connection, falls through into
 * `[]`. The panel then states that emptiness as a fact about the project: "No
 * milestones recorded yet", "No invoice records linked to this project yet". A
 * planner reading those re-enters work that already exists.
 *
 * The fix is not "stop classifying". A pending migration has a truer thing to
 * say than "could not be read", and saying it is why the classifier is there.
 * The fix is to classify FIRST and collect WHAT IS LEFT, which is one line when
 * it lives here and four lines repeated twenty times when it does not.
 *
 * THE LINE BUDGET IS A REAL REASON, NOT A TIDINESS ONE. `page.tsx` sits at the
 * 1200-line `max-lines` cap and the rule skips comments, so every lane fixed in
 * place had to buy its lines back from somewhere else in the file. That is a bad
 * trade to make twenty times.
 */

/** Only the `error` half is read, but a whole supabase-js result must be accepted. */
type ReadResultLike = { error?: { message?: string | null } | null; data?: unknown } | null | undefined;

/**
 * Register `result` as a failed read UNLESS the failure is a pending migration,
 * which the caller discloses in its own words.
 *
 * Returns whether the lane failed for a reason the page must disclose, so a
 * caller can branch its panel on the same call:
 *
 *     const milestonesFailed = collectUnlessPending(reads, "this project's milestones", milestoneResult);
 *
 * Rows still resolve to `[]` on failure at the call site, and that stays
 * correct: once the failure is disclosed the page is no longer presenting the
 * emptiness as an answer. Branch panels on the FLAG, never on emptiness.
 */
export function collectUnlessPending(
  reads: ReadFailureLog,
  label: string,
  result: ReadResultLike
): boolean {
  if (looksLikePendingSchema(result?.error?.message)) return false;
  return reads.check(label, result);
}

/**
 * Everything one lane's read establishes: its rows, and BOTH ways it can have
 * failed to produce them.
 *
 * `pending` and `failed` are mutually exclusive by construction — the classifier
 * owns the pending case and the collector takes what is left — so a caller can
 * branch on either without testing the error a second time and reaching a
 * different verdict than the page banner did.
 */
export type LaneReadOutcome = {
  rows: unknown[];
  /** The deployment is behind a migration: a known state with a named operator move. */
  pending: boolean;
  /** The read failed for anything else, and the page must disclose it. */
  failed: boolean;
};

/**
 * Collect the lane's failure and return its rows together with both
 * dispositions — the whole pattern in one call.
 *
 * This REPLACES the `looksLikePendingSchema(x.error) ? [] : (x.data ?? [])`
 * ternary rather than compensating for it: rows resolve to `[]` on any failure,
 * and the failure itself is disclosed, so the emptiness is no longer being
 * offered as an answer.
 *
 * `rows` is `unknown[]` and is cast at the call site, exactly as the code it
 * replaces did — this repo's Supabase clients are untyped by convention, so a
 * generic here would only move the cast, not earn one.
 */
export function laneOutcome(
  reads: ReadFailureLog,
  label: string,
  result: ReadResultLike
): LaneReadOutcome {
  const pending = looksLikePendingSchema(result?.error?.message);
  const failed = collectUnlessPending(reads, label, result);
  return { rows: (result?.data ?? []) as unknown[], pending, failed };
}

/**
 * The rows alone, for the lanes that need nothing else.
 *
 * Deliberately still the same signature and return type it always had: only
 * three of its nine call sites want a disposition flag, and widening it would
 * force the other six to destructure something they never read. It delegates to
 * `laneOutcome` so there is exactly ONE classify-then-collect path — two copies
 * would eventually disagree about what counts as pending.
 */
export function laneRows(reads: ReadFailureLog, label: string, result: ReadResultLike): unknown[] {
  return laneOutcome(reads, label, result).rows;
}
