"use client";

import { RtpRegistryPacketBulkArtifactActions } from "@/components/rtp/rtp-registry-packet-bulk-artifact-actions";

export function RtpRegistryPacketBulkGenerateActions({
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
      queueLabel="Packet first-artifact queue"
      title="Generate first RTP packet artifacts in bulk"
      description="Sequentially generate the first artifact for RTP board packet records that already exist but have not been rendered yet."
      queuedDetail="Use this when packet records are already in place and only the first rendered artifact is missing."
      buttonLabel="Generate all first-artifact packets"
      completionVerb="Generated"
    />
  );
}
