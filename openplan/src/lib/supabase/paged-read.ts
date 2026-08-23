/**
 * READ EVERY PAGE OF A CAPPED POSTGREST RESULT, OR SAY THE READ IS INCOMPLETE.
 *
 * PostgREST truncates every response at its own `max_rows` — 1000 on this
 * deployment's `supabase/config.toml`, operator-configurable on a self-host —
 * and it does so with `error = null`. A capped read is therefore
 * indistinguishable from a complete one at the call site: every honest-failure
 * guard passes, nothing looks wrong, and the number is simply low. In this
 * codebase those numbers end up in an RTP safety criterion, a BCA screening
 * input, a drafted grant narrative and a downloadable register — documents that
 * go to funders.
 *
 * MEASURED, NOT INFERRED: on 2026-08-14 a throwaway function returning 1,500
 * rows was called two ways against this deployment — psql returned 1,500, the
 * REST endpoint returned exactly 1,000. **A function result is capped exactly
 * like a table read.**
 *
 * This helper exists because the same loop was written three times and only one
 * of them was right. The safety crash export got it right; `crash-evidence.ts`
 * shipped a version that stops on a SHORT page; the whole engagement lane never
 * paged at all. Two rules separate the correct version from the plausible one,
 * and both are counter-intuitive enough that they were re-derived wrongly:
 *
 * 1. **Advance by what came back, and stop only on an EMPTY page.** The obvious
 *    condition — "stop when the page is shorter than the one I asked for" — is
 *    wrong in the SILENT direction. A server whose `max_rows` is below the
 *    requested page size returns a short FIRST page, so the loop ends
 *    immediately having dropped everything else while reporting success. One
 *    extra empty round-trip at the end buys correctness under any server cap.
 *
 * 2. **The caller must impose a stable TOTAL order.** `LIMIT`/`OFFSET` across
 *    separate HTTP requests has no defined row order without `ORDER BY`, so
 *    rows shift across page boundaries between requests — appearing twice or
 *    not at all. Where a caller sums what it reads, a duplicate silently
 *    inflates a total. Ordering on a non-unique column is not enough: ties need
 *    a unique tiebreak. This helper cannot check that, so
 *    `src/test/paged-reads-order-before-they-range.test.ts` does.
 *
 * The caller composes the query — including its ordering — and this owns only
 * the loop. `complete: false` is never merged with a partial result by this
 * module; it is returned so the caller can refuse to render a total, which is
 * the whole point. A partial count rendered as a total is the defect.
 */

/** What one page request must resolve to — the shape supabase-js already returns. */
export type PagedReadPage<Row, Err = { message: string }> = {
  data: Row[] | null;
  error: Err | null;
};

export type PagedReadResult<Row, Err = { message: string }> = {
  /** Every row read. Meaningless as a total unless `complete` is true. */
  rows: Row[];
  /**
   * True only when an empty page proved there was nothing more. False when a
   * page errored or the page ceiling was hit — in both cases `rows` holds a
   * PREFIX of the answer, and presenting it as a total is the defect this
   * module exists to prevent.
   */
  complete: boolean;
  /**
   * The server's own error object when a page failed, else null — passed
   * through rather than reduced to its message, because callers audit fields
   * beside it (PostgREST's `code`, which is what distinguishes a missing column
   * from a permission denial).
   */
  error: Err | null;
};

/** Rows requested per page. A request, never an assumption about what the server honours. */
export const DEFAULT_PAGED_READ_SIZE = 500;

/**
 * A defensive ceiling. Far past any real workspace; it stops a server that
 * ignores range headers from looping forever. Hitting it yields
 * `complete: false` — "I could not finish", never "there was no more".
 */
export const DEFAULT_PAGED_READ_MAX_PAGES = 200;

/**
 * Page through a read until it is exhausted.
 *
 * `fetchPage` receives an INCLUSIVE range, matching `.range(from, to)`, and must
 * apply a stable total order to the query it builds. Pass the same query builder
 * you would have called once, with `.order(...)` and `.range(from, to)` on the
 * end.
 */
export async function readEveryPage<Row, Err = { message: string }>(
  fetchPage: (from: number, toInclusive: number) => PromiseLike<PagedReadPage<Row, Err>>,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<PagedReadResult<Row, Err>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGED_READ_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_PAGED_READ_MAX_PAGES;

  const rows: Row[] = [];
  let from = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);

    if (error) {
      // The rows already gathered are deliberately DISCARDED. Returning a
      // prefix alongside an error invites a caller to use it, and a prefix used
      // as a total is exactly the silent undercount being prevented.
      return { rows: [], complete: false, error };
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    // Rule 1. Only an empty page proves exhaustion.
    if (batch.length === 0) return { rows, complete: true, error: null };

    from += batch.length;
  }

  // The ceiling was reached with rows still coming.
  return { rows, complete: false, error: null };
}
