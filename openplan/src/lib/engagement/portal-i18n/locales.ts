/**
 * WHICH LANGUAGE A PARTICIPANT SEES — decided once, server-side, for every
 * participant surface at the same time.
 *
 * The engagement module could already translate a resident's comment into every
 * language it carries and could not ask its own question in any of them. Closing
 * that starts here, with the one decision every other piece depends on: which
 * language IS this page in.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A HOOK PER SURFACE. The portal has twice
 * shipped a defect where two surfaces computed the same fact differently — the
 * map camera, and then the map's disclosure sentence — and the second one was
 * wrong in front of members of the public. A language is a worse thing to get
 * inconsistent than a camera: a page whose heading is Spanish and whose form is
 * English is not a partly-translated page, it is a page that looks like the
 * agency chose to answer in English. So `loadPublicPortalBundle` resolves this
 * ONCE and hands the same answer to everything it renders.
 *
 * WHY THE CHOICE IS IN THE URL. The actual use case is a flyer with a QR code
 * that opens the Spanish portal, and a community organiser forwarding a link
 * that stays in the language they sent it in. A cookie cannot be put on a
 * poster and cannot be forwarded. `?lang=` can.
 *
 * CLIENT-SAFE. Constants and pure functions only. `translation.ts` reaches the
 * Anthropic access layer (node:crypto) and must never enter a browser bundle;
 * nothing here imports it.
 */

import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_LABELS,
  TRANSLATION_LANGUAGE_NATIVE_LABELS,
  isTranslationLanguage,
  type TranslationLanguage,
} from "../translation-languages";

/**
 * A portal locale IS a translation language. Deliberately an alias rather than
 * a new union: the languages OpenPlan will translate a comment INTO and the
 * languages it will show its own page IN must be the SAME set, or a resident
 * can read the comments and not the question above them.
 *
 * THE SET IS THE SAME; THE CAPABILITIES ARE NOT, AND THAT IS A REAL DIVERGENCE
 * RATHER THAN A COINCIDENCE. Navajo is a portal locale whose comment
 * translation is refused outright — see `MACHINE_TRANSLATION_UNAVAILABLE` in
 * `translation-languages.ts`. So a Diné portal does show an agency's own words,
 * written and reviewed by people, and cannot machine-translate the residents'
 * comments underneath them. That asymmetry is defensible in exactly one
 * direction: a human-written page in somebody's language is language access
 * working, while a model's unreliable guess published under an agency's name in
 * a Title VI context is not. The failure this alias exists to prevent is the
 * page being unreadable while the comments are readable — a resident meeting a
 * question they cannot read. The exception runs the other way, and it is the
 * refusal being visible on the surface that keeps it honest: a locale that
 * declines a capability says so where a planner reads it, instead of being
 * quietly dropped from a second union nobody would keep in step with this one.
 */
export type PortalLocale = TranslationLanguage;

export const PORTAL_LOCALES = TRANSLATION_LANGUAGES;

/**
 * The guard, re-exported under the portal's own name so nothing in this module
 * has to reach past the taxonomy for it. It IS `isTranslationLanguage` — a
 * second implementation would be a second list.
 */
export const isPortalLocale: (value: unknown) => value is PortalLocale = isTranslationLanguage;

/**
 * The locale a portal falls back to when nothing else answers.
 *
 * A product default, changeable in one line — not a claim that participants are
 * English speakers, and not a jurisdiction assumption. Everything that renders
 * a fallback is required to SAY it fell back; see `PortalMessageBundle` and
 * `PortalText`.
 */
export const PORTAL_DEFAULT_LOCALE: PortalLocale = "en";

/** The query parameter that carries an explicit choice. Shareable by design. */
export const PORTAL_LOCALE_QUERY_PARAM = "lang";

export type PortalTextDirection = "ltr" | "rtl";

/**
 * Which way each language's script runs.
 *
 * NOT optional polish. The map below is the list, and Arabic, Farsi and Urdu
 * currently sit on the `rtl` side of it — a page that does not set `dir="rtl"`
 * for them renders punctuation on the wrong side, left-aligns every paragraph,
 * and puts the form's submit button where a right-to-left reader does not look
 * for it. A language shipping visibly broken to everyone who reads it is not a
 * rounding error, and the right-to-left side of this map has already grown once.
 *
 * It lives beside the locale rather than in `translation-languages.ts` because
 * direction is a fact about LAYING OUT A PAGE, and nothing in the comment
 * translation engine has a page. It is carried on `ResolvedPortalLocale` so no
 * component ever re-derives it — a component that re-derives is a component
 * that can be forgotten.
 */
