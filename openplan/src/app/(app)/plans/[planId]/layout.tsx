import type { ReactNode } from "react";
import { recordMetadata } from "@/lib/ui/page-title";
import { requireRecordRow } from "@/lib/routing/record-not-found";
import { loadPlanRowForRequest } from "./_components/plan-row-for-request";

/**
 * The browser-tab title for this record.
 *
 * It lives in the layout rather than in `page.tsx` because the title belongs to
 * the route segment that owns the record id — every page beneath this one is
 * about the same record, and each may add its own section to the name. It also
 * keeps a tab title from being the change that pushes an already-large page file
 * past the line cap the lint config enforces.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return recordMetadata({
    table: "plans",
    nameColumn: "title",
    id: planId,
    moduleName: "Plans",
  });
}

/**
 * Answers a real HTTP 404 for a plan the reader cannot see, before
 * `loading.tsx` starts the stream (see `requireRecordRow`).
 */
export default async function PlanRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  await requireRecordRow(planId, loadPlanRowForRequest);
  return children;
}
