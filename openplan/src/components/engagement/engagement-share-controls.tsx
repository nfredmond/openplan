"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, ExternalLink, Globe, Link2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPublicPortalState } from "@/lib/engagement/public-portal";

type ShareControlsCampaign = {
  id: string;
  title: string;
  status: string;
  share_token: string | null;
  public_description: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
};

function generateShareToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => chars[value % chars.length]).join("");
  }

  let token = "";
  for (let i = 0; i < 24; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export function EngagementShareControls({
  campaign,
}: {
  campaign: ShareControlsCampaign;
}) {
  const router = useRouter();
  const [shareToken, setShareToken] = useState(campaign.share_token ?? "");
  const [publicDescription, setPublicDescription] = useState(campaign.public_description ?? "");
  const [allowSubmissions, setAllowSubmissions] = useState(campaign.allow_public_submissions);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const portalState = getPublicPortalState({
    status: campaign.status,
    share_token: shareToken,
    allow_public_submissions: allowSubmissions,
    submissions_closed_at: campaign.submissions_closed_at,
  });
  const shareUrl = portalState.portalPath
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${portalState.portalPath}`
    : null;

  const handleCopy = useCallback(async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  async function handleSave() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shareToken: shareToken || null,
          publicDescription: publicDescription || null,
          allowPublicSubmissions: allowSubmissions,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update share settings");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleGenerateToken() {
    setShareToken(generateShareToken());
  }

  function handleRemoveToken() {
    setShareToken("");
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Public access</p>
          <h2 className="module-section-title">Share link & public portal</h2>
          <p className="module-section-description">
            Configure a controlled public feedback portal for this campaign. A saved share link is only live once the
            campaign status is Active.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-700 dark:text-violet-300">
          <Globe className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="share-token" className="text-[0.82rem] font-semibold">
            Share token
          </label>
          <div className="flex gap-2">
            <Input
              id="share-token"
              value={shareToken}
              onChange={(e) => setShareToken(e.target.value)}
              placeholder="No share token — campaign is private"
              className="flex-1"
            />
            {!shareToken ? (
              <Button type="button" variant="outline" onClick={handleGenerateToken}>
                <Link2 className="h-4 w-4" />
                Generate
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={handleRemoveToken}>
                <Lock className="h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
        </div>

        <div
          className={`rounded-xl border p-3 text-sm ${
            portalState.isPubliclyReachable
              ? "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
              : portalState.visibility === "private"
                ? "border-border/70 bg-background/70"
                : "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
          }`}
        >
          <p className="font-semibold text-foreground">Portal status: {portalState.label}</p>
          <p className="mt-1 text-muted-foreground">{portalState.detail}</p>
          {shareUrl ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2">
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{shareUrl}</span>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy()} className="shrink-0">
                {copied ? <Check className="h-3.5 w-3.5 text-[color:var(--pine)]" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              {portalState.isPubliclyReachable ? (
                <a
                  href={portalState.portalPath ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open portal
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="public-description" className="text-[0.82rem] font-semibold">
            Public-facing description
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">shown on portal page</span>
          </label>
          <Textarea
            id="public-description"
            rows={3}
            placeholder="Describe the project and what kind of feedback you're looking for..."
            value={publicDescription}
            onChange={(e) => setPublicDescription(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            id="allow-submissions"
            type="checkbox"
            checked={allowSubmissions}
            onChange={(e) => setAllowSubmissions(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="allow-submissions" className="text-sm font-medium">
            Accept public submissions through the portal
          </label>
        </div>

        {error && (
          <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void handleSave()} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save share settings
          </Button>
          <a
            href={`/api/engagement/campaigns/${campaign.id}/export?format=csv`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
            download
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
          <a
            href={`/api/engagement/campaigns/${campaign.id}/export?format=json`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
            download
          >
            <Download className="h-4 w-4" />
            Export JSON
          </a>
        </div>
      </div>
    </article>
  );
}
