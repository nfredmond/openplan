/**
 * A Supabase double that RECORDS THE CHAIN, because the chain is the thing under
 * test.
 *
 * The clients in this repository are deliberately untyped and the service-role
 * client has no RLS behind it, so on a service-role read the `.eq()` chain IS
 * the access control. A double that answers a fixture regardless of what was
 * asked proves none of that: it returns the same rows whether the caller filtered
 * on the workspace or not, whether it asked for the columns it renders or not,
 * and whether it applied a status predicate or not. Every one of those has
 * shipped in this repository at least once.
 *
 * So this records `from(table)`, the projection string, and every filter verb
 * with its arguments, and hands the whole shape to the responder — which can then
 * answer differently depending on what was actually asked, and which the test can
 * assert against afterwards.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type RecordedOp = { verb: string; args: unknown[] };

export type RecordedQuery = {
  table: string;
  /** The `.select()` argument, or null when the caller never projected. */
  projection: string | null;
  ops: RecordedOp[];
};

/** Every `.eq()` on a recorded query, as `column -> value`. */
export function equalityFilters(query: RecordedQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const op of query.ops) {
    if (op.verb === "eq" && typeof op.args[0] === "string") filters[op.args[0]] = op.args[1];
  }
  return filters;
}

export type QueryResponse = { data: unknown; error: unknown };

const CHAIN_VERBS = ["eq", "neq", "in", "gt", "gte", "lt", "lte", "order", "limit", "range", "not", "is"];

export function createRecordingSupabase(respond: (query: RecordedQuery) => QueryResponse): {
  client: SupabaseClient;
  queries: RecordedQuery[];
  queriesFor: (table: string) => RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];

  const from = (table: string) => {
    const query: RecordedQuery = { table, projection: null, ops: [] };
    queries.push(query);

    // Thenable rather than a Promise: a PostgREST builder is awaited at the end
    // of the chain, and the chain must stay mutable until then.
    const builder: Record<string, unknown> = {
      select(projection?: string) {
        query.projection = typeof projection === "string" ? projection : null;
        return builder;
      },
      then(onFulfilled: (value: QueryResponse) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve()
          .then(() => respond(query))
          .then(onFulfilled, onRejected);
      },
    };

    for (const verb of CHAIN_VERBS) {
      builder[verb] = (...args: unknown[]) => {
        query.ops.push({ verb, args });
        return builder;
      };
    }

    return builder;
  };

  return {
    client: { from } as unknown as SupabaseClient,
    queries,
    queriesFor: (table: string) => queries.filter((query) => query.table === table),
  };
}
