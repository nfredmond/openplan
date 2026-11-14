import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { resolvePortalForRequest } from "./portal-resolution-for-request";

/**
 * Answers a real HTTP 404 for an address no active or closed campaign carries
 * (KI-2026-11-14-280).
 *
 * `loading.tsx` in this folder starts the response stream with status 200, and
 * it wraps the pages but not this layout (Next.js 16.4.2,
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md,
 * "Status codes"). So the pages' own `notFound()` could only render the
 * not-found screen under a 200.
 *
 * Only absence answers 404. A closed campaign still renders the page that says
 * the comment period has ended, and a failed lookup still reaches the page,
 * which raises it so the error page says the page could not load. The `about`
 * page sits under this layout and inherits the answer.
 */
export default async function PortalCampaignLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  const resolution = await resolvePortalForRequest(shareToken);
  if (resolution.status === "absent") notFound();
  return children;
}
