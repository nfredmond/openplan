import type { ReactNode } from "react";
import { recordMetadata } from "@/lib/ui/page-title";
import { requireRecordRow } from "@/lib/routing/record-not-found";
import { loadProgramRowForRequest } from "./_components/program-row-for-request";

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
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  return recordMetadata({
    table: "programs",
    nameColumn: "title",
    id: programId,
    moduleName: "Programs",
  });
}

/**
 * Answers a real HTTP 404 for a program the reader cannot see, before
 * `loading.tsx` starts the stream (see `requireRecordRow`). The `measure` and
 * `work-program` pages sit under this layout and inherit the answer; each adds
 * the layout's one row read to its own.
 */
export default async function ProgramRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  await requireRecordRow(programId, loadProgramRowForRequest);
  return children;
}
