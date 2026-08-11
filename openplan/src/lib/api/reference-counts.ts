import { createClient } from "@/lib/supabase/server";

type SupabaseClientLike = Pick<Awaited<ReturnType<typeof createClient>>, "from">;

export type ReferenceCountTarget = {
  table: string;
  column: string;
};

export type UnreadableReference = {
  table: string;
  message: string;
  code: string | null;
};

export type ReferenceCountResult = {
  /** table → row count, for every target that could be read. */
  counts: Record<string, number>;
  /**
   * Targets whose count could not be obtained. A table we cannot READ is not a
   * table that is EMPTY, and the difference decides whether a delete is safe.
   */
  unreadable: UnreadableReference[];
};

/**
 * How many rows in each target table point at `value`.
 *
 * The projection is `"*"`, always, and this is the only place that decision is
 * made — which is the entire reason this helper exists.
 *
 * `head: true` returns no rows, so the projection costs nothing at runtime. But
 * naming a column over a DYNAMIC table asserts that EVERY table in the list has
 * it, and two of the 33 relations that reference `projects` do not:
 * `data_dataset_project_links` is a pure join table and `aerial_project_posture`
 * is keyed by `project_id`. `.select("id", { count: "exact", head: true })`
 * therefore errored on those two, tripped the unreadable-table branch, and made
 * EVERY project delete answer 503.
 *
 * No unit test could see it. Supabase clients here are deliberately untyped, so
 * `.select()` strings are never checked against the schema, and a mocked client
 * returns whatever column it is asked for — the mock agreed with the code and
 * both were wrong. `reference-count-projection-guard.test.ts` now checks every
 * projection in the codebase against the columns the migrations declare.
 */
export async function countReferences(options: {
  supabase: SupabaseClientLike;
  targets: readonly ReferenceCountTarget[];
  value: string;
}): Promise<ReferenceCountResult> {
  const counts: Record<string, number> = {};
  const unreadable: UnreadableReference[] = [];

  await Promise.all(
    options.targets.map(async (target) => {
      const { count, error } = await options.supabase
        .from(target.table)
        .select("*", { count: "exact", head: true })
        .eq(target.column, options.value);

      if (error) {
        unreadable.push({
          table: target.table,
          message: error.message,
          code: error.code ?? null,
        });
        return;
      }

      counts[target.table] = count ?? 0;
    })
  );

  return { counts, unreadable };
}

/**
 * How many of a project's RTP placements are CONSTRAINED AND COSTED — the
 * filtered count `assessProjectDelete`'s severity rule needs (a priced line
 * item in a fiscally constrained programme reads as a commitment, an uncosted
 * candidate does not).
 *
 * Lives HERE, not in the route, for the same reason `countReferences` does:
 * `reference-count-projection-guard.test.ts` forbids the project-delete route
 * from owning any count of its own, so the projection decision keeps one home.
 * Same `"*"` + `head: true` shape as above.
 *
 * Returns null when the read failed — the caller degrades to the evidence
 * copy (the refusal itself does not depend on this count) and audits the
 * failure.
 */
export async function countConstrainedCostedPlacements(options: {
  supabase: SupabaseClientLike;
  projectId: string;
}): Promise<{ count: number | null; error: { message: string } | null }> {
  const { count, error } = await options.supabase
    .from("project_rtp_cycle_links")
    .select("*", { count: "exact", head: true })
    .eq("project_id", options.projectId)
    .eq("portfolio_role", "constrained")
    .not("estimated_cost", "is", null);

  if (error) {
    return { count: null, error: { message: error.message } };
  }
  return { count: count ?? 0, error: null };
}
