"use client";

import { PORTAL_DEFAULT_LOCALE } from "@/lib/engagement/portal-i18n/locales";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";

/**
 * WHAT THIS SURFACE IS NOT SAYING IN THE PARTICIPANT'S LANGUAGE, said above the
 * English rather than after it.
 *
 * ══════════════════════════ THE GAP THE CATALOG CANNOT SEE
 *
 * `translator.hasFallbacks` reports keys this locale does not carry, and
 * `PortalLanguageNotice` discloses those. This one covers the gap the catalog
 * knows NOTHING about: participant-facing copy on a public surface that has no
 * catalog key at all. Today that is two things, both named in
 * `public-engagement-portal.tsx`'s header:
 *
 *   - `demographicLabel` — the age bands, languages, tenure and race/ethnicity
 *     OPTION text, which is shared with the operator console's aggregate views
 *     and must name a band identically there, so it cannot simply become catalog
 *     keys;
 *   - `PENDING_PORTAL_COPY` in `public-survey-form.tsx` — the survey's
 *     widget-level strings, several of which need an English plural the catalog
 *     has no mechanism to express.
 *
 * SO IT STAYS SILENT WHENEVER THE PAGE-WIDE ONE SPEAKS, which is exactly when
 * `translator.hasFallbacks` is true: `PortalLanguageNotice` renders the SAME
 * sentence from the SAME key on that condition, and a Korean portal printing it
 * twice reads as a bug and teaches a resident to skip both. The remaining case is
 * the one this notice was built for — a COMPLETE catalog like Spanish, where
 * nothing is falling back, the page-wide notice is correctly silent, and parts of
 * the surface are English anyway.
 *
 * A consequence worth naming, because it makes the `lang` below correct rather
 * than lucky: the only locales that reach the return statement are ones whose
 * catalog carries this key, so the sentence really is in `translator.locale`.
 *
 * IT MAY SAY SO SLIGHTLY MORE OFTEN THAN IT MUST — a closed Spanish campaign with
 * no survey and no demographics has no English on screen and still gets the
 * sentence. That direction is deliberate: the sentence is true of the surface
 * either way ("anything not yet translated is shown in English"), and the cost of
 * the other direction is a resident told nothing about English they are actually
 * reading.
 *
 * ═══════════════ WHY IT IS A MODULE AND NOT A FUNCTION IN ONE OF ITS CALLERS
 *
 * It WAS a function inside `public-engagement-portal.tsx`, and the consequence
 * was the defect this repository keeps paying for. `/engage/<token>` — the route
 * a resident reaches from a mailed postcard, and the busiest of the three — does
 * not render that component: it renders `PublicMapShell`. So a Spanish campaign
 * with demographics switched on published English option labels, on the main
 * public page, with nothing anywhere on it saying the English was a fallback
 * rather than the agency's choice. Under Title VI that is a claim about what the
 * agency published.
 *
 * THE INVARIANT: every surface that shows a member of the public any of the
 * untranslated copy named above renders this, and shows the page-wide
 * `PortalLanguageNotice` when there are fallbacks. A surface with neither is a
 * surface where untranslated copy goes undisclosed.
 */
export function PortalPendingCopyNotice({ translator }: { translator: PortalTranslator }) {
  // Nothing to disclose on an English portal: this copy is not missing, it is
  // the source.
  if (translator.locale === PORTAL_DEFAULT_LOCALE) return null;
  if (translator.hasFallbacks) return null;

  return (
    <p
      className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
      data-testid="portal-pending-copy-notice"
      lang={translator.bcp47}
      dir={translator.direction}
    >
      {translator.t("language.partialNotice", { language: translator.nativeName })}
    </p>
  );
}
