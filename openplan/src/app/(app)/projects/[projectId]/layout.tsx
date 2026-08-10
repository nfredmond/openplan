import type { ReactNode } from "react";
import { recordMetadata } from "@/lib/ui/page-title";

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

// Pass-through: this layout exists to name the tab, not to add chrome.
export default function ProjectRecordLayout({ children }: { children: ReactNode }) {
  return children;
}
