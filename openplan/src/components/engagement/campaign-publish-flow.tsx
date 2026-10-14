"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Eye, Link2, Loader2, MapPin, Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StateBlock } from "@/components/ui/state-block";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { campaignPlaceFromPicker, type CampaignPlaceBody } from "@/lib/engagement/campaign-place-request";
import {
  getPublicPortalReadiness,
  getPublicPortalState,
  normalizeShareToken,
  participationDateClosure,
  type PublicPortalReadinessCheck,
} from "@/lib/engagement/public-portal";
import type { ProjectPlaceReference } from "@/lib/projects/project-place";

export type PublishFlowCampaign = {
  id: string;
  status: string;
  share_token: string | null;
  public_description: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  participation_starts_at: string | null;
  participation_ends_at: string | null;
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
  /**
   * Whose area the resident map opens on when the state is `set`: the
   * campaign's own, the linked project's, or the workspace home, the order the
   * resident map falls back through (`publishChecklistMapArea`). Absent means
   * the campaign's own.
   */
  source?: "campaign" | "project" | "workspace";
};

type StepId = PublicPortalReadinessCheck["id"] | "preview";

/**
 * ONE guided publish flow, at the top of the campaign console's Setup tab.
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
 * link, PATCH …/campaigns/{id} for status, description, comments and the map
 * area. No new routes.
 *
 * The map area and the comments switch used to send the planner to the
 * bottom of the page (two-month review, October 12, 2026: "the two most
 * needed (study area, public access) last"). Both now act inside their own
 * step. The area step reuses the shared `StudyAreaPicker`, and offers the
 * linked project's area in one click when it has a reference to copy.
 *
 * When the portal is already reachable the flow collapses to the live URL and
 * a status summary; link rotation, embed and exports stay in Public access,
 * inside the tab's Advanced group.
 */
