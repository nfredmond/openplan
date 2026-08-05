/**
 * WHAT A SURFACE SAYS ABOUT A PIECE OF OPERATOR TEXT.
 *
 * One implementation of the four sentences, because they are the sentences the
 * agency is answerable for and the failure mode of writing them at each render
 * site is that four surfaces end up making four slightly different claims — one
 * of which is wrong. Under Title VI the wrong one is the one that matters.
 *
 * Client-safe: pure functions over a `PortalText` and a `PortalTranslator`,
 * with type-only imports. Both the server page and the client portal call it.
 *
 * Language NAMES inside these sentences are rendered in their OWN script
 * («Español», «العربية») rather than in the reader's language. That is not
 * laziness — it avoids a matrix of every language's name written out in every
 * other language, and a resident who cannot read the sentence can still
 * recognise the name of their own language inside it.
 */

import { TRANSLATION_LANGUAGE_NATIVE_LABELS } from "../translation-languages";
import {
  PORTAL_DEFAULT_LOCALE,
  PORTAL_LOCALE_DIRECTION,
  type PortalLocale,
  type PortalTextDirection,
} from "./locales";
import type { PortalText } from "./operator-text";
import type { PortalMessageKey } from "./messages";
import type { PortalMessageValues, PortalTranslator } from "./translator";

/**
 * A short badge, or null when there is nothing to say.
 *
 * Null for `operator` and ONLY for `operator`: text an agency wrote or approved
 * needs no disclaimer, and adding one would train residents to ignore the badge
 * that appears on text a machine wrote.
 */
export function portalTextBadge(text: PortalText, translator: PortalTranslator): string | null {
  switch (text.provenance) {
    case "operator":
      return null;
    case "machine":
      return translator.t("provenance.machine.label");
    case "untranslated":
      return translator.t("provenance.untranslated.label");
    case "unreadable":
      return translator.t("provenance.unreadable.label");
  }
}

/**
 * A disclosure sentence together with WHAT LANGUAGE THE SENTENCE ITSELF IS IN.
 *
 * Only Spanish has a message catalog yet (English is the source these fall
 * back to), so on almost every non-English page this
 * sentence is the English source even though the page around it is not English.
 * Rendering it with the PAGE's `lang` tells a screen reader to pronounce English
 * words with Farsi or Korean phonology, which is close to unintelligible — and
 * inside a `dir="rtl"` page an English sentence with no direction of its own is
 * laid out from the wrong edge. Both are the same mistake the untranslated
 * OPERATOR text already avoids via `portalTextLang`; this is the equivalent for
 * OpenPlan's own copy, which can fall back independently of it.
 */
export type PortalDisclosureView = {
  sentence: string;
  /** For the `lang` attribute on the element that renders `sentence`. */
  lang: PortalLocale;
  /** For `dir` on that same element. Derived from the one direction map. */
  dir: PortalTextDirection;
};

/**
 * One key, resolved into the sentence AND the truth about which language it came
 * out in. Kept generic so the placeholders stay typed from the English source —
 * a wrong interpolation here would still be a build error.
 *
 * EXPORTED, because the disclosure sentences are not the only OpenPlan copy that
 * can fall back inside a page that is not English. The language notice beside the
 * picker — the sentence that tells a resident the page is only partly translated
 * — falls back on the same locales and for the same reason, and rendering
 * it under the page's own `lang` and `dir` is the same mistake. Anything that
 * puts one of this catalog's strings on screen inside a page of another language
 * should get its lang and direction from here rather than assume the page's.
 */
export function portalMessageView<K extends PortalMessageKey>(
  translator: PortalTranslator,
  key: K,
  ...values: PortalMessageValues<K>
): PortalDisclosureView {
  const lang = translator.isFallback(key) ? PORTAL_DEFAULT_LOCALE : translator.locale;
  return { sentence: translator.t(key, ...values), lang, dir: PORTAL_LOCALE_DIRECTION[lang] };
}

/** Local alias, so the switch below stays readable. */
const say = portalMessageView;

/**
 * The full sentence a resident reads, with the language it is written in. Null
 * when there is nothing to disclose.
 *
 * The `untranslated` case splits on whether the source language is a RECORD or
 * a PRESUMPTION, because only one of the two sentences may name a language. A
 * campaign written in Spanish whose operator never set a source language would
 * otherwise be described to a Vietnamese reader as "shown in English".
 *
 * ONE switch, two exports: `portalTextDisclosure` below is this function's
 * sentence and nothing else. A second switch that mapped provenance to a message
 * key would be a second statement of the same mapping, and the two would
 * eventually disagree about which sentence a state produces.
 */
export function portalTextDisclosureView(
  text: PortalText,
  translator: PortalTranslator
): PortalDisclosureView | null {
  const language = TRANSLATION_LANGUAGE_NATIVE_LABELS[text.requestedLocale];

  switch (text.provenance) {
    case "operator":
      return null;
    case "machine":
      return say(translator, "provenance.machine.caveat");
    case "untranslated":
      return text.textLocaleStated
        ? say(translator, "provenance.untranslated.knownSource", {
            language,
            sourceLanguage: TRANSLATION_LANGUAGE_NATIVE_LABELS[text.textLocale],
          })
        : say(translator, "provenance.untranslated.unknownSource", { language });
    case "unreadable":
      return say(translator, "provenance.unreadable.detail", { language });
  }
}

/** The disclosure sentence alone, for a surface that has nowhere to put `lang`. */
export function portalTextDisclosure(text: PortalText, translator: PortalTranslator): string | null {
  return portalTextDisclosureView(text, translator)?.sentence ?? null;
}

/**
 * The `lang` attribute for a rendered `PortalText`.
 *
 * A screen reader that is told a page is Spanish will pronounce an untranslated
 * English paragraph inside it as Spanish, which is close to unintelligible.
 * Marking the run in its actual language is the fix, and it is exactly the
 * information `PortalText` already carries.
 */
export function portalTextLang(text: PortalText): string {
  return text.textLocale;
}

/** True when this string is not in the language the participant asked for. */
export function portalTextIsFallback(text: PortalText): boolean {
  return text.provenance === "untranslated" || text.provenance === "unreadable";
}
