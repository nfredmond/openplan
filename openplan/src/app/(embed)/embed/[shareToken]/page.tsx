import { notFound } from "next/navigation";
import { PublicMapShell } from "@/components/engagement/public-map-shell";
import { PortalAccessibilityNotice } from "@/components/engagement/portal-accessibility-notice";
import {
  PortalLanguageNotice,
  PortalLanguagePicker,
} from "@/components/engagement/portal-language-picker";
import { loadPublicPortalBundle } from "@/lib/engagement/public-portal-data";
import { buildPortalMapShellProps } from "@/lib/engagement/portal-surface-props";
import { portalSearchString } from "@/lib/engagement/portal-search-params";
import { PORTAL_LOCALE_QUERY_PARAM } from "@/lib/engagement/portal-i18n/locales";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

type PageSearchParams = Record<string, string | string[] | undefined>;

/**
 * The explicit language choice, out of the URL — the SAME reading the full
 * public page does, because an iframe's `src` carries a query string exactly
 * like an address bar does.
 *
 * A repeated `?lang=` (which a hand-edited or double-appended embed snippet
 * produces) yields an array; the first entry wins rather than the request being
 * refused. An agency that mangled its own iframe snippet must still get a
 * working consultation.
 */
function requestedLocaleFrom(searchParams: PageSearchParams | undefined): string | null {
  const raw = searchParams?.[PORTAL_LOCALE_QUERY_PARAM];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

/**
 * THE EMBEDDABLE WIDGET IS THE MAP, the same map-first surface `/engage/<token>`
 * serves, inside an agency's own `<iframe>`. Same service-role read, share-token
 * gate, and rate-limited, moderated write paths as the full page.
 *
 * Until 2026-10-10 it served the older tabbed page with a small inline map, so
 * the version most residents meet on an agency's site was the weaker one.
 *
 * TWO THINGS DIFFER FROM THE FULL PAGE. The one door opens in a new tab, because
 * every page outside `/embed` refuses to be framed and would load blank inside
 * the iframe. And the rail ends with an attribution, because the widget sits
 * inside somebody else's site.
 */
export default async function EmbedEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ shareToken: string }>;
  searchParams?: Promise<PageSearchParams>;
}) {
  const { shareToken } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const bundle = await loadPublicPortalBundle(shareToken, {
    requestedLocale: requestedLocaleFrom(resolvedSearch),
  });
  if (!bundle) {
    notFound();
  }

  const { campaign, campaignText, locale, messages } = bundle;
  const translator = createPortalTranslator(messages);
  const search = portalSearchString(resolvedSearch);

  return (
    <main dir={locale.direction} lang={locale.bcp47}>
      <PublicMapShell
        {...buildPortalMapShellProps(bundle)}
        detailsHref={search ? `/engage/${shareToken}/about?${search}` : `/engage/${shareToken}/about`}
        detailsTarget="_blank"
        languageChrome={
          <div className="flex flex-col gap-2">
            <PortalLanguagePicker
              locale={locale}
              messages={messages}
              pathname={`/embed/${shareToken}`}
              search={search}
            />
            <PortalLanguageNotice locale={locale} messages={messages} />
          </div>
        }
        accessibilityNotice={
          <PortalAccessibilityNotice
            contactLabel={campaignText.accessibilityContactLabel}
            alternateFormats={campaignText.accessibilityAlternateFormats}
            email={campaign.accessibility_contact_email}
            phone={campaign.accessibility_contact_phone}
            translator={translator}
          />
        }
        // English, marked as English: it has no catalog key and is a product
        // name, not a sentence a resident needs translated.
        railFooter={
          <p className="text-xs text-muted-foreground" lang="en" dir="ltr">
            Powered by OpenPlan
          </p>
        }
      />
    </main>
  );
}
