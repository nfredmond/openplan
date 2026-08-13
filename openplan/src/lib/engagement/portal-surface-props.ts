/**
 * THE PROPS THE MAP-FIRST RESIDENT SURFACE IS BUILT FROM — computed once, for
 * every route that renders it.
 *
 * ===================== WHY THIS IS A MODULE AND NOT A PARAGRAPH IN A ROUTE
 *
 * Two routes render `PublicMapShell`: the public one at `/engage/<token>` and
 * the operator preview at `/engagement/<id>/preview`. The preview's entire
 * reason to exist is that an operator sees what a resident will see, and its own
 * docstring said it rendered "the REAL component rather than a mockup that could
 * drift from it".
 *
 * It drifted anyway — not by rendering a mockup, but by keeping the OLD real
 * component after the public route moved to a new one. For a while the preview
 * showed a page no resident could ever reach. A shared surface that lives inside
 * one of its two callers gets reimplemented, wrongly, by the other; that is this
 * repository's most repeated defect, and this module is the fix for this
 * instance of it: neither route decides what a resident's page is made of.
 *
 * WHAT STAYS WITH THE ROUTE. Three things, because they genuinely differ
 * between the two doors and folding them in here would force one to lie:
 *
 *   - `detailsHref` — where the one way onward points (a public URL with the
 *     resident's language on it; a preview URL that never leaves the console);
 *   - `languageChrome` and `accessibilityNotice` — React nodes, and their links
 *     are route-relative;
 *   - `previewMode`, which only one caller ever sets.
 *
 * ================================================= WHAT IT READS FROM WHERE
 *
 * `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is inlined at build time, so reading it on
 * the server is reading the same value the browser bundle carries. Deciding
 * `mapAvailable` here rather than in the browser means the client never mounts a
 * stage it cannot fill.
 */

import type { PublicPortalBundle } from "@/lib/engagement/public-portal-data";
import type { PortalMapFraming } from "@/lib/engagement/public-portal-data";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import type { PortalMessageBundle } from "@/lib/engagement/portal-i18n/translator";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import type { PublicBasemapChoice, PublicBasemapId } from "@/lib/cartographic/basemaps";
import type { PublicMapShellItem } from "@/components/engagement/public-map-shell";
import type { SidebarCategory } from "@/components/engagement/public-map-sidebar";
import { resolvePublicBasemapConfig } from "@/lib/cartographic/basemaps";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { groupApprovedItems } from "@/lib/engagement/approved-item-grouping";

export type PortalMapShellProps = {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: SidebarCategory[];
  items: PublicMapShellItem[];
  readFailures: { comments: boolean; categories: boolean; closeLoop: boolean; project: boolean };
  demographicsEnabled: boolean;
  mapFraming: PortalMapFraming;
  contextLayers: ParticipantContextLayerSet | null;
  messages: PortalMessageBundle;
  campaignTitle: PortalText;
  campaignDescription: PortalText | null;
  detailsContents: { survey: boolean; comments: boolean; closeLoop: boolean };
  mapAvailable: boolean;
  basemapChoices: readonly PublicBasemapChoice[];
  defaultBasemapId: PublicBasemapId | null;
};

/**
 * Everything about a resident's map surface that does not depend on which door
 * they came through.
 *
 * `env` is an argument only so a test can drive the basemap configuration; every
 * caller in the product omits it and gets `process.env`.
 */
export function buildPortalMapShellProps(
  bundle: PublicPortalBundle,
  options: { env?: Record<string, string | undefined> } = {}
): PortalMapShellProps {
  const env = options.env ?? process.env;
  const { acceptingSubmissions, campaignText, messages, portalProps } = bundle;

  const mapboxToken = resolvePublicMapboxToken(
    env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    env.NEXT_PUBLIC_MAPBOX_TOKEN
  );

  /*
    WHICH MAP BACKGROUNDS THIS DEPLOYMENT OFFERS, and which one opens first.
    With no token the resolver returns no choices at all, because a background
    picker over a map that does not exist is a control that lies about what it
    does.
  */
  const basemapConfig = resolvePublicBasemapConfig({ mapboxToken, env });

  // Replies belong to a thread, not to a place: a reply inherits no geometry and
  // showing one as its own pin would double-count a conversation on the map.
  const { topLevel } = groupApprovedItems(
    portalProps.approvedItems.map((item) => ({ ...item, parentItemId: item.parentItemId ?? null }))
  );

  /*
    WHAT IS BEHIND THE ONE DOOR, computed rather than written, because the label
    on it names these things by name. A door that says "See the survey" beside a
    campaign with no survey is a small lie that costs a resident a tap; a door
    that says "About this project" beside a campaign that HAS one costs the
    survey.

    `readFailures.closeLoop` counts toward the close-the-loop hint on purpose: a
    read that failed is not a campaign with no record, and understating it here
    would hide a section that exists.
  */
  const detailsContents = {
    survey: portalProps.surveyQuestions.length > 0,
    comments: topLevel.length > 0,
    closeLoop: portalProps.closeLoopEntries.length > 0 || portalProps.readFailures.closeLoop,
  };

  return {
    shareToken: portalProps.shareToken,
    acceptingSubmissions,
    categories: portalProps.categories,
    items: topLevel,
    readFailures: portalProps.readFailures,
    demographicsEnabled: portalProps.demographicsEnabled,
    mapFraming: portalProps.mapFraming,
    contextLayers: portalProps.contextLayers,
    messages,
    campaignTitle: campaignText.title,
    campaignDescription: campaignText.publicDescription ?? campaignText.summary ?? null,
    detailsContents,
    mapAvailable: Boolean(mapboxToken),
    basemapChoices: basemapConfig.choices,
    defaultBasemapId: basemapConfig.defaultId,
  };
}
