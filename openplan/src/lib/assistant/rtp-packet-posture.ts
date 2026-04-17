import {
  PACKET_FRESHNESS_LABELS,
  type PacketFreshnessLabel,
} from "@/lib/reports/packet-labels";

export type RtpPacketWorkPosture = "generate" | "refresh" | "release";

export type RtpPacketFreshnessLabel = PacketFreshnessLabel;

export function resolveRtpPacketWorkPostureFromFreshnessLabel(
  label: string | null | undefined
): RtpPacketWorkPosture {
  if (label === PACKET_FRESHNESS_LABELS.NO_PACKET) return "generate";
  if (label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED) return "refresh";
  return "release";
}

export function resolveRtpPacketWorkPostureFromCounts(args: {
  linkedReportCount?: number;
  noPacketCount: number;
  refreshRecommendedCount: number;
}): RtpPacketWorkPosture {
  if (args.linkedReportCount === 0) return "generate";
  if (args.noPacketCount > 0) return "generate";
  if (args.refreshRecommendedCount > 0) return "refresh";
  return "release";
}

export function compareRtpPacketPostureForCycle(
  leftLabel: string | null | undefined,
  rightLabel: string | null | undefined
): number {
  const postureRank = (label: string | null | undefined): number => {
    const posture = resolveRtpPacketWorkPostureFromFreshnessLabel(label);
    if (posture === "generate") return 0;
    if (posture === "refresh") return 1;
    return 2;
  };

  return postureRank(leftLabel) - postureRank(rightLabel);
}
