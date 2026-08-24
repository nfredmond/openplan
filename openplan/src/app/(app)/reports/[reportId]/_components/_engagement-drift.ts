import { titleize } from "@/lib/reports/catalog";
import { formatCompactDateTime } from "./_helpers";
import type {
  DriftItem,
  DriftStatus,
  EngagementCampaignLinkRow,
  EngagementCampaignSnapshot,
} from "./_types";

export function buildEngagementDriftItem(input: {
  campaign: EngagementCampaignLinkRow | null;
  snapshot: EngagementCampaignSnapshot | null;
  snapshotCapturedAt: string | null;
  snapshotTotalItems: number | null;
  snapshotReadyForHandoff: number | null;
  liveCounts: { totalItems: number; moderationQueue: { readyForHandoffCount: number } } | null;
}): DriftItem | null {
  const { campaign, liveCounts } = input;
  if (
    !campaign ||
    !liveCounts ||
    (!input.snapshot &&
      !input.snapshotCapturedAt &&
      input.snapshotTotalItems === null &&
      input.snapshotReadyForHandoff === null)
  ) return null;

  const snapshotStatus = input.snapshot?.status ?? null;
  const snapshotUpdatedAt = input.snapshot?.updatedAt ?? input.snapshotCapturedAt;
  const liveReadyForHandoff = liveCounts.moderationQueue.readyForHandoffCount;
  const status: DriftStatus =
    input.snapshotTotalItems !== null &&
    input.snapshotReadyForHandoff !== null &&
    (input.snapshotTotalItems !== liveCounts.totalItems ||
      input.snapshotReadyForHandoff !== liveReadyForHandoff)
      ? "count changed"
      : snapshotStatus !== null && snapshotStatus !== campaign.status
        ? "updated"
        : snapshotUpdatedAt !== null && snapshotUpdatedAt !== campaign.updated_at
          ? "updated"
          : "unchanged";

  return {
    key: "engagement",
    label: "Engagement handoff",
    status,
    detail:
      `Snapshot ${snapshotStatus ? `${titleize(snapshotStatus)} · ` : ""}${input.snapshotReadyForHandoff ?? 0} ready / ${input.snapshotTotalItems ?? 0} items · ${formatCompactDateTime(snapshotUpdatedAt)}. ` +
      `Live ${titleize(campaign.status)} · ${liveReadyForHandoff} ready / ${liveCounts.totalItems} items · ${formatCompactDateTime(campaign.updated_at)}.`,
  };
}
