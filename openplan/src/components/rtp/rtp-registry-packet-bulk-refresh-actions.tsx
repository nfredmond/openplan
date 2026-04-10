"use client";

import { RtpRegistryPacketBulkArtifactActions } from "@/components/rtp/rtp-registry-packet-bulk-artifact-actions";

export function RtpRegistryPacketBulkRefreshActions({
  reportIds,
  reportCount,
}: {
  reportIds: string[];
  reportCount: number;
}) {
  return (
    <RtpRegistryPacketBulkArtifactActions
      reportIds={reportIds}
      reportCount={reportCount}
      queueLabel="Packet refresh queue"
      title="Refresh stale RTP packet artifacts in bulk"
      description="Sequentially regenerate RTP packet artifacts whose source cycle changed after the last packet generation."
      queuedDetail="Use this after packet layouts are already aligned and only the rendered artifact needs a fresh pass from current source state."
      buttonLabel="Refresh all stale packet artifacts"
      completionVerb="Refreshed"
    />
  );
}
