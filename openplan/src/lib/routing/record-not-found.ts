import { notFound } from "next/navigation";
import { POSTGREST_NO_ROWS_MATCHED } from "@/lib/http/write-outcome";
import { isUuid } from "@/lib/uuid";

/**
 * One record read as the page makes it: the row, or the database's error.
 * `null` means the page itself decides before reading (no signed-in user, or
 * no workspace yet), so the layout has nothing to judge.
 */
export type RecordRowRead = {
  data: unknown;
  error: object | null;
} | null;

/**
 * Whether a read answered and found no row. Row security makes a record in
 * another workspace read exactly like one that does not exist, so both are
 * absent. `.single()` reports the empty answer as PGRST116; that is absence
 * too. Any other error is a failed read, which is not absence.
 */
export function recordRowIsAbsent(read: RecordRowRead): boolean {
  if (!read || read.data) return false;
  return !read.error || ("code" in read.error && read.error.code === POSTGREST_NO_ROWS_MATCHED);
}

/**
 * The check a record route's `layout.tsx` makes so a record the reader cannot
 * see answers a real HTTP 404 (KI-2026-11-14-060, KI-2026-11-14-280).
 *
 * A `loading.tsx` starts the response stream with status 200, and it wraps the
 * page but not the layout in the same folder (Next.js 16.4.2,
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md,
 * "Status codes"). So the page's own `notFound()` can only render the
 * not-found screen under a 200; this check runs first, in the layout.
 *
 * A malformed id is refused before any query. `readRow` must be the page's own
 * read through the signed-in user's client, wrapped in React's `cache` so the
 * page reuses the answer. A failed read passes through, so the page can say
 * the record could not be read.
 *
 * WHAT THE CHECK COSTS ON A FULL RENDER. The record's own page reuses the
 * layout's read and adds nothing. A child page below the layout makes its own
 * reads and does not call the shared loader, so there the layout's lookup is
 * extra: one row read under programs (`measure`, `work-program`), and three
 * round trips (`auth.getUser`, the current-workspace membership read, the row
 * read) under projects (`management`) and RTP cycles (`document`,
 * `extraction`, `extraction/chapters`).
 *
 * WHAT IT COSTS ON A PREFETCH. In a production build a `<Link>` to a dynamic
 * route prefetches "the partial route down to the nearest segment with a
 * `loading.js` boundary", which the prefetching guide lists as "Layout to
 * first loading boundary" (Next.js 16.4.2, node_modules/next/dist/docs/
 * 01-app/03-api-reference/02-components/link.md, `prefetch`; 01-app/02-guides/
 * prefetching.md, "Automatic prefetch"). The record layout sits above its
 * `loading.tsx`, so each prefetched link runs this lookup: one row read for
 * plans, programs and reports, three round trips for projects and RTP cycles,
 * the token lookup for the portal. Without Cache Components (not enabled in
 * next.config.ts), "the navigation will block until the layout finishes
 * rendering, and the `loading.js` fallback will not be shown" (03-file-
 * conventions/layout.md, "Interaction with `loading.js`"), so the skeleton
 * appears only after the lookup. Measured once (KI-2026-11-14-331): each
 * prefetched project link added one `auth.getUser`, one membership read and
 * one project row read, about 60 lookups for a page of twenty project links.
 */
export async function requireRecordRow(
  id: string,
  readRow: (id: string) => Promise<RecordRowRead>
): Promise<void> {
  if (!isUuid(id)) notFound();
  if (recordRowIsAbsent(await readRow(id))) notFound();
}
