export const PACKET_FRESHNESS_LABELS = {
  NO_PACKET: "No packet",
  REFRESH_RECOMMENDED: "Refresh recommended",
  CURRENT: "Packet current",
} as const;

export type PacketFreshnessLabel =
  (typeof PACKET_FRESHNESS_LABELS)[keyof typeof PACKET_FRESHNESS_LABELS];

export const PACKET_POSTURE_LABELS = {
  NO_RECORD: "No packet record",
  NEEDS_RESET: "Needs reset",
  PRESET_UNKNOWN: "Preset unknown",
} as const;

export type PacketPostureLabel =
  (typeof PACKET_POSTURE_LABELS)[keyof typeof PACKET_POSTURE_LABELS];

export const PACKET_FRESHNESS_DETAIL = {
  NO_PACKET: "No generated packet is attached to this report yet.",
  NO_PACKET_FOR_CYCLE: "No RTP board packet record exists for this cycle yet.",
  REFRESH_RECOMMENDED:
    "The report or one of its tracked source records changed after the latest packet was generated.",
  CURRENT:
    "The latest packet is current with the saved report record and tracked source timestamps.",
} as const;

export const PACKET_POSTURE_DETAIL = {
  NO_RECORD:
    "Create a linked RTP board packet record so phase-specific packet posture stays visible from the registry.",
  PRESET_UNKNOWN:
    "Packet structure could not be compared against the recommended phase preset.",
} as const;

export function isPacketFreshnessLabel(value: string | null | undefined): value is PacketFreshnessLabel {
  return (
    value === PACKET_FRESHNESS_LABELS.NO_PACKET
    || value === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
    || value === PACKET_FRESHNESS_LABELS.CURRENT
  );
}
