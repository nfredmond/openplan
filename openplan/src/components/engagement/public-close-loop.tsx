/**
 * THE "YOU SAID / WE DID" LEDGER, as a member of the public reads it.
 *
 * Presentational only — the public page loads published close-loop entries with
 * the service-role client (campaign-scoped) and passes them in. No client fetch.
 *
 * EVERY STRING HERE IS ONE OF TWO KINDS, and they are rendered differently on
 * purpose:
 *
 *   OpenPlan's own chrome — "You said", "We did", the empty state — comes from
 *     the participant message catalog through the translator, because it is copy
 *     OpenPlan wrote and can ship in the participant's language.
 *   The agency's own words — the theme, what was heard, what was done — come
 *     through `PortalText`, which carries whether a person at the agency wrote
 *     this translation or a machine did.
 *
 * Rendering those two identically is the Title VI failure the portal-i18n layer
 * exists to prevent: it publishes a model's wording as the agency's own. So the
 * agency's text is rendered with its provenance beside it and with `lang` set to
 * the language it is ACTUALLY in — a screen reader told the page is Spanish
 * would otherwise pronounce an untranslated English paragraph with Spanish
 * phonology, which is close to unintelligible.
 *
 * AND `dir` TRAVELS WITH `lang` EVERY TIME, because no browser derives one from
 * the other. Some of the languages this portal carries are right-to-left, so a
 * page can hold an English commitment inside an Arabic portal or an agency's
 * Arabic inside an English one, and either laid out from the wrong edge is a
 * defect a sighted reader sees immediately. Both attributes come from one fact
 * — the `PortalText.textLocale` for the agency's words, the key's own fallback
 * state (via `portalMessageView`) for OpenPlan's.
 */

import { PORTAL_LOCALE_DIRECTION } from "@/lib/engagement/portal-i18n/locales";
import {
  portalMessageView,
  portalTextBadge,
  portalTextDisclosureView,
  portalTextLang,
} from "@/lib/engagement/portal-i18n/provenance";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";

export type PublicCloseLoopEntry = {
  id: string;
  /**
   * The SOURCE strings, in whatever language the agency authored them in.
   *
   * Kept, and deliberately NOT rendered here. They are what the `*Text` fields
   * below were resolved FROM, and a surface that renders them is rendering the
   * original — sometimes right on an operator console, never right on a
   * participant page. They stay on the type because `loadPublicPortalBundle`
   * builds them and because an operator-facing preview may yet want the
   * untranslated record.
   */
  themeTitle: string;
  youSaid: string;
  weDid: string;
  categoryLabel: string | null;
  /**
   * The same four strings resolved for THIS participant's language, each
   * carrying its provenance. Required rather than optional: the recurring defect
   * in this repo is a finished capability made unreachable by a prop nobody
   * passed, and an optional translation is one a caller can silently omit —
   * which renders the source language with no disclosure and looks like a
   * deliberate choice by the agency.
   */
  themeTitleText: PortalText;
  youSaidText: PortalText;
  weDidText: PortalText;
  categoryLabelText: PortalText | null;
};

/**
 * One piece of the agency's own text with what is true about it.
 *
 * The badge sits IMMEDIATELY beside the words it qualifies, never in a footer:
 * a resident reading a machine-translated commitment has to be able to see that
 * it is machine-translated without scrolling. The longer sentence follows
 * underneath for the reader who needs the whole caveat.
 *
 * `dir` TRAVELS WITH `lang`, ON THE SAME ELEMENT. No browser derives direction
 * from a language tag, so a commitment the agency wrote in English, shown to a
 * participant who asked for Arabic, inherits the portal's `dir="rtl"` and is
 * laid out from the wrong edge unless this says otherwise — and an agency's own
 * Arabic shown on an English portal runs the wrong way for the same reason.
 * `PortalText.textLocale` already knows which language the words are in.
 *
 * The disclosure carries its own pair rather than the page's: every locale
 * except Spanish has no message catalog yet, so on those pages the caveat is the
 * English source sitting inside a page that declares itself Korean — the exact
 * mismatch the caveat exists to warn about, made by the warning.
 */
function OperatorLine({
  value,
  translator,
  className,
}: {
  value: PortalText;
  translator: PortalTranslator;
  className?: string;
}) {
  const badge = portalTextBadge(value, translator);
  // Non-null exactly when the badge is — both are null for, and only for, text
  // an agency wrote itself — so it is where the badge's own language comes from
  // too, with no second switch over provenance to drift from `provenance.ts`.
  const disclosure = portalTextDisclosureView(value, translator);

  return (
    <>
      <p className={className} lang={portalTextLang(value)} dir={PORTAL_LOCALE_DIRECTION[value.textLocale]}>
        {value.text}
      </p>
      {badge ? (
        <p
          className="mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground"
          lang={disclosure?.lang ?? translator.locale}
          dir={disclosure?.dir ?? translator.direction}
        >
          {badge}
        </p>
      ) : null}
      {disclosure ? (
        <p
          className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground"
          lang={disclosure.lang}
          dir={disclosure.dir}
        >
          {disclosure.sentence}
        </p>
      ) : null}
    </>
  );
}

