"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngagementGeometry } from "@/lib/engagement/geometry";
import type { EngagementDrawMode } from "@/lib/engagement/draw-state";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import type { PortalMapFraming } from "@/lib/engagement/public-portal-data";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import type { PublicBasemapChoice, PublicBasemapId } from "@/lib/cartographic/basemaps";
import {
  createPortalTranslator,
  type PortalMessageBundle,
} from "@/lib/engagement/portal-i18n/translator";
import { portalMapFramingSentence } from "@/lib/engagement/portal-i18n/map-framing-words";
import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { PortalOperatorText } from "./portal-operator-text";
import { PortalPendingCopyNotice } from "./portal-pending-copy-notice";
import { PARTICIPANT_MAP_CAN_DRAW, PublicMapStage, type ParticipantMapItem } from "./public-map-stage";
import { PublicMapSidebar, type SidebarCategory } from "./public-map-sidebar";

export type PublicMapShellItem = ParticipantMapItem & { parentItemId?: string | null };

/**
 * THE MAP-FIRST PARTICIPANT SURFACE — a map that fills the screen, a rail that
 * walks one person through one thing at a time, and exactly one way onward.
 *
 * WHAT THIS REPLACED AND WHY. The portal used to be a marketing-shaped page: an
 * 88rem centred column under a sign-up nav bar, with a hero, three fact tiles, a
 * posture rail, four tabs, and — two thirds of the way down, inside the Submit
 * tab, inside a form section — a 700x260 pixel rectangle that was the map. The
 * two maps were on DIFFERENT TABS, so a resident could never see their
 * neighbours' pins while placing their own. For a person who arrived from a
 * mailed postcard, the map is not a field in a form; it is the question.
 *
 * NOTHING WAS DELETED. The survey, the comment feed with its per-comment
 * translation and support votes, the close-the-loop record, the topic
 * descriptions, the email subscription, the accessibility contact and the full
 * classic submission form all live on the context page, one real `<a>` away.
 *
 * THE ONE BUTTON IS A REAL LINK, not a router push and not a nav bar. It works
 * before hydration, on a bad connection, from a phone, which is the same reason
 * the language picker beside it is a set of `<a href="?lang=xx">`s rather than a
 * `<select>`.
 *
 * ============================== THE NO-MAP RULE ==============================
 * `mapAvailable` is decided SERVER-SIDE by the route, from the same token
 * resolver the map itself uses. When it is false there is no map stage at all —
 * not an empty one, not a dashed placeholder filling the viewport — the rail
 * becomes the whole surface, it says plainly that the map cannot be shown, and
 * the "where" step becomes a plain question in words. A resident on a
 * deployment with no map key gives input exactly as completely as one with it.
 *
 * The two sentences that describe the MAP's camera and the map's submission rule
 * are suppressed in that state, because both name a map that is not there.
 * =============================================================================
 *
 * WHAT NO TEST OF THIS FILE CAN PROVE. jsdom applies no stylesheet, has no box
 * model, and does not run Mapbox GL at all. Every assertion available here is
 * structural — which elements exist and where they link. That the map actually
 * fills the viewport, that the sheet peeks above the fold, and that the rail
 * scrolls independently are browser facts and were checked by hand, not by a
 * test.
 */