export function CampaignPublishFlow({
  campaign,
  campaignArea,
  projectArea = null,
  timeZone,
}: {
  campaign: PublishFlowCampaign;
  campaignArea: PublishFlowCampaignArea;
  /** The linked project's area, when it can be copied by reference. */
  projectArea?: ProjectPlaceReference | null;
  /** The workspace calendar's zone, for dates in staff sentences. Absent means UTC. */
  timeZone?: string;
}) {
  const router = useRouter();
  // Steps are derived from the SERVER-saved campaign row, never from local
  // drafts: a step only turns green after the save round-trips and the page
  // re-renders with the new truth.
  const portalState = getPublicPortalState(campaign, { timeZone });
  const portalReadiness = getPublicPortalReadiness(campaign, campaignArea.state, { timeZone });
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
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.message || payload.error || failureMessage);
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
      return false;
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

  // Closing keeps the page up and stops new comments; reopening clears the
  // close time. Same PATCH as every other step. A page that never took
  // comments has nothing to close.
  //
  // Once the participation end date has passed, reopening changes nothing a
  // resident sees: the public page, the submit routes and the database all
  // refuse comments after that date. So no reopen is offered; the planner is
  // sent to the end date instead. The sentence naming the date is the status
  // line (live) or the comments step's own detail (checklist).
  const commentsClosed = Boolean(campaign.submissions_closed_at);
  const takesComments = commentsClosed || campaign.allow_public_submissions;
  const datesEnded = takesComments && participationDateClosure(campaign, { timeZone })?.reason === "ended";
  const closeCommentsButton = datesEnded ? (
    <a
      href="#campaign-control-participation-ends"
      className="w-fit text-sm font-medium underline underline-offset-2 hover:text-foreground"
      data-testid="publish-change-end-date"
    >
      Change the end date to take comments again
    </a>
  ) : takesComments ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() =>
          void patchCampaign(
            "submissions_closed",
            { submissionsClosed: !commentsClosed },
            commentsClosed ? "Failed to reopen comments" : "Failed to close comments"
          )
        }
        disabled={busyAction !== null}
      >
        {busyAction === "submissions_closed" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {commentsClosed ? "Reopen comments" : "Close comments"}
      </Button>
    ) : null;

  const areaStep = (
    <MapAreaStep
      area={campaignArea}
      projectArea={projectArea}
      detail={checkById.get("map_opens_somewhere")?.detail ?? null}
      busy={busyAction !== null}
      saving={busyAction === "map_opens_somewhere"}
      onInvalid={setError}
      onSave={(place) => patchCampaign("map_opens_somewhere", { place }, "Failed to save the map area")}
    />
  );

  const previewLink = (
    <a
      href={previewPath}
      className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
    >
      <Eye className="h-4 w-4" />
      Preview as a resident
    </a>
  );

  const urlRow = shareUrl ? (
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
        <>
          <a
            href={portalState.portalPath ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            Open portal
          </a>
          {previewLink}
        </>
      ) : null}
    </div>
  ) : null;

  const errorBlock = error ? (
    <StateBlock tone="danger" title="That step did not save" description={error} compact />
  ) : null;

  if (portalState.isPubliclyReachable) {
    // Live: collapse to the URL and a status summary. Nothing here needs a
    // step list, because the work now is outreach and moderation. The map
    // area stays here because it can still be missing on a live page.
    return (
      <article id="campaign-publish-flow" className="module-section-surface" data-testid="campaign-publish-flow">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Publish</p>
            <h2 className="module-section-title">The public page is live</h2>
            <p className="module-section-description">
              {portalState.label}. {portalState.detail}
            </p>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
            <Megaphone className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-5 space-y-3">
          {urlRow}
          {closeCommentsButton}
          {areaStep}
          {errorBlock}
          <p className="text-xs text-muted-foreground">
            Change or turn off the link, embed the page, or download comments under{" "}
            <a href="#public-share-controls" className="underline underline-offset-2 hover:text-foreground">
              Public access
            </a>{" "}
            in Advanced.
          </p>
        </div>
      </article>
    );
  }

  // Display order is the order a planner does the work, not the readiness
  // array's order: make the link, describe the project, choose where the map
  // opens, decide on comments, look at it as a resident, then go live. The
  // CONTENT of each counted step is the readiness check itself; the preview
  // step is the one step that is not a check, so it is not numbered or counted.
  const stepOrder: StepId[] = [
    "share_token",
    "public_description",
    // Before going live, because it is about what a resident will experience
    // once the link is out — a pin in the middle of the country cannot be
    // recalled from a postcard.
    "map_opens_somewhere",
    "submission_mode",
    "preview",
    "active_status",
  ];

  /*
    TWO LISTS, AND THEY MUST AGREE. This order is display order, but a check
    missing from it renders nowhere while still counting toward "N of M steps
    complete" — which is exactly what happened when the map step was added: the
    header said five and four appeared. Guarded by
    `a-campaign-says-where-its-map-will-open`, which asserts every readiness
    check has a place in this list.
  */

  let stepNumber = 0;

  return (
    <article id="campaign-publish-flow" className="module-section-surface" data-testid="campaign-publish-flow">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Publish</p>
          <h2 className="module-section-title">Steps to publish</h2>
          <p className="module-section-description">
            {portalReadiness.completeCount} of {portalReadiness.totalChecks} steps complete. Residents can open the
            link once every step is done.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/12 text-violet-700 dark:text-violet-300">
          <Megaphone className="h-5 w-5" />
        </span>
      </div>

      <ol className="mt-5 space-y-3">
        {stepOrder.map((id) => {
          if (id === "preview") {
            return (
              <PublishStep key={id} id={id} state="optional" marker={<Eye className="h-3.5 w-3.5" />} title="Preview as a resident">
                {previewLink}
              </PublishStep>
            );
          }

          const check = checkById.get(id);
          if (!check) return null;
          stepNumber += 1;
          const marker = check.passed ? <Check className="h-3.5 w-3.5" /> : stepNumber;

          return (
            <PublishStep key={id} id={id} state={check.passed ? "done" : "todo"} marker={marker} title={check.label}>
              {/*
                An open step says what to do; a done step only shows its tick.
                Two exceptions: the map step writes its own line, because a set
                area is named, and the comments step always says that comments
                wait for review, because that is what turning it on means.
              */}
              {(!check.passed || id === "submission_mode") && id !== "map_opens_somewhere" ? (
                <p className="text-xs text-muted-foreground">{check.detail}</p>
              ) : null}

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
                    Description for residents
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

              {id === "map_opens_somewhere" ? areaStep : null}

              {/*
                The comments switch, inline. It is the same field and the same
                PATCH as the checkbox in Public access, and it reads the SAVED
                row, so it flips only after the save comes back.
              */}
              {id === "submission_mode" && (commentsClosed || datesEnded) ? closeCommentsButton : null}
              {id === "submission_mode" && !commentsClosed && !datesEnded ? (
                <label className="flex w-fit items-center gap-2 text-sm font-medium">
                  <input
                    id="publish-flow-allow-comments"
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={campaign.allow_public_submissions}
                    disabled={busyAction !== null}
                    onChange={(event) =>
                      void patchCampaign(
                        "submission_mode",
                        { allowPublicSubmissions: event.target.checked },
                        "Failed to change whether residents can comment"
                      )
                    }
                  />
                  Accept comments from residents
                  {busyAction === "submission_mode" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                </label>
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
                  Set to Active
                </Button>
              ) : null}
            </PublishStep>
          );
        })}
      </ol>

      <div className="mt-4 space-y-3">
        {errorBlock}
        {shareToken ? (
          <p className="text-xs text-muted-foreground">
            Do not put this link on outreach materials until the page is live.
          </p>
        ) : null}
        {urlRow}
      </div>
    </article>
  );
}