export const PORTAL_LOCALE_DIRECTION: Record<PortalLocale, PortalTextDirection> = {
  en: "ltr",
  es: "ltr",
  zh: "ltr",
  vi: "ltr",
  tl: "ltr",
  ko: "ltr",
  ar: "rtl",
  hy: "ltr",
  fa: "rtl",
  ru: "ltr",
  pa: "ltr",
  hmn: "ltr",
  km: "ltr",
  ht: "ltr",
  pt: "ltr",
  so: "ltr",
  am: "ltr",
  fr: "ltr",
  // Urdu is the third right-to-left language here, and it arrived with the 2026
  // expansion rather than with Arabic and Farsi — which is exactly how a
  // direction map goes stale. TypeScript requires an entry per locale, so the
  // compiler catches a MISSING language; only a reader catches a wrong one.
  ur: "rtl",
  bn: "ltr",
  pl: "ltr",
  nv: "ltr",
};

/**
 * Tags a browser genuinely sends that mean one of the languages we carry.
 *
 * Chrome on a Philippine handset sends `fil`, not `tl`. A Chinese browser sends
 * `zh-Hans-CN`. An Afghan Dari browser sends `prs`. Without this map every one
 * of those falls through to English while the resident's phone is set to their
 * language and the portal has their language available — which is the worst of
 * the possible failures, because it looks like a deliberate choice.
 *
 * This is language taxonomy, the same class of reviewed constant as the
 * language list itself. It is NOT a country or region assumption: region
 * subtags are discarded before this map is consulted, so `es-MX`, `es-US` and
 * `es-ES` are one language, and no entry here names a place.
 */
const PORTAL_LOCALE_ALIASES: Record<string, PortalLocale> = {
  eng: "en",
  spa: "es",
  zho: "zh",
  chi: "zh",
  cmn: "zh",
  yue: "zh",
  vie: "vi",
  fil: "tl",
  tgl: "tl",
  kor: "ko",
  ara: "ar",
  arb: "ar",
  hye: "hy",
  arm: "hy",
  fas: "fa",
  per: "fa",
  pes: "fa",
  prs: "fa",
  rus: "ru",
  pan: "pa",
  pnb: "pa",
  // The 2026 expansion. Three-letter forms are what browsers and OS locales
  // actually send for these; the Hmong dialect codes (mww/hnj) and Farsi's prs
  // above are the same shape of alias — a real tag a real handset emits.
  mww: "hmn",
  hnj: "hmn",
  khm: "km",
  hat: "ht",
  por: "pt",
  som: "so",
  amh: "am",
  fra: "fr",
  fre: "fr",
  urd: "ur",
  ben: "bn",
  pol: "pl",
  nav: "nv",
};

/**
 * Narrow any language tag to one of the languages this portal carries, or to
 * null.
 *
 * Region, script and variant subtags are dropped: OpenPlan carries one Spanish,
 * and pretending otherwise would multiply the whole list several times over —
 * one catalog per region a browser can name. Returning null rather than a guess
 * is what lets the caller fall THROUGH to the next source of truth instead of
 * showing the wrong language confidently.
 */
export function normalizePortalLocaleTag(raw: string | null | undefined): PortalLocale | null {
  if (typeof raw !== "string") return null;

  const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (!primary) return null;
  if (isTranslationLanguage(primary)) return primary;

  return PORTAL_LOCALE_ALIASES[primary] ?? null;
}

/**
 * The best supported language named by an `Accept-Language` header.
 *
 * Honoured because a resident who set their phone to Vietnamese has already
 * told us, and making them tell us again — in English, on a page they cannot
 * read — is the whole problem restated. Quality values are respected in the
 * order the header declares them; a malformed q is treated as the RFC's
 * default of 1 rather than as a reason to ignore the entry.
 */
export function parseAcceptLanguage(header: string | null | undefined): PortalLocale | null {
  if (typeof header !== "string" || !header.trim()) return null;

  const entries = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.split(";").map((piece) => piece.trim());
      const qParam = params.find((piece) => piece.toLowerCase().startsWith("q="));
      const parsed = qParam ? Number.parseFloat(qParam.slice(2)) : Number.NaN;
      const quality = Number.isFinite(parsed) ? parsed : 1;
      return { tag, quality, index };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    // Stable: equal q values keep the order the browser stated them in.
    .sort((a, b) => (b.quality - a.quality) || (a.index - b.index));

  for (const entry of entries) {
    // `*` means "anything", which is not a request for a particular language.
    if (entry.tag === "*") continue;
    const locale = normalizePortalLocaleTag(entry.tag);
    if (locale) return locale;
  }

  return null;
}

