/**
 * Parsing a money column that may simply not have been filled in.
 *
 * Extracted rather than copied. It lived privately inside
 * `src/lib/projects/budget.ts`, and the fiscal-constraint check needs exactly
 * the same semantics — so under the rule that a shared capability living
 * inside one of its callers gets reimplemented wrongly by the next one, it
 * moves here and both import it.
 *
 * THE SEMANTICS ARE THE WHOLE POINT: absent is NOT zero. `funding.ts`'s
 * `toNumber` returns 0 for an absent or unparseable value, which is survivable
 * for an award (no award really is $0 committed) and is why `hasTargetNeed`
 * guards it. It is not survivable for a cost total: a plan with twelve of
 * forty projects unpriced would sum to a figure that looks complete and report
 * itself fiscally constrained — on the one number a funder verifies. Null
 * propagates so the caller has to decide what to say about it.
 *
 * Negative is also null rather than a negative number: a negative cost or
 * revenue is not a smaller amount, it is a data-entry error, and treating it
 * as arithmetic silently offsets a real figure elsewhere in the same total.
 */
export function parseOptionalAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