/** One row of the checklist: a marker, a title, and whatever the step needs. */
function PublishStep({
  id,
  state,
  marker,
  title,
  children,
}: {
  id: StepId;
  state: "done" | "todo" | "optional";
  marker: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const markerTone =
    state === "done"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : state === "todo"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <li data-testid={`publish-step-${id}`} data-state={state} className="rounded-xl border border-border/60 bg-background/70 p-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${markerTone}`}
        >
          {marker}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {children}
        </div>
      </div>
    </li>
  );
}

/**
 * Where the resident map opens, set inside the checklist.
 *
 * Three states, never collapsed: a set area is named; an unreadable one says it
 * is a failed read and offers nothing to set, because an area may already be on
 * record; an unset one offers the linked project's area in one click when it has
 * a reference, and the shared picker either way. Saving goes through the same
 * PATCH and the same body builder as the area control in the campaign settings.
 */
function MapAreaStep({
  area,
  projectArea,
  detail,
  busy,
  saving,
  onInvalid,
  onSave,
}: {
  area: PublishFlowCampaignArea;
  projectArea: ProjectPlaceReference | null;
  detail: string | null;
  busy: boolean;
  saving: boolean;
  onInvalid: (message: string) => void;
  onSave: (place: CampaignPlaceBody) => Promise<boolean>;
}) {
  const [choosing, setChoosing] = useState(false);
  const [areaText, setAreaText] = useState("");
  const [pickedPlace, setPickedPlace] = useState<PlaceBoundaryResponse | null>(null);

  // The map falls back to the linked project's area, then the workspace home,
  // so the step is done, but the planner can still give this page its own area.
  const inherited = area.state === "set" && (area.source === "project" || area.source === "workspace");

  if (area.state === "set" && !inherited) {
    return (
      <p id="publish-area-advisory" className="text-xs text-muted-foreground" data-testid="publish-area-advisory">
        {area.label ? `The map opens on ${area.label}.` : detail}
      </p>
    );
  }

  if (area.state === "unreadable") {
    return (
      <p id="publish-area-advisory" className="text-xs text-amber-700 dark:text-amber-300" data-testid="publish-area-advisory">
        {detail}
      </p>
    );
  }

  async function savePicked() {
    const place = campaignPlaceFromPicker(pickedPlace, areaText);
    if (!place) {
      onInvalid("Search for a place or draw an area before saving.");
      return;
    }
    if (await onSave(place)) setChoosing(false);
  }

  return (
    <div className="space-y-2" data-testid="publish-area-step">
      {/*
        With a project area to copy, the map most likely opens on it already,
        so the readiness wording about the middle of the country would not be
        true here. Say only what is known.
      */}
      <p id="publish-area-advisory" className="text-xs text-muted-foreground" data-testid="publish-area-advisory">
        {inherited
          ? inheritedAreaSentence(area.source === "workspace" ? "the workspace's home area" : "the project's area", area.label)
          : projectArea
            ? "No area is set for this page yet."
            : detail}
      </p>
      {!choosing ? (
        <div className="flex flex-wrap gap-2">
          {projectArea && area.source !== "project" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void onSave({
                  mode: "place",
                  kind: projectArea.kind,
                  geoid: projectArea.geoid,
                  ...(projectArea.label ? { label: projectArea.label } : {}),
                })
              }
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              {projectArea.label ? `Use the project's area: ${projectArea.label}` : "Use the project's area"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setChoosing(true)}>
            <MapPin className="h-4 w-4" />
            {projectArea || inherited ? "Choose another area" : "Choose an area"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <StudyAreaPicker
            corridorText={areaText}
            onCorridorChange={setAreaText}
            onPlaceResolved={setPickedPlace}
            // Setting where a map opens launches no model run.
            showRunEngineHint={false}
          />
          <p className="text-xs text-muted-foreground">
            Only the box around the area reaches the public page, enough to frame the map.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void savePicked()} disabled={busy}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save area
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setAreaText("");
                setPickedPlace(null);
                setChoosing(false);
              }}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "The map opens on the project's area, Placer County, California." */
function inheritedAreaSentence(whose: string, label: string | null): string {
  return label ? `The map opens on ${whose}, ${label}.` : `The map opens on ${whose}.`;
}
