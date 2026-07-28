import { getPublicPortalState, type PublicPortalCampaignLike } from "@/lib/engagement/public-portal";

/**
 * Create-success callout for the campaign console (rendered when the creator
 * lands here with `?created=1`). Explains where the public link lives and that
 * submissions flow into moderation — and stays honest about the portal's
 * actual state: a fresh campaign is Private, so no live URL is ever implied.
 * Server-safe (no hooks).
 */
export function EngagementCampaignCreatedNotice({ campaign }: { campaign: PublicPortalCampaignLike }) {
  const portal = getPublicPortalState(campaign);

  return (
    <div className="mb-4 rounded-xl border border-emerald-400/35 bg-emerald-50/70 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
      <p className="font-semibold text-foreground">Campaign created.</p>
      <p className="mt-1 text-muted-foreground">
        {portal.isPubliclyReachable
          ? "Its public link is live — the URL is in the header below."
          : "Its public portal stays offline until a share link is generated under Operator Actions and the campaign is Active."}{" "}
        Once live, share the public URL anywhere; every submission lands in this console&apos;s moderation queue.
      </p>
    </div>
  );
}
