"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { NO_TOPIC_FILTER_ID, PublicMapFeedButton, PublicMapFeedPanel } from "./public-map-feed";

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
  configurationVersionId,
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
  configurationVersionId?: string | null;
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

  /*
    THE COMMENT LIST AND THE MAP SHARE ONE SELECTION AND ONE FILTER, so what the
    list says is shown and what the map draws are always the same comments.
  */
  const [feedOpen, setFeedOpen] = useState(false);
  /*
    ON A PHONE THE COMMENT LIST AND THE INPUT SHEET TAKE TURNS. Both want most
    of a 390px screen; open together, the list was squeezed into a strip above
    the sheet. Opening one closes the other. The sheet still opens without
    JavaScript; this only adds the courtesy once the page has hydrated.
  */
  const sheetToggleRef = useRef<HTMLInputElement>(null);
  const openFeed = useCallback(() => {
    setFeedOpen(true);
    if (sheetToggleRef.current) sheetToggleRef.current.checked = false;
  }, []);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [feedQuery, setFeedQuery] = useState("");
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<string[]>([]);

  const topicsInUse = useMemo(
    () => [...new Set(mapItems.map((item) => item.categoryId ?? NO_TOPIC_FILTER_ID))],
    [mapItems]
  );

  const visibleItems = useMemo(() => {
    const needle = feedQuery.trim().toLocaleLowerCase();
    const hidden = new Set(hiddenCategoryIds);
    return mapItems.filter((item) => {
      if (hidden.has(item.categoryId ?? NO_TOPIC_FILTER_ID)) return false;
      if (!needle) return true;
      return `${item.title ?? ""} ${item.body}`.toLocaleLowerCase().includes(needle);
    });
  }, [mapItems, feedQuery, hiddenCategoryIds]);

  /*
    A COMMENT HAS ITS OWN ADDRESS: `?item=<id>` opens it, and opening one puts
    it in the address bar, so a resident can send a neighbour the exact comment.
    Read after hydration because the route above is shared with the preview.
  */
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("item");
    if (requested && items.some((item) => item.id === requested)) {
      setSelectedItemId(requested);
      setFeedOpen(true);
    }
  }, [items]);

  const selectItem = useCallback((itemId: string | null) => {
    setSelectedItemId(itemId);
    if (itemId) openFeed();
    const url = new URL(window.location.href);
    if (itemId) url.searchParams.set("item", itemId);
    else url.searchParams.delete("item");
    window.history.replaceState(window.history.state, "", url);
  }, [openFeed]);

  const closeFeed = useCallback(() => {
    setFeedOpen(false);
    selectItem(null);
  }, [selectItem]);

  const toggleCategory = useCallback((categoryId: string) => {
    setHiddenCategoryIds((previous) =>
      previous.includes(categoryId) ? previous.filter((id) => id !== categoryId) : [...previous, categoryId]
    );
  }, []);

  // A filter that hides the open comment closes it rather than leaving the
  // panel showing a comment the map no longer draws.
  useEffect(() => {
    if (selectedItemId && !visibleItems.some((item) => item.id === selectedItemId)) selectItem(null);
  }, [visibleItems, selectedItemId, selectItem]);

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

  const [restoredGeometry, setRestoredGeometry] = useState<EngagementGeometry | null>(null);
  const [geometry, setGeometry] = useState<EngagementGeometry | null>(null);
  const [drawMode, setDrawMode] = useState<EngagementDrawMode>("point");
  // A counter, not a boolean: clearing twice in a row has to reach the stage
  // both times, and a boolean that is already false cannot say "again".
  const [clearToken, setClearToken] = useState(0);

  const clearGeometry = useCallback(() => {
    setGeometry(null);setRestoredGeometry(null);
    setClearToken((previous) => previous + 1);
  }, []);

  const restoreGeometry = useCallback((value: EngagementGeometry) => {
    setRestoredGeometry(value);setGeometry(value);setDrawMode(value.type === 'Point' ? 'point' : value.type === 'LineString' ? 'line' : 'area');setClearToken(previous => previous + 1);
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
    Comments are on the map now, so the door names what is only behind it: the
    survey first, then the team's published response, then everything else.
  */
  const detailsLabel = t(
    detailsContents.survey
      ? "portal.openDetailsSurvey"
      : detailsContents.closeLoop
        ? "portal.openDetailsHint"
        : "portal.openDetails"
  );

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
          SAID ONLY WHEN IT HELPS. A map that opened on a real place shows that
          place, so it is not narrated. A map that opens wide, because nothing
          framed it or the lookup failed, says so and asks the resident to zoom
          in. The agency's submission rule, when there is one, is always said.
        */}
        {canShowMap && (mapFraming.origin === "none" || mapFraming.submissionRule) ? (
          <div className="space-y-1 px-5 pt-3 text-xs text-muted-foreground" data-testid="portal-map-framing">
            {mapFraming.origin === "none" ? <p>{portalMapFramingSentence(mapFraming, translator)}</p> : null}
            {mapFraming.submissionRule ? <p lang="en">{mapFraming.submissionRule}</p> : null}
          </div>
        ) : null}

        <PublicMapSidebar
          shareToken={shareToken} configurationVersionId={configurationVersionId}
          acceptingSubmissions={acceptingSubmissions}
          categories={categories}
          demographicsEnabled={demographicsEnabled}
          translator={translator}
          geometry={geometry}
          onClearGeometry={clearGeometry}
          onRestoreGeometry={restoreGeometry}
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
        <span>{detailsLabel}</span>
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
          items={visibleItems}
          selectedItemId={selectedItemId}
          onSelectItem={selectItem}
          feed={{
            button: (
              <PublicMapFeedButton
                open={feedOpen}
                total={items.length}
                readFailed={readFailures.comments}
                onOpen={openFeed}
                translator={translator}
              />
            ),
            panel: (
              <PublicMapFeedPanel
                open={feedOpen}
                onClose={closeFeed}
                items={visibleItems}
                totalCount={items.length}
                readFailed={readFailures.comments}
                categories={categories}
                topicsInUse={topicsInUse}
                hiddenCategoryIds={hiddenCategoryIds}
                onToggleCategory={toggleCategory}
                query={feedQuery}
                onQueryChange={setFeedQuery}
                selectedItemId={selectedItemId}
                onSelect={selectItem}
                onSupport={(itemId) => void onSupport(itemId)}
                hasVoted={hasVoted}
                previewMode={previewMode}
                detailsHref={detailsHref}
                translator={translator}
              />
            ),
          }}
          contextLayers={contextLayers}
          initialView={initialView}
          drawEnabled={acceptingSubmissions && !previewMode}
          drawMode={drawMode}
          initialGeometry={restoredGeometry}
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
          ref={sheetToggleRef}
          onChange={(event) => {
            if (event.currentTarget.checked) setFeedOpen(false);
          }}
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
