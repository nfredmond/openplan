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
 * page reuses the answer and no read is added. A failed read passes through,
 * so the page can say the record could not be read.
 */
export async function requireRecordRow(
  id: string,
  readRow: (id: string) => Promise<RecordRowRead>
): Promise<void> {
  if (!isUuid(id)) notFound();
  if (recordRowIsAbsent(await readRow(id))) notFound();
}
