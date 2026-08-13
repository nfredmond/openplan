import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicMapShell } from "@/components/engagement/public-map-shell";
import {
  PortalLanguageNotice,
  PortalLanguagePicker,
} from "@/components/engagement/portal-language-picker";
import { PortalAccessibilityNotice } from "@/components/engagement/portal-accessibility-notice";
import { loadPublicPortalBundleForShareValue } from "@/lib/engagement/public-portal-data";
import { PORTAL_LOCALE_QUERY_PARAM } from "@/lib/engagement/portal-i18n/locales";
import {
  portalRequestedLocale,
  portalSearchString,
  type PortalSearchParams,
} from "@/lib/engagement/portal-search-params";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { buildPortalMapShellProps } from "@/lib/engagement/portal-surface-props";

type PageSearchParams = PortalSearchParams;

const requestedLocaleFrom = (searchParams: PageSearchParams | undefined) =>
  portalRequestedLocale(searchParams, PORTAL_LOCALE_QUERY_PARAM);
const searchStringFrom = portalSearchString;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ shareToken: string }>;
  searchParams?: Promise<PageSearchParams>;
}): Promise<Metadata> {
  const { shareToken } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;
  // Token OR printable slug — the resolver tries the token column first, and a
  // slug only ever reaches the same active-campaign data the token path serves.
  const bundle = await loadPublicPortalBundleForShareValue(shareToken, {
    requestedLocale: requestedLocaleFrom(resolvedSearch),
  });

  if (!bundle) {
    return { title: "Engagement portal", robots: { index: false, follow: false } };
  }

  const translator = createPortalTranslator(bundle.messages);
  const title = bundle.campaignText.title.text || "Community engagement";
  /*
    THE PREVIEW MUST SAY WHAT THE PAGE SAYS. `publicDescription` is the
    resident-facing text and `summary` is the operator's internal framing — the
    campaign form asks for them with different questions. Previewing the summary
    published an operator note ("which grant this supports") as the snippet a
    search engine indexes and a resident sees when they share the link.
  */
  const description =
    bundle.campaignText.publicDescription?.text.trim() ||
    bundle.campaignText.summary?.text.trim() ||
    translator.t("page.defaultDescription");

  // The canonical URL KEEPS the language. Dropping it would tell a crawler —
  // and any tool that follows canonicals — that the Spanish portal and the
  // English one are the same page, which is exactly the claim this feature
  // exists to stop making.
  const canonical =
    bundle.locale.source === "url"
      ? `/engage/${shareToken}?${PORTAL_LOCALE_QUERY_PARAM}=${bundle.locale.locale}`
      : `/engage/${shareToken}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      locale: bundle.locale.bcp47,
    },
    robots: { index: false, follow: false },
  };
}

/**
 * THE MAP. That is the whole page.
 *
 * A resident arriving from a mailed postcard meets a map of their own place
 * filling the screen, a rail that asks them one thing at a time in plain words,
 * and one link to everything else. What used to be here — hero, fact tiles,
 * posture rail, four tabs, a 260-pixel map two thirds of the way down — is at
 * `./about`, in full, with nothing removed.
 *
 * THE NO-MAP BRANCH IS DECIDED HERE, server-side, from the same resolver the map
 * component uses. `NEXT_PUBLIC_*` is inlined at build time so the server can read
 * it, and deciding here means the client never mounts a stage it cannot fill.
 * `mapAvailable={false}` gives the resident the rail as the whole surface, with
 * the reason at the top of it and "where" asked in words instead of pins.
 */
export default async function PublicEngagementMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ shareToken: string }>;
  searchParams?: Promise<PageSearchParams>;
}) {
  const { shareToken } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const bundle = await loadPublicPortalBundleForShareValue(shareToken, {
    requestedLocale: requestedLocaleFrom(resolvedSearch),
  });
  if (!bundle) {
    notFound();
  }

  const { campaign, campaignText, locale, messages } = bundle;
  const translator = createPortalTranslator(messages);

  const search = searchStringFrom(resolvedSearch);
  const detailsHref = search
    ? `/engage/${shareToken}/about?${search}`
    : `/engage/${shareToken}/about`;

  /*
    EVERYTHING A RESIDENT'S MAP SURFACE IS MADE OF, from the one builder both
    doors use. It used to be computed here, which is how the operator preview
    ended up rendering a different page from the one residents get.
  */
  const shellProps = buildPortalMapShellProps(bundle);

  return (
    // `dir` and `lang` sit on the participant surface's OWN wrapper, never on
    // the app shell: the shell is shared with the untranslated operator console
    // and must not flip.
    <div dir={locale.direction} lang={locale.bcp47}>
      <PublicMapShell
        {...shellProps}
        detailsHref={detailsHref}
        languageChrome={
          <div className="flex flex-col gap-2">
            <PortalLanguagePicker
              locale={locale}
              messages={messages}
              pathname={`/engage/${shareToken}`}
              search={search}
            />
            <PortalLanguageNotice locale={locale} messages={messages} />
          </div>
        }
        /*
          INSIDE THE SHELL, not after it. It used to be a sibling below
          `PublicMapShell`, whose map branch is a `h-dvh` grid with
          `overflow-hidden` — so the one route out for a resident who cannot use
          the map started exactly one viewport down, under a full-screen map that
          swallows a drag, with nothing on screen suggesting it was there. On the
          page this replaced it sat at the end of an ordinary scrolling document,
          where scrolling reached it. The shell puts it at the end of the RAIL,
          which is the scrolling document on this surface.
        */
        accessibilityNotice={
          <PortalAccessibilityNotice
            contactLabel={campaignText.accessibilityContactLabel}
            alternateFormats={campaignText.accessibilityAlternateFormats}
            email={campaign.accessibility_contact_email}
            phone={campaign.accessibility_contact_phone}
            translator={translator}
          />
        }
      />
    </div>
  );
}
