import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { recordMetadata } from "@/lib/ui/page-title";
import { isUuid } from "@/lib/uuid";
import { loadReportDetailRowForRequest } from "./_components/report-row-for-request";

/**
 * The browser-tab title for this record.
 *
 * It lives in the layout rather than in `page.tsx` because the title belongs to
 * the route segment that owns the record id: every page beneath this one is
 * about the same record, and each may add its own section to the name. It also
 * keeps a tab title from being the change that pushes an already-large page file
 * past the line cap the lint config enforces.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return recordMetadata({
    table: "reports",
    nameColumn: "title",
    id: reportId,
    moduleName: "Reports",
  });
}

/**
 * Answers a real HTTP 404 for a report the reader cannot see (KI-2026-11-14-060).
 *
 * `loading.tsx` in this folder wraps the page in a Suspense boundary, and its
 * fallback starts the response stream with status 200, so the page's own
 * `notFound()` could only render the not-found screen under a 200. This layout
 * sits outside that boundary. Next.js 16.4.2 docs,
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:
 * "`loading.js` wraps `not-found.js`, `page.js`, and nested `layout.js` files
 * in a `<Suspense>` boundary. It does **not** wrap the `layout.js` ... in the
 * same segment", and under "Status codes": "Calling `notFound()` ... before
 * this point preserves its `404`" (also 02-guides/streaming.md, "The HTTP
 * contract").
 *
 * A malformed id is not found before any query, as the malformed record id
 * guard requires of the page. The lookup is the page's own row read, shared
 * through React's request cache, with the signed-in user's client: a report
 * that does not exist and a report in another workspace both come back as no
 * row and take the same path to the same 404. A failed read is not an absence:
 * it renders the page, which says the report could not be read.
 */
export default async function ReportRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();
  const { data, error } = await loadReportDetailRowForRequest(reportId);
  if (!error && !data) notFound();
  return children;
}
