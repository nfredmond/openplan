/**
 * A tiny in-memory stand-in for the three GTFS tables a corridor read touches,
 * WITH THE FILTERS ACTUALLY APPLIED.
 *
 * The point is that a read which forgets a filter gets the WRONG ROWS rather
 * than the fixture. A double that answers the same rows however it is queried
 * cannot tell "filtered on the workspace" from "did not", which is the exact
 * assertion the service-role reads in this lane need — there is no RLS behind a
 * service-role client, so the `.eq()` chain IS the access control.
 *
 * The projection is applied too, for the same reason in a different direction:
 * PostgREST returns only the columns asked for, so a projection missing a column
 * renders `undefined` at runtime while every assertion over a permissive double
 * stays green. Here, dropping a column from `GTFS_CORRIDOR_STOP_COLUMNS` really
 * does remove it from the rows the adapter sees.
 */

import type { QueryResponse, RecordedQuery } from "./fake-supabase-query-recorder";

export type Row = Record<string, unknown>;

function matchesOps(row: Row, query: RecordedQuery): boolean {
  for (const op of query.ops) {
    const column = op.args[0];
    if (typeof column !== "string") continue;
    const value = row[column];
    switch (op.verb) {
      case "eq":
        if (value !== op.args[1]) return false;
        break;
      case "in":
        if (!Array.isArray(op.args[1]) || !(op.args[1] as unknown[]).includes(value)) return false;
        break;
      case "gte":
        if (!(typeof value === "number" && value >= (op.args[1] as number))) return false;
        break;
      case "lte":
        if (!(typeof value === "number" && value <= (op.args[1] as number))) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

function applyOrder(rows: Row[], query: RecordedQuery): Row[] {
  const orders = query.ops.filter((op) => op.verb === "order");
  if (orders.length === 0) return rows;

  // Applied last-key-first so the FIRST `.order()` in the chain is the primary
  // sort, which is how PostgREST reads them.
  const sorted = [...rows];
  for (const order of [...orders].reverse()) {
    const column = order.args[0] as string;
    const ascending = (order.args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
    sorted.sort((left, right) => {
      const a = left[column];
      const b = right[column];
      if (a === b) return 0;
      const direction = (a as number | string) > (b as number | string) ? 1 : -1;
      return ascending ? direction : -direction;
    });
  }
  return sorted;
}

function applyWindow(rows: Row[], query: RecordedQuery): Row[] {
  const range = query.ops.find((op) => op.verb === "range");
  if (range) {
    const from = range.args[0] as number;
    const to = range.args[1] as number;
    return rows.slice(from, to + 1);
  }
  const limit = query.ops.find((op) => op.verb === "limit");
  if (limit) return rows.slice(0, limit.args[0] as number);
  return rows;
}

function project(rows: Row[], projection: string | null): Row[] {
  if (!projection) return rows;
  const columns = projection.split(",").map((column) => column.trim()).filter(Boolean);
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
}

/**
 * Answer a recorded query out of a table map, honouring filters, ordering,
 * windowing and the projection.
 */
export function answerFromTables(tables: Record<string, Row[]>) {
  return (query: RecordedQuery): QueryResponse => {
    const rows = tables[query.table];
    if (!rows) return { data: null, error: { message: `no such table: ${query.table}` } };
    const matched = rows.filter((row) => matchesOps(row, query));
    return { data: project(applyWindow(applyOrder(matched, query), query), query.projection), error: null };
  };
}
