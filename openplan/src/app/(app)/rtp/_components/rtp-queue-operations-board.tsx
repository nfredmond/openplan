import { RtpRegistryPacketBulkActions } from "@/components/rtp/rtp-registry-packet-bulk-actions";
import { RtpRegistryPacketBulkGenerateActions } from "@/components/rtp/rtp-registry-packet-bulk-generate-actions";
import { RtpRegistryPacketBulkRefreshActions } from "@/components/rtp/rtp-registry-packet-bulk-refresh-actions";
import { RtpRegistryPacketQueueCommandBoard } from "@/components/rtp/rtp-registry-packet-queue-command-board";
import type { PacketAttentionCounts } from "./_types";

type Props = {
  packetAttentionCounts: PacketAttentionCounts;
  resetCycleIds: string[];
  missingCycleIds: string[];
  generateFirstReportIds: string[];
  refreshReportIds: string[];
  generateReportIds: string[];
  refreshOnlyReportIds: string[];
  modelingCountyRunId: string | null;
};

export function RtpQueueOperationsBoard({
  packetAttentionCounts,
  resetCycleIds,
  missingCycleIds,
  generateFirstReportIds,
  refreshReportIds,
  generateReportIds,
  refreshOnlyReportIds,
  modelingCountyRunId,
}: Props) {
  const showCommandBoard =
    packetAttentionCounts.reset > 0 ||
    packetAttentionCounts.generate > 0 ||
    packetAttentionCounts.refresh > 0 ||
    packetAttentionCounts.missing > 0;

  return (
    <>
      {showCommandBoard ? (
        <RtpRegistryPacketQueueCommandBoard
          resetCycleIds={resetCycleIds}
          missingCycleIds={missingCycleIds}
          generateFirstReportIds={generateFirstReportIds}
          refreshReportIds={refreshReportIds}
          resetCount={packetAttentionCounts.reset}
          missingCount={packetAttentionCounts.missing}
          modelingCountyRunId={modelingCountyRunId}
        />
      ) : null}

      {packetAttentionCounts.reset > 0 ? (
        <RtpRegistryPacketBulkActions
          cycleIds={resetCycleIds}
          cycleCount={packetAttentionCounts.reset}
        />
      ) : null}

      {packetAttentionCounts.generate > 0 ? (
        <RtpRegistryPacketBulkGenerateActions
          reportIds={generateReportIds}
          reportCount={packetAttentionCounts.generate}
        />
      ) : null}

      {packetAttentionCounts.refresh > 0 ? (
        <RtpRegistryPacketBulkRefreshActions
          reportIds={refreshOnlyReportIds}
          reportCount={packetAttentionCounts.refresh}
        />
      ) : null}

    </>
  );
}