export function PublicCloseLoop({
  entries,
  translator,
}: {
  entries: PublicCloseLoopEntry[];
  /**
   * The participant's language, already resolved. A `PortalTranslator` rather
   * than a `PortalMessageBundle` because this component is only ever rendered
   * from inside a surface that has already built one — rebuilding it here would
   * be a second copy of the same decision, and the portal has twice shipped a
   * defect where two surfaces computed the same fact differently.
   */
  translator: PortalTranslator;
}) {
  /*
    OpenPlan's OWN three strings here — "You said", "We did", and the empty state
    — each with the language it actually came out in.

    Every locale except Spanish carries no catalog yet, so on those pages
    `t("closeLoop.weDid")` returns the English source while the portal around it
    declares the participant's language. `portalMessageView` is the one place
    that decides which, and it is the same rule `portalTextDisclosureView`
    applies to the provenance sentences and `resolveOperatorText` applies to the
    agency's own words. Three kinds of string on this page, one rule about what
    `lang` may claim.
  */
  const empty = portalMessageView(translator, "closeLoop.empty");
  const youSaid = portalMessageView(translator, "closeLoop.youSaid");
  const weDid = portalMessageView(translator, "closeLoop.weDid");

  if (entries.length === 0) {
    return (
      <div className="public-success-state text-sm text-muted-foreground" lang={empty.lang} dir={empty.dir}>
        {empty.sentence}
      </div>
    );
  }

  return (
    <div className="public-ledger">
      {entries.map((entry) => {
        const themeBadge = portalTextBadge(entry.themeTitleText, translator);
        // Resolved once per entry rather than at each of the three places it is
        // consulted: the badge's language, the caveat's language, and the caveat
        // itself all come from the same fact, and computing it three times is
        // how two of them end up disagreeing.
        const themeDisclosure = portalTextDisclosureView(entry.themeTitleText, translator);

        return (
        <article key={entry.id} className="public-ledger-row">
          <div className="public-ledger-body">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className="public-ledger-title"
                lang={portalTextLang(entry.themeTitleText)}
                dir={PORTAL_LOCALE_DIRECTION[entry.themeTitleText.textLocale]}
              >
                {entry.themeTitleText.text}
              </h3>
              {themeBadge ? (
                <span
                  className="rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted-foreground"
                  lang={themeDisclosure?.lang ?? translator.locale}
                  dir={themeDisclosure?.dir ?? translator.direction}
                >
                  {themeBadge}
                </span>
              ) : null}
              {entry.categoryLabelText ? (
                <span
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                  lang={portalTextLang(entry.categoryLabelText)}
                  dir={PORTAL_LOCALE_DIRECTION[entry.categoryLabelText.textLocale]}
                >
                  {entry.categoryLabelText.text}
                </span>
              ) : null}
            </div>
            {/* The theme's own caveat, once, under the heading it qualifies. */}
            {themeDisclosure ? (
              <p
                className="mt-1 text-[0.7rem] leading-snug text-muted-foreground"
                lang={themeDisclosure.lang}
                dir={themeDisclosure.dir}
              >
                {themeDisclosure.sentence}
              </p>
            ) : null}
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p
                  className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground"
                  lang={youSaid.lang}
                  dir={youSaid.dir}
                >
                  {youSaid.sentence}
                </p>
                {entry.youSaidText.text.trim() ? (
                  <OperatorLine
                    value={entry.youSaidText}
                    translator={translator}
                    className="public-ledger-copy whitespace-pre-line"
                  />
                ) : (
                  // An em dash is the same character in every language on this
                  // list, so it needs no translation and no `lang`.
                  <p className="public-ledger-copy whitespace-pre-line">—</p>
                )}
              </div>
              <div>
                <p
                  className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground"
                  lang={weDid.lang}
                  dir={weDid.dir}
                >
                  {weDid.sentence}
                </p>
                {entry.weDidText.text.trim() ? (
                  <OperatorLine
                    value={entry.weDidText}
                    translator={translator}
                    className="public-ledger-copy whitespace-pre-line"
                  />
                ) : (
                  <p className="public-ledger-copy whitespace-pre-line">—</p>
                )}
              </div>
            </div>
          </div>
        </article>
        );
      })}
    </div>
  );
}
