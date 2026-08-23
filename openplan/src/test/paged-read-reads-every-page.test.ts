import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGED_READ_SIZE,
  readEveryPage,
  type PagedReadPage,
} from "@/lib/supabase/paged-read";

/**
 * THE LOOP THAT THREE CALL SITES GOT DIFFERENTLY RIGHT.
 *
 * Each test here is a way a plausible implementation undercounts silently.
 * PostgREST caps responses with `error = null`, so none of these failures
 * announce themselves — the number is simply low, in a document that goes to a
 * funder.
 */

/** A server holding `total` rows that never returns more than `serverCap` at a time. */
function server(total: number, serverCap: number) {
  const asked: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number): Promise<PagedReadPage<number>> => {
    asked.push([from, to]);
    const requested = to - from + 1;
    const allowed = Math.min(requested, serverCap);
    const rows = Array.from({ length: total }, (_, i) => i).slice(from, from + allowed);
    return { data: rows, error: null };
  };
  return { fetchPage, asked };
}

describe("readEveryPage", () => {
  it("reads every row when the server cap is larger than the page size", async () => {
    const { fetchPage } = server(1200, 1000);
    const result = await readEveryPage(fetchPage);

    expect(result.complete).toBe(true);
    expect(result.rows).toHaveLength(1200);
    expect(result.rows[1199]).toBe(1199);
  });

  /*
    THE ONE THAT WAS SHIPPED WRONG. An operator lowers max-rows below the
    requested page size, so the FIRST page comes back short. An implementation
    that stops on a short page ends here, having read 250 of 1,200 rows and
    reporting success — the silent direction. `crash-evidence.ts` did exactly
    this, while its own docblock claimed correctness when an operator "raises or
    LOWERS max-rows".
  */
  it("keeps reading when the server cap is BELOW the page size", async () => {
    const { fetchPage, asked } = server(1200, 250);
    const result = await readEveryPage(fetchPage);

    expect(result.complete).toBe(true);
    expect(result.rows).toHaveLength(1200);
    // It advanced by what came back (250), not by what it asked for (500).
    expect(asked[1][0]).toBe(250);
  });

  it("asks one more time after a full page, so a total that lands on the boundary is not truncated", async () => {
    const exactlyOnePage = DEFAULT_PAGED_READ_SIZE;
    const { fetchPage, asked } = server(exactlyOnePage, 1000);
    const result = await readEveryPage(fetchPage);

    expect(result.rows).toHaveLength(exactlyOnePage);
    expect(result.complete).toBe(true);
    // The empty confirming request is the price of never stopping early.
    expect(asked).toHaveLength(2);
  });

  it("reports an errored page as incomplete and returns NO rows", async () => {
    let call = 0;
    const fetchPage = async (): Promise<PagedReadPage<number>> => {
      call += 1;
      if (call === 1) return { data: Array.from({ length: 500 }, (_, i) => i), error: null };
      return { data: null, error: { message: "permission denied" } };
    };

    const result = await readEveryPage(fetchPage);

    expect(result.complete).toBe(false);
    expect(result.error).toBe("permission denied");
    // Not the 500 it managed to read. A prefix offered beside an error gets used.
    expect(result.rows).toEqual([]);
  });

  it("treats the page ceiling as an unfinished read, never as exhaustion", async () => {
    const neverEnds = async (from: number): Promise<PagedReadPage<number>> => ({
      data: Array.from({ length: 10 }, (_, i) => from + i),
      error: null,
    });

    const result = await readEveryPage(neverEnds, { pageSize: 10, maxPages: 3 });

    expect(result.rows).toHaveLength(30);
    expect(result.complete).toBe(false);
    expect(result.error).toBeNull();
  });

  it("reports an immediately empty result as complete", async () => {
    const { fetchPage } = server(0, 1000);
    const result = await readEveryPage(fetchPage);

    expect(result.rows).toEqual([]);
    expect(result.complete).toBe(true);
  });
});
