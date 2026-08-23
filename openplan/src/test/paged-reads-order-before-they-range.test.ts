import { describe, expect, it } from "vitest";

import {
  loadSafetyCrashEvidence,
  readSafetyCrashEvidenceIngest,
  SAFETY_CRASH_EVIDENCE_COUNTS_RPC,
  SAFETY_CRASH_EVIDENCE_ORDER_COLUMNS,
  type SafetyCrashEvidenceSupabaseLike,
} from "@/lib/safety/crash-evidence";
import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";

/**
 * PAGING WITHOUT A STABLE TOTAL ORDER IS WORSE THAN NOT PAGING AT ALL.
 *
 * `LIMIT`/`OFFSET` across separate HTTP requests has no defined row order
 * unless the query names one. Between two page requests a concurrent write —
 * or, for a set-returning function, nothing more than the planner's discretion
 * — can shift a row across the boundary, so it is returned twice or never.
 *
 * That is not a wash. `foldCrashEvidenceCounts` SUMS what it reads, so a
 * duplicated row inflates a severity band, and the inflated number is what
 * reaches the RTP safety criterion, the BCA screening input and drafted grant
 * narratives. An unpaged read at least fails in one direction only.
 *
 * `safety_crash_evidence_counts` is a UNION ALL of two GROUP BYs with no ORDER
 * BY of its own (migration 20260812000003), so the ordering must be imposed by
 * the caller — which means it is a property of TypeScript that no migration
 * test can see, and of the migration that no unit test can see. This file is
 * where the two are checked against each other.
 */

const INGEST = readSafetyCrashEvidenceIngest({
  id: "11111111-1111-4111-8111-111111111111",
  project_id: null,
  status: "succeeded",
  source_label: "Example source",
  attribution: null,
  severity_completeness: "complete",
  crash_count: 10,
  geocoded_count: 10,
  truncated: false,
  years_requested: [2023],
  created_at: "2026-01-01T00:00:00.000Z",
  dimension_coverage: null,
})!;

/** A builder that records the order in which `.order` and `.range` are applied. */
function orderingClient() {
  const steps: string[] = [];
  const client = {
    rpc(name: string, _args: Record<string, unknown>) {
      expect(name).toBe(SAFETY_CRASH_EVIDENCE_COUNTS_RPC);
      const builder = {
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          resolve({ data: [], error: null }),
        order(column: string) {
          // The DIRECTION is deliberately not recorded. Ascending or descending
          // is equally a total order, and paging is correct either way as long
          // as every page asks for the same one — which one code path
          // guarantees. Asserting direction would pin an implementation detail
          // and fail a harmless change; it was tried, and flipping to
          // descending killed the test while breaking nothing.
          steps.push(`order:${column}`);
          return builder;
        },
        range(from: number, to: number) {
          steps.push(`range:${from}-${to}`);
          return Promise.resolve({ data: [], error: null });
        },
      };
      return builder as unknown as ReturnType<SafetyCrashEvidenceSupabaseLike["rpc"]>;
    },
  };
  return { client: client as unknown as SafetyCrashEvidenceSupabaseLike, steps };
}

describe("a paged read orders before it ranges", () => {
  it("applies every order column before asking for a range", async () => {
    const { client, steps } = orderingClient();

    await loadSafetyCrashEvidence(client, "w1", [INGEST]);

    const orders = steps.filter((step) => step.startsWith("order:"));
    const firstRange = steps.findIndex((step) => step.startsWith("range:"));

    expect(orders).toEqual(SAFETY_CRASH_EVIDENCE_ORDER_COLUMNS.map((column) => `order:${column}`));
    expect(firstRange).toBeGreaterThan(-1);
    // Every ordering step precedes the first range request.
    expect(steps.slice(0, firstRange).every((step) => step.startsWith("order:"))).toBe(true);
  });

  /*
    The ordering is only a TOTAL order if it names every column that can differ
    between two rows. `record_count` is the aggregate — the measure, not part of
    the key — so the order must cover exactly the rest of the function's
    RETURNS TABLE. Add a dimension column to the RPC and forget to order by it,
    and this fails rather than quietly reintroducing ties for rows to slip
    across.
  */
  it("orders by every non-aggregate column the RPC returns", () => {
    const migration = migrationFiles().find((name) =>
      blankComments(readMigration(name)).includes(`FUNCTION public.${SAFETY_CRASH_EVIDENCE_COUNTS_RPC}`)
    );
    expect(migration, `no migration defines ${SAFETY_CRASH_EVIDENCE_COUNTS_RPC}`).toBeTruthy();

    const sql = blankComments(readMigration(migration as string));
    const returns = sql
      .slice(sql.indexOf(`FUNCTION public.${SAFETY_CRASH_EVIDENCE_COUNTS_RPC}`))
      .match(/RETURNS\s+TABLE\s*\(([^)]*)\)/i);
    expect(returns, "could not read the function's RETURNS TABLE").toBeTruthy();

    const returnedColumns = (returns as RegExpMatchArray)[1]
      .split(",")
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean);

    expect(returnedColumns).toContain("record_count");
    const keyColumns = returnedColumns.filter((column) => column !== "record_count");

    expect([...SAFETY_CRASH_EVIDENCE_ORDER_COLUMNS].sort()).toEqual(keyColumns.sort());
  });
});
