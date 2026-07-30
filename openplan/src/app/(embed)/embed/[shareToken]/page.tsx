import { notFound } from "next/navigation";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import { PortalOperatorText } from "@/components/engagement/portal-operator-text";
import { PortalAccessibilityNotice } from "@/components/engagement/portal-accessibility-notice";
import { loadPublicPortalBundle } from "@/lib/engagement/public-portal-data";
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
 * Embeddable engagement widget — same service-role + share_token + active gate
 * and the same rate-limited/honeypotted/moderated write paths as the full public
 * portal, in a stripped layout suitable for an <iframe> on an agency's site.
 *
 * IT IS A PARTICIPANT SURFACE, WITH EVERYTHING THAT IMPLIES. This route existed
 * for a while as the half of the language work that nothing reached: it called
 * the loader with no locale request (so `?lang=` was silently ignored and only
 * the device header could pick a language), it rendered `campaign.title` and
 * `campaign.public_description` RAW — the source strings, in the source
 * language, with no `lang` and no provenance — and it passed no
 * `renderLanguagePicker`, so the picker and the coverage notice this component
 * builds for exactly this surface had no caller outside the tests.
 *
 * The result an agency actually got was an unlabelled English header sitting
 * over a Spanish body, with no way to change language and nothing anywhere
 * saying the English was a fallback rather than the agency's choice. Under
 * Title VI those are claims about what the agency published, which is why the
 * fix is here rather than in a note.
 *
 * WHY THE PICKER COMES FROM THE PORTAL AND NOT FROM THIS FILE. The full public
 * page renders `PortalLanguagePicker` and `PortalLanguageNotice` in its own
 * header; this route has no header of its own to put them in, so the portal
 * renders both at the top of its wrapper when asked. Both surfaces therefore
 * show the same chrome exactly once — see `renderLanguagePicker`.
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

  const { campaign, campaignText, locale, messages, portalProps } = bundle;
  const translator = createPortalTranslator(messages);

  return (
    // `dir` and `lang` sit on this widget's own wrapper. The portal below sets
    // the same pair on its own wrapper — nesting the same value is a no-op —
    // but the header above it is outside that component, and without this an
    // Arabic or Farsi title lays out from the wrong edge.
    <main
      className="mx-auto w-full max-w-[72rem] px-3 py-4 sm:px-4"
      dir={locale.direction}
      lang={locale.bcp47}
    >
      <header className="mb-4 border-b border-border/60 pb-3">
        <PortalOperatorText
          as="h1"
          className="text-lg font-semibold text-foreground"
          value={campaignText.title}
          translator={translator}
        />
        {campaignText.publicDescription ? (
          <PortalOperatorText
            className="mt-1 text-sm text-muted-foreground"
            value={campaignText.publicDescription}
            translator={translator}
          />
        ) : campaignText.summary ? (
          <PortalOperatorText
            className="mt-1 text-sm text-muted-foreground"
            value={campaignText.summary}
            translator={translator}
          />
        ) : null}
      </header>

      <PublicEngagementPortal {...portalProps} renderLanguagePicker />

      {/*
        AFTER the portal, not before it: a resident who can use the page should
        meet the consultation first. A resident who cannot has a screen reader
        or a keyboard, and reaches a landmark at the end of the document far more
        reliably than they scroll past an offer they did not need.
      */}
      <PortalAccessibilityNotice
        contactLabel={campaignText.accessibilityContactLabel}
        alternateFormats={campaignText.accessibilityAlternateFormats}
        email={campaign.accessibility_contact_email}
        phone={campaign.accessibility_contact_phone}
        translator={translator}
      />

      <footer className="mt-6 border-t border-border/60 pt-3 text-center text-xs text-muted-foreground">
        {/*
          The link out and the attribution stay English for now: neither has a
          catalog key yet, and an element declaring the participant's language
          over English words is the failure this module exists to prevent. They
          are marked as what they are instead.
        */}
        <a
          href={`/engage/${shareToken}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground"
          lang="en"
          dir="ltr"
        >
          Open the full engagement page
        </a>
        <span className="mx-2">·</span>
        <span lang="en" dir="ltr">
          Powered by OpenPlan
        </span>
      </footer>
    </main>
  );
}
