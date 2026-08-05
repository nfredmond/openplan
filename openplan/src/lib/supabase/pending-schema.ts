/**
 * ONE answer to "is this error an unapplied migration?"
 *
 * WHY IT LIVES HERE. This reads PostgREST error text and nothing else. It is not
 * page-voiced, so it does not belong beside `lib/ui/read-failures.ts`; it is not
 * transport-shaped, so it does not belong in `lib/http`. It belongs at the seam
 * where the database's own words arrive — `lib/supabase` — next to the clients
 * that produce them.
 *
 * WHAT WENT WRONG. Twenty local definitions of this function existed across
 * `src/`, in five different patterns, plus a further set of anonymous regexes
 * asking the same question inline. They disagreed with each other. The narrowest
 * — five API routes under `reports/` and `scenarios/` — matched only
 * `/column .* does not exist|schema cache/i`, so a MISSING TABLE was not a
 * pending migration there and fell through to a hard failure. The widest — the
 * projects page helper — also matched "could not find the … column". The same
 * database error was therefore an expected setup gap on one surface and a
 * server fault on another, and which one you got depended on nothing but where
 * you happened to be standing.
 *
 * The pattern below is the UNION of all five. Consolidating to the union rather
 * than to the intersection is a deliberate direction, and the trade-off is real:
 *
 * THE COST, STATED PLAINLY. Supabase clients in this repo are deliberately
 * untyped, so a `.select()` string is not checked against the schema. A TYPO'd
 * column name produces exactly the same `column … does not exist` message an
 * unapplied migration produces, and this function cannot tell them apart. Every
 * caller that widens to this union therefore converts a class of code defect
 * from a loud failure into a quiet "not available yet" — a degrade that reads
 * like a setup step and never resolves, because no migration will ever add a
 * column nobody meant to ask for.
 *
 * WHY THAT IS ACCEPTED ANYWAY. Under-classification is the direction that lies
 * to people. A narrow variant does not surface the truth; it renders a pending
 * migration as an ordinary read failure, and this product has already shipped
 * "No X yet" to the public twice on the strength of a failed read. Between a
 * degrade an operator can act on and a sentence that states something false
 * about an agency's work, the degrade wins.
 *
 * THE COMPENSATING CONTROL for the typo case is not this function — it is the
 * projection assertions (`public-engagement-page.test.tsx`, "asks the database
 * for the columns it renders"). Those catch a wrong `.select()` at test time,
 * which is where a code defect should be caught. Do not narrow this pattern to
 * chase the typo case; add the projection assertion instead.
 *
 * NOT EXPORTED: the regex itself. A caller holding the pattern can widen or
 * narrow it locally, which is how twenty copies happened. Ask the question
 * through the function or not at all.
 */

/**
 * Whether a database error message means "this deployment has not applied the
 * migration yet" rather than "something is wrong".
 *
 * Matches the five shapes PostgREST and Postgres actually produce for a missing
 * table or column, in either the database's wording or the schema cache's.
 * Deliberately does NOT match a permission failure, an expired token, or a
 * row-level security refusal: those are security-relevant outcomes, and dressing
 * one up as a friendly setup message would hide it from the only person who
 * could act on it.
 */
export function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|column .* does not exist|could not find the table|could not find the .* column|schema cache/i.test(
    message ?? ""
  );
}
