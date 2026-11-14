import type { ReactNode } from "react";
import { recordMetadata } from "@/lib/ui/page-title";
import { requireRecordRow } from "@/lib/routing/record-not-found";
import { readProjectRowForRequest } from "./_components/project-record-for-request";

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
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return recordMetadata({
    table: "projects",
    nameColumn: "name",
    id: projectId,
    moduleName: "Projects",
  });
}

/**
 * Answers a real HTTP 404 for a project the reader cannot see, before
 * `loading.tsx` starts the stream (see `requireRecordRow`). The `management`
 * page sits under this layout and inherits the answer; it adds the layout's
 * three round trips (user, membership, row) to its own reads.
 */
export default async function ProjectRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireRecordRow(projectId, readProjectRowForRequest);
  return children;
}
