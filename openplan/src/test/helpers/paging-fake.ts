/**
 * A FAKE `.range()` THAT ACTUALLY SLICES.
 *
 * The engagement and safety reads page, because PostgREST caps a response at
 * `max_rows` and reports no error while doing it. A test fake whose `.range()`
 * ignores its arguments and hands back the whole fixture models a server with
 * NO row cap — the one server on which a truncating read cannot be observed —
 * so a route that read only its first page would satisfy every assertion.
 *
 * This is the sixth fake that needed the same slicing, which is the point at
 * which writing it a seventh time is how the two implementations drift.
 *
 * The fixture is resolved ONCE per request and cached, so a terminal configured
 * with `mockResolvedValueOnce` is not drained by the second page — call
 * `reset()` between tests, the way `vi.clearAllMocks()` is called.
 */

export type FakePage = { data: unknown[] | null; error: unknown };

export type PagingFake = {
  /** Drop in where the query chain used to terminate. Supports repeated `.order()`. */
  chain: Record<string, unknown>;
  /** The `.range` mock itself, for asserting what was asked for. */
  range: (from: number, toInclusive: number) => Promise<FakePage>;
  /** Forget the cached fixture. Call from `beforeEach`. */
  reset: () => void;
};

/**
 * Build a chain that pages from a terminal fixture-getter.
 *
 * `readFixture` is whatever the file already used as its terminal — typically a
 * `vi.fn()` configured with `mockResolvedValue({ data, error })`.
 */
export function pagingFake(
  readFixture: () => unknown,
  options: { serverCap?: number } = {}
): PagingFake {
  let cached: Promise<{ data?: unknown[] | null; error?: unknown }> | null = null;

  const range = async (from: number, toInclusive: number): Promise<FakePage> => {
    cached ??= Promise.resolve(readFixture() as { data?: unknown[] | null; error?: unknown });
    const result = await cached;
    if (result?.error) return { data: null, error: result.error };
    const rows = (result?.data ?? []) as unknown[];
    const asked = toInclusive - from + 1;
    const allowed = Math.min(asked, options.serverCap ?? Number.POSITIVE_INFINITY);
    return { data: rows.slice(from, from + allowed), error: null };
  };

  const chain: Record<string, unknown> = { range };
  // Every builder method a caller might chain before `.range` returns the chain,
  // so the fake does not have to know how many `.order()`s a query applies.
  for (const method of ["select", "eq", "in", "order", "limit", "filter"]) {
    chain[method] = () => chain;
  }
  // THENABLE TOO. One table is often read by both a paged loader and an unpaged
  // one — the campaign detail page awaits the chain while its route pages the
  // same rows — and a chain that only answered `.range` would hang the awaiting
  // caller with an unresolved builder rather than fail loudly.
  chain.then = (
    resolve: (value: { data: unknown[] | null; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown
  ) =>
    Promise.resolve(readFixture() as { data?: unknown[] | null; error?: unknown })
      .then((result) => ({ data: (result?.data ?? []) as unknown[], error: result?.error ?? null }))
      .then(resolve, reject);

  return { chain, range, reset: () => (cached = null) };
}
