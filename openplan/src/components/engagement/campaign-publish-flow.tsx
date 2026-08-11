"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Eye, Link2, Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StateBlock } from "@/components/ui/state-block";
import {
  getPublicPortalReadiness,
  getPublicPortalState,
  normalizeShareToken,
  type PublicPortalReadinessCheck,
} from "@/lib/engagement/public-portal";

export type PublishFlowCampaign = {
  id: string;
  status: string;
  share_token: string | null;
  public_description: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
};

/**
 * The campaign's own area of record, in the three states the rest of the
 * console already distinguishes. `unreadable` is a failed read and must never
 * be rendered as "no area set" — that would tell a planner to go pick an area
 * that may already be on record.
 */
export type PublishFlowCampaignArea = {
  state: "set" | "unset" | "unreadable";
  label: string | null;
};

/**
 * ONE guided publish flow, near the top of the campaign console.
 *
 * Before this component existed, publishing was three separate forms with
 * three save buttons at the bottom of a ~20-section console. A planner who
 * generated a link but never flipped the status to Active handed out a URL
 * that 404s — and nothing on the page put those two facts next to each other.
 *
 * The steps here are not a second opinion: they ARE `getPublicPortalReadiness`
 * / `getPublicPortalState`, the same functions the share controls and the
 * public portal gate read, so this panel and the portal cannot disagree about
 * what is missing. Every step is actionable in place through the SAME
 * endpoints the rest of the console uses — POST …/share-token to mint the
 * link, PATCH …/campaigns/{id} for status, description, and intake posture.
 * No new routes.
 *
 * When the portal is already reachable the flow collapses to the live URL and
 * a status summary; the deep link management (rotate, disable, embed, exports)
 * stays in the Public access section under Operator Actions.
 */
