import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRANSLATION_LANGUAGE_NATIVE_LABELS } from "@/lib/engagement/translation-languages";
import {
  PORTAL_LOCALES,
  PORTAL_LOCALE_DIRECTION,
  portalLocaleHref,
  type ResolvedPortalLocale,
} from "@/lib/engagement/portal-i18n/locales";
import { createPortalTranslator, type PortalMessageBundle } from "@/lib/engagement/portal-i18n/translator";
import {
  portalMessageView,
  type PortalDisclosureView,
} from "@/lib/engagement/portal-i18n/provenance";

/**
 * THE LANGUAGE CHOOSER a member of the public uses.
 *
 * THREE DESIGN CONSTRAINTS, each of which rules something out:
 *
 * 1. IT MUST BE LEGIBLE TO SOMEONE WHO DOES NOT READ ENGLISH. That is the whole
 *    population it exists for. So every option is rendered in its OWN script —
 *    «Español», «한국어», «العربية» — never "Spanish", "Korean", "Arabic". A
 *    picker labelled in English is a locked door with the key inside.
 *
 * 2. THE CHOICE MUST BE SHAREABLE. The real use case is a flyer with a QR code
 *    that opens the Spanish portal, and an organiser forwarding a link that
 *    arrives in the language they sent. That means the language belongs in the
 *    URL. Every option here is a real `<a href>` carrying `?lang=`, so it can be
 *    copied, bookmarked, printed as a QR code, and read by a crawler.
 *
 * 3. IT MUST WORK WITHOUT JAVASCRIPT. Plain links, no hooks, no state, no
 *    client-side routing. This is the surface most likely to be opened on an old
 *    phone over a bad connection, and a `<select>` that only works once React
 *    has hydrated would strand exactly the residents this feature is for.
 *
 * Consequence of (3): no `useSearchParams`, so the component needs no Suspense
 * boundary and can be rendered from a server page or from inside the client
 * portal without changing shape. `pathname` and `search` arrive as props
 * because the page knows both and a hook would cost the no-JS guarantee.
 */
export function PortalLanguagePicker({
  locale,
  messages,
  pathname,
  search,
  className,
}: {
  locale: ResolvedPortalLocale;
  messages: PortalMessageBundle;
  /** The path this page is served at, e.g. `/engage/<token>`. */
  pathname: string;
  /** The current query string, so switching language keeps everything else. */
  search?: string | null;
  className?: string;
}) {
  const translator = createPortalTranslator(messages);

  return (
    <nav
      aria-label={translator.t("language.pickerLabel")}
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground">
        <Languages className="h-3.5 w-3.5" aria-hidden="true" />
        {translator.t("language.pickerLabel")}
      </span>

      <ul className="flex flex-wrap items-center gap-1">
        {PORTAL_LOCALES.map((candidate) => {
          const current = candidate === locale.locale;
          const nativeName = TRANSLATION_LANGUAGE_NATIVE_LABELS[candidate];

          return (
            <li key={candidate}>
              <a
                href={portalLocaleHref(pathname, search, candidate)}
                // The language of the LINK TEXT, not of the page — a screen
                // reader told the page is English will otherwise pronounce
                // «한국어» as English, which is the one word in the list that
                // has to be recognisable.
                lang={candidate}
                dir={PORTAL_LOCALE_DIRECTION[candidate]}
                hrefLang={candidate}
                aria-current={current ? "true" : undefined}
                // The accessible name says what the link DOES, in the language
                // the reader is currently being served.
                aria-label={
                  current
                    ? translator.t("language.current", { language: nativeName })
                    : translator.t("language.switchTo", { language: nativeName })
                }
                className={cn(
                  "inline-block rounded-full border px-2.5 py-1 transition-colors",
                  current
                    ? "border-primary/60 bg-primary/10 font-semibold text-foreground"
                    : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {nativeName}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * WHAT THIS PAGE IS NOT SAYING IN THE PARTICIPANT'S LANGUAGE.
 *
 * A partly translated page that does not say so is worse than an English one:
 * English text sitting unlabelled inside an otherwise Spanish page reads as
 * something the agency chose to write in English, and an agency can be held to
 * what it appears to have published. This renders the two disclosures the
 * resolved locale makes possible, and renders nothing when there is nothing to
 * disclose.
 *
 * KNOWN LIMIT, stated because it will be visible: for a language with no
 * catalog yet, this notice itself falls back to English — it is one of the keys
 * that is missing. That is why `messages.ts` tells a translator to do
 * `language.partialNotice` FIRST, and why the notice is rendered next to the
 * picker, whose options are always in their own script.
 *
 * And because that limit is REAL rather than hypothetical for nine of the eleven
 * languages, each sentence carries its own `lang` and `dir` from
 * `portalMessageView` instead of inheriting the page's. The alternative is the
 * sentence that exists to admit the page is not in the participant's language
 * being itself labelled as if it were — announced to a screen reader with the
 * wrong phonology, and laid out from the wrong edge inside an RTL page. Two
 * elements rather than one joined string for the same reason: a partial catalog
 * can carry one of these keys and not the other, and then a single `lang` would
 * be wrong for one of them.
 */
export function PortalLanguageNotice({
  locale,
  messages,
  className,
}: {
  locale: ResolvedPortalLocale;
  messages: PortalMessageBundle;
  className?: string;
}) {
  const translator = createPortalTranslator(messages);
  const notices: PortalDisclosureView[] = [];

  // Said first, because it explains why the page is not in the language the
  // link promised — a resident who followed a Somali link and got English is
  // owed that sentence before anything else on the page.
  if (locale.unsupportedRequest) {
    notices.push(
      portalMessageView(translator, "language.unsupportedNotice", {
        requested: locale.unsupportedRequest,
        language: locale.nativeName,
      })
    );
  }

  if (translator.hasFallbacks) {
    notices.push(
      portalMessageView(translator, "language.partialNotice", { language: locale.nativeName })
    );
  }

  if (notices.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900",
        "dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100",
        className
      )}
    >
      {notices.map((notice) => (
        <p key={notice.sentence} lang={notice.lang} dir={notice.dir}>
          {notice.sentence}
        </p>
      ))}
    </div>
  );
}
