import type { ReadFailureLog } from "@/lib/ui/read-failures";

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

/**
 * Does this message mean the deployment is behind a migration, rather than that
 * something is wrong?
 *
 * NOTE FOR WHOEVER CONSOLIDATES THIS. Five copies of this predicate exist in the
 * repo and THEY DISAGREE. `lib/models/run-launch.ts`,
 * `lib/workspaces/membership.ts` and the invoicing helpers match three patterns;
 * `rtp/_components/_packet-state.ts` adds `column ... does not exist`; this one
 * adds that plus `could not find the ... column`. So the same missing-column
 * error is an expected pending migration on two pages and a hard read failure on
 * three others.
 *
 * That is an inconsistency, not an active lie — the narrow versions
 * UNDER-classify, which surfaces a migration gap as a plain read failure, and
 * erring that way is the safe direction. Consolidating them would change
 * behaviour on three pages, so it wants its own change with its own evidence.
 * This copy preserves the projects page's existing behaviour exactly.
 */
export function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|column .* does not exist|could not find the table|could not find the .* column|schema cache/i.test(
    message ?? ""
  );
}

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
 * Collect the lane's failure and return its rows — the whole pattern in one
 * call, which is what most lanes actually want.
 *
 * This REPLACES the `looksLikePendingSchema(x.error) ? [] : (x.data ?? [])`
 * ternary rather than compensating for it: rows resolve to `[]` on any failure,
 * and the failure itself is disclosed, so the emptiness is no longer being
 * offered as an answer. Callers that need to branch a panel keep using
 * `collectUnlessPending` for the flag.
 *
 * Returns `unknown[]` and is cast at the call site, exactly as the code it
 * replaces did — this repo's Supabase clients are untyped by convention, so a
 * generic here would only move the cast, not earn one.
 */
export function laneRows(reads: ReadFailureLog, label: string, result: ReadResultLike): unknown[] {
  collectUnlessPending(reads, label, result);
  return (result?.data ?? []) as unknown[];
}
