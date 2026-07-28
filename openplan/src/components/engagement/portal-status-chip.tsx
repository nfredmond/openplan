import { Globe } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getPublicPortalState, type PublicPortalCampaignLike } from "@/lib/engagement/public-portal";
import type { StatusTone } from "@/lib/ui/status";

// One tone per portal visibility. The RULES for what counts as private, staged,
// or live come from getPublicPortalState — this map is presentation only, so
// list rows, the campaign console header, and the share controls can never
// disagree about whether a link is live.
const PORTAL_VISIBILITY_TONES: Record<ReturnType<typeof getPublicPortalState>["visibility"], StatusTone> = {
  private: "neutral",
  staged: "warning",
  live_open: "success",
  live_closed: "info",
};

/**
 * Compact Private / Staged / Live chip for an engagement campaign's public
 * portal. Server-safe (no hooks), so the campaigns list can render it directly.
 * The full state detail rides along as a tooltip.
 */
export function EngagementPortalStatusChip({
  campaign,
  className,
}: {
  campaign: PublicPortalCampaignLike;
  className?: string;
}) {
  const portal = getPublicPortalState(campaign);

  return (
    <StatusBadge tone={PORTAL_VISIBILITY_TONES[portal.visibility]} className={className} title={portal.detail}>
      <Globe className="h-3 w-3" aria-hidden="true" />
      Portal · {portal.shortLabel}
    </StatusBadge>
  );
}
