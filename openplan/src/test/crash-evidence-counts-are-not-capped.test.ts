import { describe, expect, it } from "vitest";

import {
  loadSafetyCrashEvidence,
  readSafetyCrashEvidenceIngest,
  SAFETY_CRASH_EVIDENCE_COUNTS_RPC,
  type SafetyCrashEvidenceSupabaseLike,
} from "@/lib/safety/crash-evidence";

/**
 * A GROUPED COUNT MUST NOT STOP AT THE SERVER'S ROW CAP.
 *
 * MEASURED, NOT INFERRED. On 2026-08-14 a throwaway function returning 1,500
 * rows was called two ways against this deployment: psql returned 1,500, the
 * PostgREST endpoint returned exactly 1,000. **PostgREST caps a FUNCTION result
 * the same way it caps a table read.** The suspicion had been recorded as
 * unverified inference the day before; this settled it.
 *
 * WHY IT MATTERS HERE. `safety_crash_evidence_counts` returns one row per
 * (ingest, dimension, value) — about eleven per populated acquisition — and the
 * caller took whatever the single unpaged call handed back. Somewhere north of
 * ninety acquisitions in one workspace, bands would have started disappearing
 * from the RTP safety criterion, the BCA screening input, the grants board and
 * drafted grant narratives. Nothing on screen would have looked wrong. The
 * counts would just have been low, inside documents that go to funders.
 *
 * WHAT IS ASSERTED
 *   - every page is read, not just the first;
 *   - a page that fails makes the whole count UNREADABLE rather than partial,
 *     because a partial count rendered as a total is the defect being fixed;
 *   - a client with no `.range` still works, unpaged — the previous behaviour,
 *     so no existing caller is broken by this.
 *
 * The page size is deliberately not asserted: it is a request, and a server may
 * honour less. What is asserted is that a FULL page is always followed by
 * another request.
 */

type Row = { ingest_id: string; dimension: string; value: string; record_count: number };

/**
 * Filler rows for a page. They all name ONE real severity band, because the fold
 * maps into a fixed vocabulary — inventing band names would collapse into
 * "unknown" and prove nothing about which page they came from.
 */
function rows(n: number, ingestId: string): Row[] {
  return Array.from({ length: n }, () => ({
    ingest_id: ingestId,
    dimension: "severity",
    value: "injury",
    record_count: 1,
  }));
}

/** The row that only ever appears on the LAST page — the tail an unpaged read loses. */
function tailRow(ingestId: string): Row {
  return { ingest_id: ingestId, dimension: "severity", value: "fatal", record_count: 42 };
}

/** A client that serves a fixed list of pages and records what was asked for. */
function pagingClient(pages: Array<{ data: Row[] } | { error: unknown }>) {
  const ranges: Array<[number, number]> = [];
  let call = 0;
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      expect(name).toBe(SAFETY_CRASH_EVIDENCE_COUNTS_RPC);
      expect(args.p_ingest_ids).toBeTruthy();
      const builder = {
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          resolve({ data: pages[0] && "data" in pages[0] ? pages[0].data : [], error: null }),
        range: (from: number, to: number) => {
          ranges.push([from, to]);
          const page = pages[call] ?? { data: [] };
          call += 1;
          return Promise.resolve(
            "error" in page ? { data: null, error: page.error } : { data: page.data, error: null }
          );
        },
      };
      return builder as unknown as ReturnType<SafetyCrashEvidenceSupabaseLike["rpc"]>;
    },
  } as unknown as SafetyCrashEvidenceSupabaseLike;
  return { client, ranges, callCount: () => call };
}

/**
 * Built by the module's OWN reader from a row shaped like the database's, rather
 * than cast past the type. A hand-written fixture that satisfies the compiler
 * but not the reader proves nothing about what the loader receives in life.
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

describe("crash evidence counts are not capped at one page", () => {
  it("keeps asking while pages come back full, and folds every row", async () => {
    // Page size is whatever the module requests; serve a FULL first page by
    // discovering the size from the range it asks for.
    const probe = pagingClient([{ data: [] }]);
    await loadSafetyCrashEvidence(probe.client, "w1", [INGEST]);
    const pageSize = probe.ranges[0][1] - probe.ranges[0][0] + 1;
    expect(pageSize).toBeGreaterThan(0);

    const paged = pagingClient([{ data: rows(pageSize, INGEST.id) }, { data: [tailRow(INGEST.id)] }]);

    const evidence = await loadSafetyCrashEvidence(paged.client, "w1", [INGEST]);

    // Two requests: the full page, then the one that came back short.
    expect(paged.callCount()).toBe(2);
    expect(paged.ranges[1][0]).toBe(pageSize);

    const counts = evidence.get(INGEST.id)?.severityCounts;
    expect(counts).toBeTruthy();
    // Every band from BOTH pages survived the fold — the tail is the half that
    // the unpaged read used to lose.
    // The tail row is the one an unpaged read loses. Its presence, with its own
    // count, is the whole assertion.
    expect((counts as Record<string, number>).fatal).toBe(42);
  });

  it("treats a failed page as unreadable, never as a partial total", async () => {
    const probe = pagingClient([{ data: [] }]);
    await loadSafetyCrashEvidence(probe.client, "w1", [INGEST]);
    const pageSize = probe.ranges[0][1] - probe.ranges[0][0] + 1;

    const paged = pagingClient([
      { data: rows(pageSize, INGEST.id) },
      { error: { message: "connection reset" } },
    ]);

    const evidence = await loadSafetyCrashEvidence(paged.client, "w1", [INGEST]);

    // The first page's rows are real, and are still discarded: a count that is
    // missing its tail must not be rendered as the total.
    expect(evidence.get(INGEST.id)?.severityCounts).toBeNull();
  });

  it("still works against a client with no range support, unpaged", async () => {
    const client = {
      rpc: () =>
        ({
          then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
            resolve({ data: [tailRow(INGEST.id)], error: null }),
        }) as unknown as ReturnType<SafetyCrashEvidenceSupabaseLike["rpc"]>,
    } as unknown as SafetyCrashEvidenceSupabaseLike;

    const evidence = await loadSafetyCrashEvidence(client, "w1", [INGEST]);
    const counts = evidence.get(INGEST.id)?.severityCounts as Record<string, number>;
    expect(counts.fatal).toBe(42);
  });
});