export function CampaignPublishFlow({
  campaign,
  campaignArea,
}: {
  campaign: PublishFlowCampaign;
  campaignArea: PublishFlowCampaignArea;
}) {
  const router = useRouter();
  // Steps are derived from the SERVER-saved campaign row, never from local
  // drafts: a step only turns green after the save round-trips and the page
  // re-renders with the new truth.
  const portalState = getPublicPortalState(campaign);
  const portalReadiness = getPublicPortalReadiness(campaign);
  const checkById = new Map<PublicPortalReadinessCheck["id"], PublicPortalReadinessCheck>(
    portalReadiness.checks.map((check) => [check.id, check])
  );

  const [descriptionDraft, setDescriptionDraft] = useState(campaign.public_description ?? "");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [browserOrigin, setBrowserOrigin] = useState("");

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  const shareToken = normalizeShareToken(campaign.share_token);
  const shareUrl = portalState.portalPath ? `${browserOrigin}${portalState.portalPath}` : null;
  const previewPath = `/engagement/${campaign.id}/preview`;

  const handleCopy = useCallback(async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  async function runAction(actionId: string, request: () => Promise<Response>, failureMessage: string) {
    setError(null);
    setBusyAction(actionId);
    try {
      const response = await request();
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || failureMessage);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setBusyAction(null);
    }
  }

  function patchCampaign(actionId: string, body: Record<string, unknown>, failureMessage: string) {
    return runAction(
      actionId,
      () =>
        fetch(`/api/engagement/campaigns/${campaign.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      failureMessage
    );
  }

  // The link is minted server-side by the SAME endpoint the share controls
  // use — 144 bits of entropy, saved in one step, nothing to type.
  function mintShareLink() {
    return runAction(
      "share_token",
      () => fetch(`/api/engagement/campaigns/${campaign.id}/share-token`, { method: "POST" }),
      "Failed to generate the public link"
    );
  }

  const areaAdvisory =
    campaignArea.state === "set" ? (
      <p className="text-xs text-muted-foreground" data-testid="publish-area-advisory">
        Campaign area on record{campaignArea.label ? `: ${campaignArea.label}` : ""}. The resident map
        opens on it, and the location check can be turned on against it.
      </p>
    ) : campaignArea.state === "unreadable" ? (
      <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="publish-area-advisory">
        This campaign&apos;s area could not be read just now — it may or may not be set. That is a
        failed read, not a missing area; reload before acting on it.
      </p>
    ) : (
      <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="publish-area-advisory">
        No campaign area is set. Publishing works without one, but the resident map opens without a
        boundary you chose, and the location check that refuses pins outside your area cannot be
        turned on. Set one under Campaign management at the bottom of this page — strongly
        encouraged before outreach.
      </p>
    );

  const urlBlock = shareUrl ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
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
      <a
        href={previewPath}
        className="inline-flex items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
      >
        <Eye className="h-4 w-4" />
        Preview the resident view
      </a>
    </div>
  ) : (
    <a
      href={previewPath}
      className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
    >
      <Eye className="h-4 w-4" />
      Preview the resident view
    </a>
  );

  if (portalState.isPubliclyReachable) {
    // Live: collapse to the URL and a status summary. Nothing here needs a
    // step list — the work now is outreach and moderation, not setup.
    return (
      <article className="module-section-surface" data-testid="campaign-publish-flow">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Publish</p>
            <h2 className="module-section-title">This campaign is live</h2>
            <p className="module-section-description">
              {portalState.label}. {portalState.detail}
            </p>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
            <Megaphone className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-5 space-y-3">
          {urlBlock}
          {areaAdvisory}
          <p className="text-xs text-muted-foreground">
            Rotate or disable the link, embed the portal on your website, and export responses under{" "}
            <a href="#public-share-controls" className="underline underline-offset-2 hover:text-foreground">
              Public access
            </a>{" "}
            below.
          </p>
        </div>
      </article>
    );
  }

  // Display order is the order a planner does the work, not the readiness
  // array's order: mint the link, write the description, choose the intake
  // posture, then go live. The CONTENT of each step is the readiness check
  // itself.
  const stepOrder: PublicPortalReadinessCheck["id"][] = [
    "share_token",
    "public_description",
    "submission_mode",
    "active_status",
  ];

  return (
    <article className="module-section-surface" data-testid="campaign-publish-flow">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Publish</p>
          <h2 className="module-section-title">Take this campaign public</h2>
          <p className="module-section-description">
            {portalReadiness.completeCount} of {portalReadiness.totalChecks} steps complete. The
            public page only resolves once every step is done — a shared link on an inactive
            campaign is a URL that does not resolve for residents.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/12 text-violet-700 dark:text-violet-300">
          <Megaphone className="h-5 w-5" />
        </span>
      </div>

      <ol className="mt-5 space-y-3">
        {stepOrder.map((id, index) => {
          const check = checkById.get(id);
          if (!check) return null;
          return (
            <li
              key={id}
              data-testid={`publish-step-${id}`}
              data-state={check.passed ? "done" : "todo"}
              className="rounded-xl border border-border/60 bg-background/70 p-3"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    check.passed
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {check.passed ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-semibold text-foreground">{check.label}</p>
                  <p className="text-xs text-muted-foreground">{check.detail}</p>

                  {id === "share_token" && !check.passed ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void mintShareLink()}
                      disabled={busyAction !== null}
                    >
                      {busyAction === "share_token" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Link2 className="h-4 w-4" />
                      )}
                      Generate link
                    </Button>
                  ) : null}

                  {id === "public_description" && !check.passed ? (
                    <div className="space-y-2">
                      <label htmlFor="publish-flow-description" className="sr-only">
                        Public-facing description
                      </label>
                      <Textarea
                        id="publish-flow-description"
                        rows={3}
                        placeholder="Describe the project and what kind of feedback you're looking for..."
                        value={descriptionDraft}
                        onChange={(event) => setDescriptionDraft(event.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void patchCampaign(
                            "public_description",
                            { publicDescription: descriptionDraft || null },
                            "Failed to save the public description"
                          )
                        }
                        disabled={busyAction !== null}
                      >
                        {busyAction === "public_description" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Save description
                      </Button>
                    </div>
                  ) : null}

                  {id === "submission_mode" && !check.passed ? (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void patchCampaign(
                            "submission_mode",
                            { allowPublicSubmissions: true },
                            "Failed to turn on public submissions"
                          )
                        }
                        disabled={busyAction !== null}
                      >
                        {busyAction === "submission_mode" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Accept public submissions
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        A view-only portal is also a deliberate choice — close submissions under
                        Public access below and this step reads as done.
                      </p>
                    </div>
                  ) : null}

                  {id === "active_status" && !check.passed ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void patchCampaign("active_status", { status: "active" }, "Failed to activate the campaign")
                      }
                      disabled={busyAction !== null}
                    >
                      {busyAction === "active_status" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Set the campaign to Active
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 space-y-3">
        {areaAdvisory}
        {error ? (
          <StateBlock tone="danger" title="That step did not save" description={error} compact />
        ) : null}
        {shareToken && !portalState.isPubliclyReachable ? (
          <p className="text-xs text-muted-foreground">
            The saved link below becomes reachable the moment every step above is done — do not put
            it on outreach materials before then.
          </p>
        ) : null}
        {urlBlock}
      </div>
    </article>
  );
}