/**
 * The `?lang=` value, cleaned up before anything is decided about it or said
 * with it.
 *
 * `unsupportedRequest` below is the ONE participant-facing string in this module
 * whose content a stranger chooses: anybody can put anything in a URL and
 * forward it, and the portal quotes it back inside "…opened with a language (X)
 * that is not available here". React escapes markup, so the hazard is not
 * script — it is INVISIBLE characters. A Unicode bidi override (U+202E) inside
 * that value reverses the display order of the text that follows it, on a page
 * that deliberately supports right-to-left languages and therefore cannot treat
 * direction marks as noise; a newline or a C0 control breaks the sentence apart.
 * Either would let a forwarded link change what an agency's page appears to say.
 *
 * Cleaned BEFORE the tag is matched, not merely before it is shown, and that
 * order is the point: `es` with an invisible override stuck to it would
 * otherwise fail to match a language this portal does carry and then be quoted
 * back as unavailable — a false sentence about the agency's own coverage.
 *
 * `\p{C}` is every control, format, surrogate, private-use and unassigned code
 * point. Iterating by code point rather than by UTF-16 unit also stops the
 * length cap from cutting a character in half. Nothing else is restricted: a
 * resident may have been sent a link naming a language in its own script, and
 * an ASCII-only filter would silently turn that into no disclosure at all.
 */
function sanitizeRequestedTag(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const cleaned = Array.from(
    // Whitespace FIRST, and the order is not cosmetic: a newline is itself a
    // control character, so deleting controls before collapsing whitespace glues
    // the words on either side of it together and reports back a "language" the
    // resident never sent.
    raw.replace(/\s+/g, " ")
  )
    .filter((character) => !/^\p{C}$/u.test(character))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, 40).join("");
}

/** Where the answer came from. Carried so a surface can explain itself. */
export type PortalLocaleSource = "url" | "accept_language" | "default";

export type ResolvedPortalLocale = {
  locale: PortalLocale;
  direction: PortalTextDirection;
  /** For `Intl` and for the `lang` attribute. */
  bcp47: string;
  /** The language's name in its own script — what a picker must render. */
  nativeName: string;
  /** The language's name in English — for operator surfaces and logs. */
  englishName: string;
  source: PortalLocaleSource;
  /**
   * The `?lang=` value when it named a language this portal does not carry,
   * cleaned of control and formatting characters by `sanitizeRequestedTag`.
   *
   * A tag we do not support FALLS BACK; it never 404s, because a bad language
   * in a forwarded URL must not make the consultation unreachable. But the
   * fallback is recorded rather than swallowed: a resident who followed a link
   * promising Somali and got English is owed the sentence saying so, and only
   * this field lets a surface build it.
   *
   * It is the one string here a STRANGER writes, since it comes out of a URL
   * anybody can forward. See `sanitizeRequestedTag` for what is removed and
   * why the removal happens before the tag is matched rather than after.
   */
  unsupportedRequest: string | null;
};

function resolved(
  locale: PortalLocale,
  source: PortalLocaleSource,
  unsupportedRequest: string | null
): ResolvedPortalLocale {
  return {
    locale,
    direction: PORTAL_LOCALE_DIRECTION[locale],
    bcp47: locale,
    nativeName: TRANSLATION_LANGUAGE_NATIVE_LABELS[locale],
    englishName: TRANSLATION_LANGUAGE_LABELS[locale],
    source,
    unsupportedRequest,
  };
}

/**
 * THE PRECEDENCE, most explicit first:
 *
 *   1. `?lang=` — someone SAID which language. A QR code on a flyer, a link an
 *      organiser forwarded, a resident who used the picker. An explicit choice
 *      outranks a device setting, always.
 *   2. `Accept-Language` — the resident's own device, narrowed to what this
 *      portal carries. Not a choice, but not a guess either.
 *   3. The portal default. Reached only when nobody said anything.
 *
 * A `?lang=` naming an unsupported language falls through to 2 and 3 rather
 * than failing, and the raw value is carried out so the page can disclose it.
 */
export function resolvePortalLocale(input: {
  requested?: string | null;
  acceptLanguage?: string | null;
}): ResolvedPortalLocale {
  const rawRequest = sanitizeRequestedTag(input.requested);
  const requested = normalizePortalLocaleTag(rawRequest);
  if (requested) return resolved(requested, "url", null);

  const unsupportedRequest = rawRequest;

  const fromHeader = parseAcceptLanguage(input.acceptLanguage);
  if (fromHeader) return resolved(fromHeader, "accept_language", unsupportedRequest);

  return resolved(PORTAL_DEFAULT_LOCALE, "default", unsupportedRequest);
}

/**
 * A URL that keeps everything about the current page except the language.
 *
 * One implementation because the picker, a "read this in English" escape hatch,
 * and any share affordance must all produce the SAME link — a picker whose
 * links quietly dropped the campaign's other query parameters would send a
 * resident somewhere subtly different from where they were.
 */
export function portalLocaleHref(
  pathname: string,
  currentSearch: URLSearchParams | string | null | undefined,
  locale: PortalLocale
): string {
  const params = new URLSearchParams(
    typeof currentSearch === "string" ? currentSearch : currentSearch ? currentSearch.toString() : ""
  );
  params.set(PORTAL_LOCALE_QUERY_PARAM, locale);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
