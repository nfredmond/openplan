import type { ReactNode } from "react";
import { recordMetadata } from "@/lib/ui/page-title";
import { requireRecordRow } from "@/lib/routing/record-not-found";
import { readRtpCycleRowForRequest } from "./_components/rtp-cycle-record-for-request";

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
  params: Promise<{ rtpCycleId: string }>;
}) {
  const { rtpCycleId } = await params;
  return recordMetadata({
    table: "rtp_cycles",
    nameColumn: "title",
    id: rtpCycleId,
    moduleName: "RTP Cycles",
  });
}

/**
 * Answers a real HTTP 404 for an RTP cycle the reader cannot see, before
 * `loading.tsx` starts the stream (see `requireRecordRow`). The `document`,
 * `extraction` and `extraction/chapters` pages sit under this layout and
 * inherit the answer; each adds the layout's three round trips (user,
 * membership, row) to its own reads. The cycle is read in the current
 * workspace only, as every RTP page reads it, so a cycle in the reader's other
 * workspace answers 404 here as the pages already refused it.
 */
export default async function RtpCycleRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ rtpCycleId: string }>;
}) {
  const { rtpCycleId } = await params;
  await requireRecordRow(rtpCycleId, readRtpCycleRowForRequest);
  return children;
}
