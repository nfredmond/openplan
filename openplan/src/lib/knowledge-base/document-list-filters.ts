/**
 * How the Documents list is narrowed: by name, by when it was added, and in
 * which order.
 *
 * WHY THIS IS A SERVER-SIDE FILTER, not a client-side one over the loaded page.
 * The list is capped (`KB_DOCUMENT_LIST_LIMIT`), so a planner whose workspace
 * holds more documents than the cap has documents that are not on the page at
 * all. Filtering the rows already in the browser would keep exactly those
 * documents unfindable — the very failure this exists to fix. Every helper here
 * is pure so the route can be tested without a database.
 */

/**
 * How many rows one list read returns. The page and the list route share this
 * number so the sentence the planner reads about the cap and the cap itself
 * cannot drift apart.
 */
export const KB_DOCUMENT_LIST_LIMIT = 200;

export type KbDocumentSort = "newest" | "oldest" | "title";

export const KB_DOCUMENT_SORTS: readonly KbDocumentSort[] = ["newest", "oldest", "title"];

/** The planner-facing name of each order, used by the control and by tests. */
export const KB_DOCUMENT_SORT_LABELS: Record<KbDocumentSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Name (A–Z)",
};

export function isKbDocumentSort(value: unknown): value is KbDocumentSort {
  return typeof value === "string" && (KB_DOCUMENT_SORTS as readonly string[]).includes(value);
}

/** Which column and direction each order means, in one place. */
export function resolveKbDocumentOrder(sort: KbDocumentSort): {
  column: "created_at" | "title";
  ascending: boolean;
} {
  if (sort === "oldest") return { column: "created_at", ascending: true };
  if (sort === "title") return { column: "title", ascending: true };
  return { column: "created_at", ascending: false };
}

/**
 * The planner's term, kept as they typed it — including the characters
 * filenames are actually made of.
 *
 * THE DEFECT THIS REPLACES. The first version stripped `.`, `_`, `-`-adjacent
 * punctuation and more to spaces, because the term is spliced into a raw
 * PostgREST filter string where a comma or a period is grammar rather than
 * text. But the box is labelled "Find documents by name or filename", so the
 * most natural thing a planner can type into it —
 * `2023_Corridor_Study_FINAL_v3.pdf` — became `2023 Corridor Study FINAL v3
 * pdf`, which matches the file it names in neither column. The one input on the
 * page for finding a file by its filename could not find a file by its
 * filename.
 *
 * The fix belongs where the danger is: the term is now escaped at the point it
 * becomes a filter (`buildKbDocumentNameFilter`), not mangled at the point it is
 * read. Only two things are still removed here, and both are removed because
 * escaping cannot save them:
 *
 *   - `*`, which PostgREST rewrites to `%` inside a `like`/`ilike` value before
 *     anything downstream sees it. It is not a legal filename character on
 *     Windows and is vanishingly rare elsewhere.
 *   - control characters, which have no place in a filter string.
 *
 * Returns null when nothing searchable survives — the caller must then apply NO
 * name filter rather than one that matches everything.
 */
