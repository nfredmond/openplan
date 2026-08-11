"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, ExternalLink, Globe, Link2, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPublicPortalState, normalizeShareToken } from "@/lib/engagement/public-portal";
import {
  isPublicSlugCandidate,
  normalizePublicSlugInput,
  PUBLIC_SLUG_FORMAT_REFUSAL,
} from "@/lib/engagement/campaign-slugs";

type ShareControlsCampaign = {
  id: string;
  title: string;
  status: string;
  share_token: string | null;
  public_description: string | null;
  /**
   * The printable public address (20260810000002), or null when none is set.
   * The console page reads this column failure-tolerantly, so null can also
   * mean "could not be read" during a deploy window — which is why the save
   * below only sends the slug when the planner actually edited it.
   */
  public_slug: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  demographics_enabled: boolean;
};

// The embed snippet is HTML SOURCE the operator pastes into their own site, so
// any value interpolated into an attribute must be HTML-attribute-escaped — an
// unescaped `"` in a campaign title (set by any workspace member) would otherwise
// break out of title="..." and inject markup into the operator's page. Escape &
// first so already-safe entities aren't double-decoded.
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function EngagementShareControls({
  campaign,
}: {
  campaign: ShareControlsCampaign;
}) {
  const router = useRouter();
  // The share token is server truth: it is minted and rotated by
  // POST /share-token and cleared by PATCH { shareToken: null } — never typed.
  const shareToken = normalizeShareToken(campaign.share_token) ?? "";
  const [publicDescription, setPublicDescription] = useState(campaign.public_description ?? "");
  const [publicSlug, setPublicSlug] = useState(campaign.public_slug ?? "");
  const [allowSubmissions, setAllowSubmissions] = useState(campaign.allow_public_submissions);
  const [demographicsEnabled, setDemographicsEnabled] = useState(campaign.demographics_enabled);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [browserOrigin, setBrowserOrigin] = useState("");

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  const portalState = getPublicPortalState({
    status: campaign.status,
    share_token: shareToken,
    public_description: publicDescription,
    allow_public_submissions: allowSubmissions,
    submissions_closed_at: campaign.submissions_closed_at,
  });
  const shareUrl = portalState.portalPath ? `${browserOrigin}${portalState.portalPath}` : null;

  // The SAME normalization and rule the route and the public resolver use —
  // one shared module, so the field cannot accept what the door would refuse.
  const normalizedSlug = normalizePublicSlugInput(publicSlug);
  // Only an EDIT travels. The console reads public_slug failure-tolerantly, so
  // an unedited field must never clear a slug that exists but could not be
  // read; gating on change makes that impossible rather than unlikely.
  const slugEdited = normalizedSlug !== (campaign.public_slug ?? "");
  const slugUrl =
    normalizedSlug !== "" && isPublicSlugCandidate(normalizedSlug)
      ? `${browserOrigin}/engage/${normalizedSlug}`
      : null;
  const embedUrl = portalState.isPubliclyReachable && shareToken ? `${browserOrigin}/embed/${shareToken}` : null;
  const embedSnippet = embedUrl
    ? `<iframe src="${escapeHtmlAttribute(embedUrl)}" width="100%" height="720" style="border:0" loading="lazy" title="${escapeHtmlAttribute(campaign.title)}"></iframe>`
    : null;

  const handleCopy = useCallback(async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  const handleCopyEmbed = useCallback(async () => {
    if (embedSnippet) {
      await navigator.clipboard.writeText(embedSnippet);
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 2000);
    }
  }, [embedSnippet]);

  async function handleSave() {
    // Refuse a bad link name HERE, with the same sentence the server uses, so
    // the planner is not told "saved" and then finds the address dead.
    if (slugEdited && normalizedSlug !== "" && !isPublicSlugCandidate(normalizedSlug)) {
      setError(PUBLIC_SLUG_FORMAT_REFUSAL);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicDescription: publicDescription || null,
          allowPublicSubmissions: allowSubmissions,
          demographicsEnabled,
          // An emptied field is a deliberate clear; an untouched one sends
          // nothing at all (see slugEdited above).
          ...(slugEdited ? { publicSlug: normalizedSlug === "" ? null : normalizedSlug } : {}),
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

  // Mint (or rotate) the share token SERVER-side in one step — no free-text
  // token, no separate save. Rotation invalidates the old link immediately.
  async function requestServerMintedToken() {
    setError(null);
    setIsRotating(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}/share-token`, {
        method: "POST",
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate a share link");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate a share link");
    } finally {
      setIsRotating(false);
    }
  }

  function handleGenerateLink() {
    void requestServerMintedToken();
  }

  function handleRegenerateLink() {
    const confirmed = window.confirm(
      "Mint a replacement public link? The current link stops working immediately — everywhere it has already been shared — and cannot be restored."
    );
    if (!confirmed) return;
    void requestServerMintedToken();
  }

  async function handleDisableLink() {
    const confirmed = window.confirm(
      "Take the public link offline? The public page stops resolving immediately."
    );
    if (!confirmed) return;

    setError(null);
    setIsRotating(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareToken: null }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to disable the share link");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable the share link");
    } finally {
      setIsRotating(false);
    }
  }

  return (
    <article id="public-share-controls" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Public access</p>
          <h2 className="module-section-title">Share link & public portal</h2>
          <p className="module-section-description">
            Configure a controlled public feedback portal for this campaign. A saved share link is only live once the
            campaign status is Active.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/12 text-violet-700 dark:text-violet-300">
          <Globe className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <p className="text-[0.82rem] font-semibold">Share link</p>
          <p className="text-xs text-muted-foreground">
            Links are minted server-side and saved in one step — there is nothing to type or guess.
          </p>
          <div className="flex flex-wrap gap-2">
            {!shareToken ? (
              <Button type="button" variant="outline" onClick={handleGenerateLink} disabled={isRotating}>
                {isRotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Generate link
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={handleRegenerateLink} disabled={isRotating}>
                  {isRotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Regenerate link
                </Button>
                <Button type="button" variant="outline" onClick={() => void handleDisableLink()} disabled={isRotating}>
                  <Lock className="h-4 w-4" />
                  Disable link
                </Button>
              </>
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
          <label htmlFor="public-slug" className="text-[0.82rem] font-semibold">
            Easy link name
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Give the portal a short name to make a printable address people can read off a flyer,
            a slide, or a bus-shelter poster — like /engage/jefferson-street-study. Lowercase
            letters, numbers, and hyphens only. It works alongside the share link above and only
            answers while the campaign is Active. Save with the button below.
          </p>
          <Input
            id="public-slug"
            value={publicSlug}
            onChange={(e) => setPublicSlug(e.target.value.toLowerCase())}
            placeholder="jefferson-street-study"
            maxLength={64}
          />
          {slugUrl ? (
            <p className="text-xs text-muted-foreground">
              {slugEdited ? "Will become: " : "Printable address: "}
              <span className="font-mono text-foreground">{slugUrl}</span>
            </p>
          ) : null}
        </div>

        {embedSnippet ? (
          <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-foreground">Embed on your website</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopyEmbed()} className="shrink-0">
                {copiedEmbed ? <Check className="h-3.5 w-3.5 text-[color:var(--pine)]" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedEmbed ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-1 text-muted-foreground">
              Paste this iframe into your site. Anyone who can see your page can submit — the same moderation, rate limits,
              and anti-abuse checks apply as on the hosted portal.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-border/60 bg-background/80 px-3 py-2 font-mono text-xs text-foreground">
              {embedSnippet}
            </pre>
          </div>
        ) : null}

        {/*
          The step-by-step readiness checklist lives in ONE place now — the
          guided publish flow at the top of this console — instead of being
          repeated here. Two checklists computed from the same facts read as
          two opinions the moment either one lags a save.
        */}
        <p className="text-xs text-muted-foreground">
          Getting this campaign live step by step is handled by the Publish panel at the top of this
          page. This section is the ongoing management surface: rotate or disable the link, adjust
          the public settings, embed the portal, and export what came in.
        </p>

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

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <input
              id="demographics-enabled"
              type="checkbox"
              checked={demographicsEnabled}
              onChange={(e) => setDemographicsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <label htmlFor="demographics-enabled" className="text-sm font-medium">
              Ask respondents optional demographics (Title VI / representativeness)
            </label>
          </div>
          <p className="pl-7 text-xs text-muted-foreground">
            Adds an optional, privacy-safe &ldquo;About you&rdquo; block (age band, ZIP, language, tenure, race).
            Coarse bands only, never shown with a comment, and surfaced only as k-anonymized aggregates.
          </p>
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
          <a
            href={`/api/engagement/campaigns/${campaign.id}/export?format=geojson`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
            download
          >
            <Download className="h-4 w-4" />
            Export GeoJSON
          </a>
        </div>

        {/*
          Survey responses are a SEPARATE record from map comments and items —
          they live in their own tables and the three exports above have never
          included them. Until this link existed a survey's responses could not
          leave the product at all, so an agency could not put its own
          participation record into the documentation it has to produce.

          The helper text says what the file holds and what it leaves out,
          because a planner deciding whether this is the file they need should
          not have to open it to find out.
        */}
        <div className="space-y-2 border-t pt-4">
          <p className="text-[0.82rem] font-semibold">Survey responses</p>
          <p className="text-xs text-muted-foreground">
            One row per survey response received — when it arrived, through what channel, and its
            moderation status. It leaves out respondent names and contact details, device
            fingerprints, self-reported demographics (which are only ever read as suppressed
            aggregates) and internal moderation notes. Answer content exports separately — the
            second file below carries what each respondent actually said, one row per answer, with
            the question wording they were shown. Each file opens with a few <code>#</code> lines
            describing itself.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/engagement/campaigns/${campaign.id}/survey/export?format=csv`}
              className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
              download
            >
              <Download className="h-4 w-4" />
              Export survey response register (CSV)
            </a>
            <a
              href={`/api/engagement/campaigns/${campaign.id}/survey/export?content=answers&format=csv`}
              className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
              download
            >
              <Download className="h-4 w-4" />
              Export survey answers (CSV)
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
