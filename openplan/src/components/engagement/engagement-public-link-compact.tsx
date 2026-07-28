"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EngagementPortalStatusChip } from "@/components/engagement/portal-status-chip";
import { getPublicPortalState, type PublicPortalCampaignLike } from "@/lib/engagement/public-portal";

/**
 * Compact public-link block for the campaign console HEADER: portal status
 * chip, the public URL with copy/open actions when (and only when) the portal
 * is actually reachable, and a one-line explainer. Detail work — description,
 * submission mode, embed snippet, regeneration — stays in the full
 * EngagementShareControls block under Operator Actions; this links down to it.
 */
// The origin never changes within a page's lifetime; useSyncExternalStore
// gives a hydration-safe read (server snapshot is empty) without an effect.
const subscribeToNothing = () => () => {};

export function EngagementPublicLinkCompact({ campaign }: { campaign: PublicPortalCampaignLike }) {
  const browserOrigin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => ""
  );
  const [copied, setCopied] = useState(false);

  const portal = getPublicPortalState(campaign);
  // Honest by construction: a URL renders here only when the public page
  // actually resolves. Private and staged portals get the state detail instead.
  const shareUrl = portal.isPubliclyReachable && portal.portalPath ? `${browserOrigin}${portal.portalPath}` : null;

  const handleCopy = useCallback(async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[0.82rem] font-semibold">Public link</p>
        <EngagementPortalStatusChip campaign={campaign} />
        <a
          href="#public-share-controls"
          className="ml-auto text-xs font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
        >
          Manage sharing
        </a>
      </div>

      {shareUrl ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2">
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs">{shareUrl}</span>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy()} className="shrink-0">
              {copied ? <Check className="h-3.5 w-3.5 text-[color:var(--pine)]" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <a
              href={portal.portalPath ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Share this URL publicly; every submission lands in this console&apos;s moderation queue.
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{portal.detail}</p>
      )}
    </div>
  );
}