export function sanitizeKbDocumentNameTerm(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // `\p{Cc}` is the Unicode control category, written as a property escape so
    // that no control character has to appear in this file.
    .replace(/[*\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * One search term, made safe for the two layers between here and Postgres.
 *
 * VERIFIED AGAINST A RUNNING POSTGREST (local Supabase, 2026-08-12) rather than
 * reasoned about, because the two layers escape differently and getting it
 * wrong is silent — an unquoted value containing `(` returns HTTP 200 and
 * matches nothing at all.
 *
 *   Layer 1, PostgREST's quoted-string parser: inside `"…"`, `\X` yields `X`.
 *     So a backslash that must survive into the pattern is written `\\`.
 *   Layer 2, SQL `LIKE`: `_` matches any one character and `%` matches any run,
 *     and the default escape character is a backslash — `\_` is a literal
 *     underscore.
 *
 * Composing the two: a literal `_` in the planner's term has to arrive at
 * PostgREST as `\\_` so that Postgres receives `\_`. Measured live — `"%…_…%"`
 * matched a name spelled with hyphens (the wildcard), `"%…\\_…%"` did not (the
 * literal), and an unescaped `"` broke out of the value and injected a second
 * filter clause, which is why the quote escape is not cosmetic.
 */
function escapeKbDocumentNameTermForIlike(term: string): string {
  return term
    .replace(/\\/g, "\\\\\\\\")
    .replace(/"/g, '\\"')
    .replace(/([%_])/g, "\\\\$1");
}

/**
 * The PostgREST `or` clause for "the title or the stored filename contains
 * this". Two columns because a planner remembers one or the other, rarely both:
 * the title defaults to the filename on upload but is editable, and a pasted
 * document has no filename at all.
 *
 * The value is DOUBLE-QUOTED. Without the quotes a term containing a comma is
 * not a search for a comma — it opens a second clause in the filter PostgREST
 * parses — and a term containing a parenthesis silently matches nothing.
 */
export function buildKbDocumentNameFilter(term: string): string {
  const value = `%${escapeKbDocumentNameTermForIlike(term)}%`;
  return `title.ilike."${value}",original_filename.ilike."${value}"`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar day the planner typed, turned into the timestamp bounds of that
 * whole day in UTC.
 *
 * UTC on purpose: the list renders each document's date with
 * `toISOString().slice(0, 10)`, so a range interpreted in any other zone would
 * exclude a row whose printed date is inside the range the planner chose. Same
 * clock for the filter and for the date on screen.
 */
export function kbDocumentDayBounds(day: string): { from: string; to: string } | null {
  if (!ISO_DAY.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip guard: `2026-02-31` parses (JS rolls it into March) and would
  // otherwise silently filter on a day the planner never asked for.
  if (parsed.toISOString().slice(0, 10) !== day) return null;
  return { from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z` };
}

export type KbDocumentListFilters = {
  /** Sanitized name term, or null when no name filter applies. */
  nameTerm: string | null;
  sort: KbDocumentSort;
  /** Inclusive lower bound on created_at, or null. */
  addedFrom: string | null;
  /** Inclusive upper bound on created_at, or null. */
  addedTo: string | null;
};

/**
 * Turn the raw query values into the filters the read will actually apply.
 *
 * An unparseable date is dropped rather than rejected: the caller reports which
 * filters were applied (see `describeAppliedKbDocumentFilters`), so a dropped
 * bound is disclosed on screen instead of quietly narrowing — or quietly
 * failing to narrow — the planner's corpus.
 */
export function resolveKbDocumentListFilters(input: {
  q?: string | null;
  sort?: string | null;
  addedFrom?: string | null;
  addedTo?: string | null;
}): KbDocumentListFilters {
  const fromBounds = input.addedFrom ? kbDocumentDayBounds(input.addedFrom) : null;
  const toBounds = input.addedTo ? kbDocumentDayBounds(input.addedTo) : null;
  return {
    nameTerm: sanitizeKbDocumentNameTerm(input.q),
    sort: isKbDocumentSort(input.sort) ? input.sort : "newest",
    addedFrom: fromBounds?.from ?? null,
    addedTo: toBounds?.to ?? null,
  };
}

/** True when the read was narrowed by anything other than its default order. */
export function kbDocumentFiltersAreActive(filters: KbDocumentListFilters): boolean {
  return Boolean(filters.nameTerm || filters.addedFrom || filters.addedTo);
}

/**
 * The sentence describing what the planner is looking at, assembled from what
 * the read ACTUALLY did.
 *
 * Three facts have to survive together, and each of them has been got wrong on
 * this screen before:
 *   1. a count is a count of the rows that came back, never of the corpus;
 *   2. when the cap binds, the count is a floor and the screen must say so —
 *      "200 documents" reads as "this is all of them";
 *   3. a filtered count is a count of MATCHES, not of what the workspace holds.
 */
export function describeKbDocumentListResult(input: {
  count: number;
  filters: KbDocumentListFilters;
  scopeLabel: string | null;
  limit?: number;
}): string {
  const limit = input.limit ?? KB_DOCUMENT_LIST_LIMIT;
  const filtered = kbDocumentFiltersAreActive(input.filters);
  const where = input.scopeLabel ? `linked to ${input.scopeLabel}` : "in this workspace";
  const noun = `document${input.count === 1 ? "" : "s"}`;

  if (input.count >= limit) {
    return filtered
      ? `Showing the first ${limit} ${noun} matching these filters ${where} — there are more. Narrow the name or the date range to see the rest.`
      : `Showing the first ${limit} ${noun} ${where} — there are more. Search by name or narrow the date range to reach the rest.`;
  }

  return filtered
    ? `${input.count} ${noun} ${where} match${input.count === 1 ? "es" : ""} these filters.`
    : `${input.count} ${noun} ${where}.`;
}