export function PublicMapShell({
  shareToken,
  acceptingSubmissions,
  categories,
  items,
  readFailures,
  demographicsEnabled = false,
  mapFraming,
  contextLayers = null,
  messages,
  campaignTitle,
  campaignDescription,
  detailsHref,
  detailsContents,
  mapAvailable,
  basemapChoices = [],
  defaultBasemapId = null,
  languageChrome = null,
  accessibilityNotice = null,
  previewMode = false,
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: SidebarCategory[];
  /** Approved TOP-LEVEL items only; replies have no place on a map. */
  items: PublicMapShellItem[];
  readFailures: { comments: boolean; categories: boolean; closeLoop: boolean; project: boolean };
  demographicsEnabled?: boolean;
  mapFraming: PortalMapFraming;
  contextLayers?: ParticipantContextLayerSet | null;
  messages: PortalMessageBundle;
  campaignTitle: PortalText;
  campaignDescription: PortalText | null;
  /** The one way onward. A path, resolved by the route, with the language kept on it. */
  detailsHref: string;
  /**
   * WHAT IS ACTUALLY BEHIND THE ONE DOOR, so its label can say so.
   *
   * A boolean could only choose between "there is more" and silence, and the
   * label it produced — "About this project" — reads as background to a resident
   * who came from a postcard to answer a survey, so they never tap the only link
   * that leads to one. Three facts, because the sentence differs: a campaign
   * with a survey and comments, one with only a survey, and one with only
   * comments are three different promises, and promising a survey that does not
   * exist costs the same trust as promising nothing.
   */
  detailsContents: { survey: boolean; comments: boolean; closeLoop: boolean };
  mapAvailable: boolean;
  /**
   * The map backgrounds this deployment offers, resolved server-side by
   * `resolvePublicBasemapConfig` — the operator's `OPENPLAN_PUBLIC_BASEMAPS`
   * setting, or the product default. Empty offers no choice and renders no
   * picker, which is also what a deployment with no map key gets.
   */
  basemapChoices?: readonly PublicBasemapChoice[];
  defaultBasemapId?: PublicBasemapId | null;
  /** The language picker and its coverage notice, server-rendered so they work with no JS. */
  languageChrome?: ReactNode;
  /**
   * HOW A RESIDENT WHO CANNOT USE THIS PAGE REACHES A PERSON.
   *
   * It is rendered INSIDE the rail, and that placement is the whole point. As a
   * sibling below this component it began one full viewport down, underneath a
   * `h-dvh` map that swallows a drag, with nothing on screen saying anything was
   * there — the one route out for the residents least able to find it. Passed in
   * rather than built here because the words are the agency's, resolved
   * server-side from the campaign's own record.
   */
  accessibilityNotice?: ReactNode;
  previewMode?: boolean;
}) {
  const translator = useMemo(() => createPortalTranslator(messages), [messages]);
  const { t } = translator;

  /*
    BOTH ANSWERS HAVE TO AGREE. `mapAvailable` is the route's server-side
    decision and `PARTICIPANT_MAP_CAN_DRAW` is the map component's own reading of
    the same token. ANDing them is what makes the no-map path a property of these
    components instead of a rule two files have to keep agreeing on: a render
    site that hardcodes `mapAvailable` cannot produce a page with an empty stage
    and no explanation.
  */
  const canShowMap = mapAvailable && PARTICIPANT_MAP_CAN_DRAW;

  /*
    SUPPORTING A COMMENT FROM THE MAP POPUP. Owned here rather than passed in
    because the route above is a server component and cannot hand a function
    across the boundary — and because this is the ONLY vote control on the
    map-first surface, so a shell that forgot it would silently drop a
    capability the feed has had for months.

    `localStorage` is a soft client hint that keeps the button honest on a
    reload; the server's unique constraint is the real idempotency guard.
  */
  const supportedStorageKey = `openplan-engagement-supported-${shareToken}`;
  const [supportedItemIds, setSupportedItemIds] = useState<Set<string>>(new Set());
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(supportedStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setSupportedItemIds(new Set(parsed.filter((value): value is string => typeof value === "string")));
      }
    } catch {
      // Unreadable local storage is not a reason to break the page.
    }
  }, [supportedStorageKey]);

  const hasVoted = useCallback((itemId: string) => supportedItemIds.has(itemId), [supportedItemIds]);

  const onSupport = useCallback(
    async (itemId: string): Promise<number | null> => {
      // A preview vote would be an operator's thumb on their own public record.
      if (previewMode) return null;
      if (supportedItemIds.has(itemId)) return null;

      const baseCount = voteCounts[itemId] ?? items.find((item) => item.id === itemId)?.votesCount ?? 0;
      const optimistic = new Set([...supportedItemIds, itemId]);
      setSupportedItemIds(optimistic);
      setVoteCounts((previous) => ({ ...previous, [itemId]: baseCount + 1 }));
      try {
        window.localStorage.setItem(supportedStorageKey, JSON.stringify([...optimistic]));
      } catch {
        // Unwritable local storage only costs the memory of the vote.
      }

      try {
        const response = await fetch(`/api/engage/${shareToken}/items/${itemId}/vote`, { method: "POST" });
        const payload = (await response.json()) as { votesCount?: number };
        if (!response.ok) throw new Error("vote failed");
        const confirmed = typeof payload.votesCount === "number" ? payload.votesCount : baseCount + 1;
        setVoteCounts((previous) => ({ ...previous, [itemId]: confirmed }));
        return confirmed;
      } catch {
        setVoteCounts((previous) => ({ ...previous, [itemId]: baseCount }));
        const reverted = new Set(supportedItemIds);
        reverted.delete(itemId);
        setSupportedItemIds(reverted);
        return null;
      }
    },
    [items, previewMode, shareToken, supportedItemIds, supportedStorageKey, voteCounts]
  );

  /** The counts the map shows: an optimistic local count wins over the loaded one. */
  const mapItems = useMemo(
    () => items.map((item) => ({ ...item, votesCount: voteCounts[item.id] ?? item.votesCount ?? 0 })),
    [items, voteCounts]
  );

  const [basemapId, setBasemapId] = useState<PublicBasemapId | null>(defaultBasemapId);
  const selectedBasemapId = basemapId ?? defaultBasemapId ?? basemapChoices[0]?.id ?? "streets";

  /*
    EVERY PUBLISHED LAYER STARTS ON. A resident is being asked about a proposal
    they can only see if it is drawn, so the operator's context is the default
    state and the picker exists to let somebody turn it OFF to see the street
    underneath — never the other way round. Re-seeded when the campaign's layer
    set changes so a newly published layer is not silently hidden.
  */
  const publishedLayerIds = useMemo(
    () => (contextLayers?.layers ?? []).map((layer) => layer.id),
    [contextLayers]
  );
  const [hiddenLayerIds, setHiddenLayerIds] = useState<string[]>([]);
  const visibleLayerIds = useMemo(
    () => publishedLayerIds.filter((id) => !hiddenLayerIds.includes(id)),
    [publishedLayerIds, hiddenLayerIds]
  );
  const setVisibleLayerIds = useCallback(
    (next: string[]) => setHiddenLayerIds(publishedLayerIds.filter((id) => !next.includes(id))),
    [publishedLayerIds]
  );

  const [geometry, setGeometry] = useState<EngagementGeometry | null>(null);
  const [drawMode, setDrawMode] = useState<EngagementDrawMode>("point");
  // A counter, not a boolean: clearing twice in a row has to reach the stage
  // both times, and a boolean that is already false cannot say "again".
  const [clearToken, setClearToken] = useState(0);

  const clearGeometry = useCallback(() => {
    setGeometry(null);
    setClearToken((previous) => previous + 1);
  }, []);

  // Memoised because the stage takes it as an effect dependency; an object
  // literal rebuilt every render would re-run the whole paint on every keystroke
  // in the rail.
  const initialView = useMemo(
    () => (mapFraming.view ? { center: mapFraming.view.center, zoom: mapFraming.view.zoom } : null),
    [mapFraming.view]
  );

  const anyReadFailed =
    readFailures.comments || readFailures.categories || readFailures.closeLoop || readFailures.project;

  /*
    THE LABEL ON THE ONE DOOR, chosen from what this campaign actually has.
    Survey and comments are what a resident came for; the close-the-loop record
    is what keeps them coming back, and it is the hint rather than the label
    because a resident who has not yet said anything is not looking for it.
  */
  const detailsLabel = t(
    detailsContents.survey && detailsContents.comments
      ? "portal.openDetailsSurveyAndComments"
      : detailsContents.survey
        ? "portal.openDetailsSurvey"
        : detailsContents.comments
          ? "portal.openDetailsComments"
          : "portal.openDetails"
  );

  /*
    WHERE THE MAP OPENS, IN THE RESIDENT'S LANGUAGE.

    `mapFraming.summary` is English prose composed server-side, and printing it
    was two defects in one line: it was English on a page that declares Spanish,
    Farsi or Arabic, and it was written in an administrator's vocabulary — "No
    study area has been set for this campaign" names two things that exist in
    this software and nowhere in a resident's life. The resolver already carries
    the STRUCTURE of that sentence (`origin`, `originLabel`, and whether any
    candidate failed), so it is rebuilt here from catalog keys instead of
    translated as a blob.

    A named place is never translated — `{place}` is the agency's own name for
    the area, and rendering it through the catalog would be inventing a name.

    The English prose is not deleted: it is still what the operator preview's
    other readers and a survey question's framing note use, and it is still the
    only thing that can describe a partially-failed lookup in detail. What it no
    longer does is speak to a resident.

    IT IS NO LONGER BUILT HERE. This block used to hold the whole switch over
    `origin`, which made it a shared capability living inside one of its two
    callers — and the other caller, the classic submission form, went on printing
    the English prose to Spanish readers for exactly as long as that was true.
    `portalMapFramingSentence` is the one implementation; see
    `portal-i18n/map-framing-words.ts`.
  */
  const framingSentence = portalMapFramingSentence(mapFraming, translator);

  /**
   * The scrolling body of the rail.
   *
   * A function of its own classes because the bottom sheet needs to switch it
   * off entirely while collapsed — see the sheet below — and it is a DESCENDANT
   * of the sheet's toggle checkbox's sibling, so `peer-checked:` can only reach
   * it if it is rendered as a direct child of the section the checkbox is in.
   */
  const railBody = (className: string) => (
    <div className={className}>
        {/*
          LANGUAGE FIRST, before a resident reads a paragraph of unexpected
          English. Position is load-bearing: a coverage notice below the form is
          a disclosure met after the page has already misled them, and a picker
          below that is an exit found only by somebody who kept scrolling
          through a language they cannot read.
        */}
        {languageChrome ? <div className="border-b border-border/60 px-5 py-3">{languageChrome}</div> : null}

        {/*
          AND WHAT THIS SURFACE IS STILL SAYING IN ENGLISH, which the language
          chrome above cannot see.

          `PortalLanguageNotice` discloses keys the catalog is MISSING. It is
          silent on a complete catalog like Spanish — and this surface renders
          English anyway when the campaign asks for demographics, because
          `demographicLabel`'s option text is shared with the operator console's
          aggregate views and cannot simply become catalog keys.

          This notice lived inside `public-engagement-portal.tsx` until
          2026-08-14, and this route does not render that component. So the
          busiest public page in the product — the one a resident reaches from a
          mailed postcard — published English option labels on a Spanish
          consultation with nothing anywhere saying the English was a fallback
          rather than the agency's choice. Under Title VI that is a claim about
          what the agency published, which is why it is fixed here rather than
          noted.
        */}
        <div className="px-5 pt-4 empty:hidden">
          <PortalPendingCopyNotice translator={translator} />
        </div>

        {anyReadFailed ? (
          <div
            role="status"
            className="mx-5 mt-4 rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {t("portal.partOfPageUnavailable")}
          </div>
        ) : null}

        {!canShowMap ? (
          /*
            THE MAP CANNOT BE DRAWN, said at the top of the surface that replaced
            it. Same id and testid the display map's notice already uses, so the
            existing guard covers this surface too and there is one string a
            deployment can be searched for. What a member of the public needs is
            "you can still take part"; WHY it cannot be drawn is an operator's
            problem and is gated behind `OperatorDetail`.
          */
          <div
            id="engagement-map-unavailable"
            data-testid="engagement-map-unavailable"
            className="mx-5 mt-4 rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
          >
            <p className="font-medium text-foreground">{t("portal.mapMissingTitle")}</p>
            <p className="mt-1.5">{t("portal.mapMissingBody")}</p>
            <OperatorDetail>
              <p>
                Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (it begins with pk.) and
                rebuild.
              </p>
            </OperatorDetail>
          </div>
        ) : null}

        <div className="space-y-2 px-5 pt-4">
          <PortalOperatorText
            as="h1"
            className="text-xl font-semibold leading-snug text-foreground"
            value={campaignTitle}
            translator={translator}
          />
          {campaignDescription ? (
            <PortalOperatorText
              className="line-clamp-4 text-sm leading-relaxed text-muted-foreground"
              value={campaignDescription}
              translator={translator}
            />
          ) : null}
          <p
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
              acceptingSubmissions
                ? "bg-[color:var(--pine)]/15 text-foreground"
                : "bg-muted text-muted-foreground"
            )}
            data-testid="portal-status-chip"
          >
            {acceptingSubmissions ? t("page.submissionsOpen") : t("page.submissionsClosed")}
          </p>
        </div>

        {/*
          WHERE THE MAP OPENS, AND WHAT IT WILL ACCEPT — beside the map, which is
          now the whole screen, so the submission rule is finally next to the
          thing it governs. Both sentences are SUPPRESSED with no map: each names
          "this map", and printing them above an absent one is the defect this
          rebuild inherited rather than a new one.

          The first sentence is now the catalog's, built above from the
          resolver's structured answer. The remaining two are still English prose
          composed server-side, and are still marked as the English they are —
          a real gap, narrowed rather than closed, and `unreadableNote` in
          particular is an operator's diagnostic that a resident should never
          have needed to read.
        */}
        {canShowMap ? (
          <div className="space-y-1 px-5 pt-3 text-xs text-muted-foreground" data-testid="portal-map-framing">
            <p>{framingSentence}</p>
            {mapFraming.unreadableNote ? <p lang="en">{mapFraming.unreadableNote}</p> : null}
            {mapFraming.submissionRule ? <p lang="en">{mapFraming.submissionRule}</p> : null}
          </div>
        ) : null}

        <PublicMapSidebar
          shareToken={shareToken}
          acceptingSubmissions={acceptingSubmissions}
          categories={categories}
          demographicsEnabled={demographicsEnabled}
          translator={translator}
          geometry={geometry}
          onClearGeometry={clearGeometry}
          drawMode={drawMode}
          onDrawModeChange={setDrawMode}
          mapAvailable={canShowMap}
          previewMode={previewMode}
        />

        {/*
          LAST INSIDE THE RAIL, above the pinned link: a resident who can use the
          page meets the consultation first, and one who cannot finds this by
          scrolling the rail they are already in rather than by dragging a
          full-screen map out of the way to reach a document below it.
        */}
        {accessibilityNotice ? (
          /*
            `empty:hidden` because the notice decides for itself whether there is
            anything to say: an agency that has recorded no contact renders
            nothing, and this element is passed the component rather than its
            answer. Without it, that campaign would get a bare divider and a band
            of padding under the form — a section heading for a section that is
            not there.
          */
          <div
            className="border-t border-border/60 px-5 py-4 empty:hidden"
            data-testid="portal-accessibility-slot"
          >
            {accessibilityNotice}
          </div>
        ) : null}
    </div>
  );

  /*
    THE ONE BUTTON, pinned so it survives the rail scrolling. A real anchor:
    it must work before React hydrates, which on a phone over a bad
    connection is most of the time a resident spends on this page.
  */
  const railDoor = (
      <a
        href={detailsHref}
        data-testid="portal-details-link"
        className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-background px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <span className="flex flex-col">
          {detailsLabel}
          {detailsContents.closeLoop ? (
            <span className="text-xs font-normal text-muted-foreground">{t("portal.openDetailsHint")}</span>
          ) : null}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </a>
  );

  if (!canShowMap) {
    /*
      NO MAP, SO NO STAGE — the rail IS the page. Rendered as a single scrolling
      column rather than as an empty left half, because a two-column shell with
      nothing in one of the columns is a layout announcing its own failure.
    */
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[46rem] flex-col bg-background" data-testid="portal-shell-no-map">
        <div className="flex h-full min-h-0 flex-col">
          {railBody("min-h-0 flex-1 overflow-y-auto")}
          {railDoor}
        </div>
      </div>
    );
  }

  return (
    /*
      `dvh`, never `vh`. Mobile browser chrome is included in `vh`, so `100vh`
      overflows on exactly the device this surface is built for and pushes the
      sheet's own controls below the bottom of the screen.
    */
    <div
      className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-background lg:grid-cols-[minmax(0,1fr)_28rem] lg:grid-rows-[minmax(0,1fr)]"
      data-testid="portal-shell-map-first"
    >
      {/* `relative`, and the map inside it is `h-full w-full` — see the stage. */}
      <div className="relative min-h-0 lg:row-span-1">
        <PublicMapStage
          key={`stage-${clearToken}`}
          items={mapItems}
          onSupport={onSupport}
          hasVoted={hasVoted}
          contextLayers={contextLayers}
          initialView={initialView}
          drawEnabled={acceptingSubmissions && !previewMode}
          drawMode={drawMode}
          onGeometryChange={setGeometry}
          basemapChoices={basemapChoices}
          selectedBasemapId={selectedBasemapId}
          onBasemapSelect={(choice) => setBasemapId(choice.id)}
          visibleLayerIds={visibleLayerIds}
          onVisibleLayerIdsChange={setVisibleLayerIds}
          translator={translator}
        />
      </div>

      {/*
        THE BOTTOM SHEET, AND IT OPENS WITHOUT JAVASCRIPT.

        A checkbox and its `peer` classes rather than React state, for the same
        reason the language picker is a list of links: this is the main path for
        public comment, residents reach it on phones over bad connections, and a
        sheet that needs hydration to open is a sheet that is shut when it
        matters. On `lg` the classes are overridden and it is simply the rail —
        the checkbox has no effect there and the handle is hidden.

        WHAT PEEKS WHEN IT IS COLLAPSED — rewritten 2026-08-13 after measuring it
        in a browser at 390×844, which is the only place this question has an
        answer.

        It used to be a ~50px window onto the top of the rail, complete with its
        own scrollbar, wedged between the handle and the door link. The top of
        the rail is the language picker, so what a resident actually met was
        eleven of twenty-two language chips, cut off mid-row, above a scroll
        track. Measured: the collapsed section was 152px tall and its scrolling
        child reported `scrollHeight` 1016 inside a 51px box.

        The intent behind putting the picker first — a resident who cannot read
        this page needs the way out before they need the title — is right, and a
        50px clipped window served it no better than nothing did. So the
        collapsed sheet is now the handle and the door, and the picker is one tap
        on the handle away. Closing this properly means a picker that can be
        SHORT (a disclosure, not twenty-two chips), which lives in
        `portal-language-picker.tsx` and belongs to whoever owns that file.

        HOW THE COLLAPSED STATE REACHES THE BODY WITHOUT JAVASCRIPT. The toggle
        checkbox moved INSIDE the section, so the handle, the body and the door
        are all following siblings of it and `peer-checked:` reaches them. The
        section's own height then keys off `has-[:checked]` instead, because a
        parent cannot be its child's peer. No JS anywhere in the path: the sheet
        still opens on a phone that never runs the bundle.
      */}
      <section
        aria-label={t("portal.stepsHeading")}
        data-testid="portal-input-sheet"
        className={cn(
          "z-20 flex max-h-[9.5rem] min-h-0 flex-col overflow-hidden rounded-t-2xl border-t border-border/70 bg-background shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)] transition-[max-height] duration-200",
          "has-[#portal-sheet-toggle:checked]:max-h-[75dvh]",
          "lg:max-h-none lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none"
        )}
      >
        <input
          type="checkbox"
          id="portal-sheet-toggle"
          aria-label={t("portal.addYourInput")}
          className="peer sr-only lg:hidden"
          defaultChecked={false}
        />
        {/*
          The handle. Deliberately a `<label>` for the checkbox above and NOT a
          button: a button needs JavaScript to do anything.

          The wording does not change between states, and that is a limitation
          rather than a choice — the label is the checkbox's sibling now, but
          Tailwind's `peer-*` variants cannot restyle it based on a state whose
          own element it labels without also making the collapsed and expanded
          captions two different strings in the catalog. The checkbox is
          `sr-only` rather than hidden, so a screen reader announces the real
          state ("Add your input, checkbox, checked") regardless.
        */}
        <label
          htmlFor="portal-sheet-toggle"
          className="flex min-h-11 shrink-0 cursor-pointer select-none flex-col items-center justify-center gap-1 border-b border-border/50 py-2 text-sm font-semibold text-foreground lg:hidden"
        >
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-border" />
          <span className="flex items-center gap-1.5">
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
            {t("portal.addYourInput")}
          </span>
        </label>
        {/*
          `hidden` until the sheet is open, so nothing is half-shown and no
          scrollbar appears in a 50px slot. `lg:block` because on a wide screen
          this is not a sheet at all — it is the rail, always open, and the
          checkbox there has no effect.
        */}
        {railBody("hidden min-h-0 flex-1 overflow-y-auto peer-checked:block lg:block")}
        {railDoor}
      </section>
    </div>
  );
}
