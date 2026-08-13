import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PortalContextPage } from "@/components/engagement/portal-context-page";
import { loadPublicPortalBundleForShareValue } from "@/lib/engagement/public-portal-data";
import { PORTAL_LOCALE_QUERY_PARAM } from "@/lib/engagement/portal-i18n/locales";
import {
  portalRequestedLocale,
  portalSearchString,
  type PortalSearchParams,
} from "@/lib/engagement/portal-search-params";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

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
  const bundle = await loadPublicPortalBundleForShareValue(shareToken, {
    requestedLocale: requestedLocaleFrom(resolvedSearch),
  });

  if (!bundle) {
    return { title: "Engagement portal", robots: { index: false, follow: false } };
  }

  const translator = createPortalTranslator(bundle.messages);
  const title = bundle.campaignText.title.text || "Community engagement";
  const description =
    bundle.campaignText.publicDescription?.text.trim() ||
    bundle.campaignText.summary?.text.trim() ||
    translator.t("page.defaultDescription");

  /*
    THE CANONICAL POINTS AT THE MAP, not at this page. This is the same
    consultation reached a second way — one URL, two depths — and telling a
    crawler otherwise would index the context page as a separate consultation
    and send residents to the one WITHOUT the map. The language stays on it for
    the reason it stays on every canonical here: the Spanish portal is not the
    same page as the English one.
  */
  const canonical =
    bundle.locale.source === "url"
      ? `/engage/${shareToken}?${PORTAL_LOCALE_QUERY_PARAM}=${bundle.locale.locale}`
      : `/engage/${shareToken}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website", locale: bundle.locale.bcp47 },
    robots: { index: false, follow: false },
  };
}

/**
 * EVERYTHING THE MAP IS NOT — one real link away from it.
 *
 * The hero, the three facts, the moderation posture, the four tabs (the classic
 * submission form, the survey, the community feed with its per-comment
 * translation and support votes, the close-the-loop record), the topic
 * descriptions, the email subscription and the accessibility contact. This is
 * the page that used to live at `/engage/<token>`, unchanged apart from the way
 * back to the map at the top.
 *
 * IT IS ALSO THE NO-JAVASCRIPT FALLBACK. The map needs JavaScript; the `<form>`
 * inside `PublicEngagementPortal` does not, and the link that reaches this page
 * is a plain anchor. A resident whose phone never runs the bundle still meets a
 * complete way to take part.
 */
/**
 * EVERYTHING THE MAP IS NOT — one real link away from it.
 *
 * The page itself is `PortalContextPage`, shared with the operator preview so
 * the two cannot drift; this route resolves the campaign and says where its two
 * navigational links point.
 */
export default async function PublicEngagementAboutPage({
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

  const search = searchStringFrom(resolvedSearch);
  const mapHref = search ? `/engage/${shareToken}?${search}` : `/engage/${shareToken}`;

  return (
    <PortalContextPage
      bundle={bundle}
      backHref={mapHref}
      languagePickerPathname={`/engage/${shareToken}/about`}
      languagePickerSearch={search}
    />
  );
}
