import { describe, expect, it } from "vitest";
import {
  PORTAL_DEFAULT_LOCALE,
  PORTAL_LOCALES,
  PORTAL_LOCALE_DIRECTION,
  normalizePortalLocaleTag,
  parseAcceptLanguage,
  portalLocaleHref,
  resolvePortalLocale,
} from "@/lib/engagement/portal-i18n/locales";
import {
  EN_PORTAL_MESSAGES,
  PORTAL_MESSAGE_CATALOGS,
  buildPortalMessageBundle,
  type PortalMessageKey,
} from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import {
  portalMessageView,
  portalTextDisclosureView,
} from "@/lib/engagement/portal-i18n/provenance";
import { TRANSLATION_LANGUAGES } from "@/lib/engagement/translation-languages";

/**
 * One decision — which language a participant reads — asserted at the level a
 * resident experiences it: a link they were sent, a phone they already
 * configured, and what happens when neither says anything usable.
 */
describe("portal locale resolution", () => {
  it("uses the one language taxonomy rather than a second list", () => {
    // A parallel list is how the portal comes to offer a language the
    // translation engine cannot produce, or the reverse.
    expect(PORTAL_LOCALES).toBe(TRANSLATION_LANGUAGES);
    expect(Object.keys(PORTAL_LOCALE_DIRECTION).sort()).toEqual([...TRANSLATION_LANGUAGES].sort());
  });

  it("knows which two of the eleven read right to left", () => {
    // Not cosmetic: without this, Arabic and Farsi portals ship visibly broken.
    const rtl = PORTAL_LOCALES.filter((locale) => PORTAL_LOCALE_DIRECTION[locale] === "rtl");
    expect(rtl).toEqual(["ar", "fa"]);
  });

  it("lets an explicit choice in the URL win", () => {
    const resolved = resolvePortalLocale({ requested: "ko", acceptLanguage: "es-MX,es;q=0.9" });

    expect(resolved.locale).toBe("ko");
    expect(resolved.source).toBe("url");
    expect(resolved.nativeName).toBe("한국어");
    expect(resolved.unsupportedRequest).toBeNull();
  });

  it("honours the browser when the URL names nothing", () => {
    const resolved = resolvePortalLocale({ requested: null, acceptLanguage: "vi,en;q=0.4" });

    expect(resolved.locale).toBe("vi");
    expect(resolved.source).toBe("accept_language");
  });

  it("falls back to the portal default when nobody said anything", () => {
    const resolved = resolvePortalLocale({});

    expect(resolved.locale).toBe(PORTAL_DEFAULT_LOCALE);
    expect(resolved.source).toBe("default");
  });

  it("falls back rather than failing when a link names a language this portal does not carry", () => {
    // A forwarded link with a bad language must still open the consultation.
    const resolved = resolvePortalLocale({ requested: "so", acceptLanguage: "so,en;q=0.2" });

    expect(resolved.locale).toBe("en");
    expect(resolved.source).toBe("accept_language");
    // …and the resident is owed the sentence saying why, which only this field
    // makes possible.
    expect(resolved.unsupportedRequest).toBe("so");
  });

  it("never lets a hostile link change what the page appears to say", () => {
    // `unsupportedRequest` is the one participant-facing string here whose
    // content a stranger chooses, and the portal quotes it back inside a
    // sentence. React escapes markup, so the hazard is INVISIBLE characters: a
    // bidi override (U+202E) reverses the display order of everything after it,
    // on a page that supports right-to-left languages and therefore cannot treat
    // direction marks as noise, and a newline breaks the sentence apart.
    const hostile = resolvePortalLocale({
      requested: "‮gnitekram‬ is\nnot\ta language",
      acceptLanguage: null,
    });

    expect(hostile.locale).toBe(PORTAL_DEFAULT_LOCALE);
    expect(hostile.unsupportedRequest).toBe("gnitekram is not a language");

    // Bounded, so a forwarded link cannot put a paragraph of a stranger's prose
    // into an agency's page.
    const long = resolvePortalLocale({ requested: "x".repeat(500) });
    expect(long.unsupportedRequest).toHaveLength(40);

    // A value that was ONLY invisible characters named nothing, so there is
    // nothing to disclose — an empty parenthesis would be worse than silence.
    expect(resolvePortalLocale({ requested: "‮​" }).unsupportedRequest).toBeNull();
  });

  it("cleans a tag before matching it, not only before showing it", () => {
    // Otherwise `es` with an invisible character stuck to it fails to match a
    // language this portal DOES carry, and is then quoted back as unavailable —
    // a false sentence about the agency's own coverage, produced by the sentence
    // that exists to be honest about coverage.
    const resolved = resolvePortalLocale({ requested: "‎es‬" });

    expect(resolved.locale).toBe("es");
    expect(resolved.source).toBe("url");
    expect(resolved.unsupportedRequest).toBeNull();
  });

  it("derives direction in exactly one place for every language", () => {
    // Two surfaces computing the same fact differently has shipped here twice.
    // A language is a worse thing to get inconsistent than a map camera.
    for (const locale of PORTAL_LOCALES) {
      const resolved = resolvePortalLocale({ requested: locale });
      expect(resolved.direction, locale).toBe(PORTAL_LOCALE_DIRECTION[locale]);
      expect(resolved.bcp47, locale).toBe(locale);
    }
  });

  it("carries the direction and the script-native name with the answer", () => {
    // Carried rather than re-derived: a component that re-derives is a
    // component that can be forgotten.
    const arabic = resolvePortalLocale({ requested: "ar" });

    expect(arabic.direction).toBe("rtl");
    expect(arabic.nativeName).toBe("العربية");
    expect(arabic.englishName).toBe("Arabic");
    expect(arabic.bcp47).toBe("ar");
  });

  it("treats a region or script subtag as the same language", () => {
    // OpenPlan carries one Spanish. Pretending otherwise turns eleven catalogs
    // into forty.
    expect(normalizePortalLocaleTag("es-MX")).toBe("es");
    expect(normalizePortalLocaleTag("es_419")).toBe("es");
    expect(normalizePortalLocaleTag("ZH-HANT-TW")).toBe("zh");
  });

  it("recognises the tags browsers actually send for these languages", () => {
    // Chrome on a Philippine handset sends `fil`, not `tl`; an Afghan Dari
    // browser sends `prs`. Falling through to English there is the worst
    // failure available, because it looks deliberate.
    expect(normalizePortalLocaleTag("fil")).toBe("tl");
    expect(normalizePortalLocaleTag("prs")).toBe("fa");
    expect(normalizePortalLocaleTag("cmn-Hans-CN")).toBe("zh");
    expect(normalizePortalLocaleTag("nonsense")).toBeNull();
    expect(normalizePortalLocaleTag(undefined)).toBeNull();
  });

  it("respects Accept-Language quality ordering", () => {
    expect(parseAcceptLanguage("en;q=0.3, ko;q=0.9, ru;q=0.5")).toBe("ko");
    // Equal weights keep the order the browser stated.
    expect(parseAcceptLanguage("ru, ko")).toBe("ru");
    // A malformed q is the RFC default of 1, not a reason to drop the entry.
    expect(parseAcceptLanguage("hy;q=banana, en")).toBe("hy");
    // q=0 means "not this one".
    expect(parseAcceptLanguage("ko;q=0, ru")).toBe("ru");
    // A wildcard is not a request for a particular language.
    expect(parseAcceptLanguage("*")).toBeNull();
    expect(parseAcceptLanguage("")).toBeNull();
    // Languages this portal does not carry are skipped, not guessed at.
    expect(parseAcceptLanguage("so, sw, es")).toBe("es");
  });

  it("reads the headers browsers and proxies actually send, not only tidy ones", () => {
    // Region and script subtags, which is what a real header is mostly made of.
    expect(parseAcceptLanguage("zh-Hans-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(parseAcceptLanguage("es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("es");
    expect(parseAcceptLanguage("EN-us")).toBe("en");

    // RFC 7231 allows optional whitespace around the weight. Dropping the q here
    // would silently promote the resident's SECOND choice to their first.
    expect(parseAcceptLanguage("en ; q=0.5 , ru;q=0.9")).toBe("ru");

    // A parameter that is not a weight must not be read as one.
    expect(parseAcceptLanguage("en;foo=bar;q=0.5, ru;q=0.4")).toBe("en");

    // A wildcard is skipped however it is weighted — "anything" is not a request
    // for a particular language, and honouring it would mean guessing.
    expect(parseAcceptLanguage("*;q=0.9,ko;q=0.1")).toBe("ko");

    // Nothing here may throw on input a header can carry. A public participant
    // page is the wrong place to discover that a proxy sent something odd.
    for (const malformed of [";;;", ",,", "q=0.5", "und", "  ", "-es", "_es", "e", "x".repeat(5000)]) {
      expect(parseAcceptLanguage(malformed), JSON.stringify(malformed)).toBeNull();
    }
  });

  it("builds a shareable link that changes only the language", () => {
    // The use case is a QR code on a flyer and an organiser forwarding a link.
    expect(portalLocaleHref("/engage/tok", "tab=survey&lang=en", "fa")).toBe(
      "/engage/tok?tab=survey&lang=fa"
    );
    expect(portalLocaleHref("/engage/tok", null, "es")).toBe("/engage/tok?lang=es");
    expect(portalLocaleHref("/engage/tok", new URLSearchParams("a=1"), "ru")).toBe(
      "/engage/tok?a=1&lang=ru"
    );
  });

  it("keeps a share flow's own parameters intact and re-encodes them", () => {
    // The query string reaching this function IS participant-controlled — the
    // page rebuilds it from the URL it was opened with — so it has to survive a
    // round trip without either losing a campaign's deep link or escaping the
    // query context of the href it lands in.
    const href = portalLocaleHref("/engage/tok", "tab=survey&q=a b&next=/engage/tok?x=1", "ko");

    const [path, query] = href.split("?");
    expect(path).toBe("/engage/tok");
    const params = new URLSearchParams(query);
    expect(params.get("tab")).toBe("survey");
    expect(params.get("q")).toBe("a b");
    expect(params.get("next")).toBe("/engage/tok?x=1");
    expect(params.get("lang")).toBe("ko");

    // A quote or an angle bracket cannot leave the value it arrived in.
    const escaped = portalLocaleHref("/engage/tok", 'q="><script>', "ko");
    expect(escaped).not.toContain('"');
    expect(escaped).not.toContain("<");
    expect(new URLSearchParams(escaped.split("?")[1]).get("q")).toBe('"><script>');

    // A repeated language — which a double-appended link produces — collapses to
    // one, rather than leaving the page to pick between two.
    expect(portalLocaleHref("/engage/tok", "lang=en&lang=fa", "ko")).toBe("/engage/tok?lang=ko");
  });
});

/**
 * WHAT THE PORTAL SAYS ABOUT ITS OWN COVERAGE, and whether it is measurable.
 *
 * A partly translated page is fine. A partly translated page that does not know
 * it is partly translated is not: unlabelled English inside an otherwise Spanish
 * page tells a resident the agency chose to write it that way, which under Title
 * VI is a claim about what the agency published. Every assertion here is about
 * the honesty of that self-report rather than about any particular language being
 * finished — a translation lands key by key, and a locale that is 40% done must
 * be shippable and must say so.
 */
const ALL_MESSAGE_KEYS = Object.keys(EN_PORTAL_MESSAGES) as PortalMessageKey[];

const placeholdersIn = (value: string): string[] =>
  [...new Set(value.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort();

describe("portal message coverage", () => {
  it("reports exactly the keys that fell back, in every language it offers", () => {
    // `translatedKeyCount` and `hasFallbacks` are what a page's own disclosure is
    // built from, so a count that drifts from the catalog is a page telling a
    // resident something untrue about what they are reading.
    for (const locale of PORTAL_LOCALES) {
      const bundle = buildPortalMessageBundle(resolvePortalLocale({ requested: locale }));
      const translator = createPortalTranslator(bundle);
      const catalog = PORTAL_MESSAGE_CATALOGS[locale] ?? {};

      const genuinelyMissing = ALL_MESSAGE_KEYS.filter((key) => {
        const value = catalog[key];
        return typeof value !== "string" || value.trim().length === 0;
      });

      // English asking for English is not a fallback; reporting one would put a
      // "not fully translated" banner on every English portal in the product.
      const expected = locale === PORTAL_DEFAULT_LOCALE ? [] : genuinelyMissing;

      expect([...bundle.fallbackKeys].sort(), locale).toEqual([...expected].sort());
      expect(translator.totalKeyCount, locale).toBe(ALL_MESSAGE_KEYS.length);
      expect(translator.translatedKeyCount, locale).toBe(ALL_MESSAGE_KEYS.length - expected.length);
      expect(translator.hasFallbacks, locale).toBe(expected.length > 0);

      // A key that fell back is shown in English, and says so. Both halves
      // matter: the string has to be readable AND labelled.
      for (const key of bundle.fallbackKeys) {
        expect(bundle.messages[key], `${locale} ${key}`).toBe(EN_PORTAL_MESSAGES[key]);
        expect(translator.isFallback(key), `${locale} ${key}`).toBe(true);
      }
    }
  });

  it("never renders a placeholder to the public because a translation renamed one", () => {
    // The hole in the type-level checking below, and the reason it is worth a
    // test: call sites are checked against the ENGLISH source, so `t()` cannot be
    // called wrongly — but a translated value is just a string, and a Spanish
    // sentence that writes {idioma} where English wrote {language} compiles, then
    // renders literal braces to a member of the public. `interpolate` leaves an
    // unknown token verbatim on purpose (a visible defect is findable), so this
    // is the only thing standing between that choice and a public page.
    const drift: string[] = [];

    for (const [locale, catalog] of Object.entries(PORTAL_MESSAGE_CATALOGS)) {
      for (const key of ALL_MESSAGE_KEYS) {
        const translated = catalog?.[key];
        if (typeof translated !== "string") continue;

        const source = placeholdersIn(EN_PORTAL_MESSAGES[key]);
        const mine = placeholdersIn(translated);
        if (source.join(",") !== mine.join(",")) {
          drift.push(`${locale} ${key}: english ${source.join(" ") || "none"} / translated ${mine.join(" ") || "none"}`);
        }
      }
    }

    expect(drift).toEqual([]);
  });

  it("offers a language with no catalog yet honestly, rather than hiding it", () => {
    // The alternative — dropping an untranslated language from the picker — would
    // make the portal look like it has no such language, when what is true is
    // that OpenPlan's chrome is not translated yet while the agency's own content
    // may well be.
    // English is deliberately absent from PORTAL_MESSAGE_CATALOGS — it is the
    // SOURCE, not a translation of anything — so it is not one of these.
    const untranslated = PORTAL_LOCALES.filter(
      (locale) => locale !== PORTAL_DEFAULT_LOCALE && !PORTAL_MESSAGE_CATALOGS[locale]
    );
    expect(untranslated.length).toBeGreaterThan(0);

    for (const locale of untranslated) {
      const translator = createPortalTranslator(
        buildPortalMessageBundle(resolvePortalLocale({ requested: locale }))
      );

      expect(translator.translatedKeyCount, locale).toBe(0);
      expect(translator.hasFallbacks, locale).toBe(true);
      // Still readable: the English source, not a blank.
      expect(translator.t("portal.submit"), locale).toBe(EN_PORTAL_MESSAGES["portal.submit"]);
    }
  });

  it("says which language its own disclosure sentence is written in", () => {
    // The sentence that admits a page is not in the participant's language is
    // itself one of the strings that falls back — for nine of the eleven
    // locales it IS the English source. Labelling it with the page's `lang`
    // tells a screen reader to pronounce English with Farsi phonology, and
    // inside a `dir="rtl"` page an English sentence with no direction of its own
    // lays out from the wrong edge. Both are the mistake the operator text
    // beside it already avoids, so the sentence has to carry its own answer.
    const farsi = createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({ requested: "fa" })));
    const notice = portalMessageView(farsi, "language.partialNotice", { language: "فارسی" });

    expect(notice.sentence).toBe(
      EN_PORTAL_MESSAGES["language.partialNotice"].replace("{language}", "فارسی")
    );
    expect(notice.lang).toBe(PORTAL_DEFAULT_LOCALE);
    expect(notice.dir).toBe("ltr");

    // A locale that DOES carry the string reports itself, and the page and the
    // sentence agree — the case that must not be broken by fixing the other one.
    const spanish = createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({ requested: "es" })));
    const spanishNotice = portalMessageView(spanish, "language.partialNotice", { language: "Español" });

    expect(spanishNotice.lang).toBe("es");
    expect(spanishNotice.sentence).toContain("parcialmente");

    // And the same is true of the provenance disclosure, which is the sentence
    // a resident reads under a machine translation.
    const machine = portalTextDisclosureView(
      {
        text: "طرح",
        provenance: "machine",
        textLocale: "fa",
        textLocaleStated: true,
        requestedLocale: "fa",
        model: "test-model",
      },
      farsi
    );

    expect(machine?.sentence).toBe(EN_PORTAL_MESSAGES["provenance.machine.caveat"]);
    expect(machine?.lang).toBe(PORTAL_DEFAULT_LOCALE);
    expect(machine?.dir).toBe("ltr");
  });

  it("makes a wrong interpolation a build error rather than braces on a public page", () => {
    // These `@ts-expect-error` directives ARE the assertion: each one fails the
    // build if the misuse under it ever starts compiling, which is what turns
    // "the placeholders are typed" from a claim in a comment into a fact the
    // gate enforces. `{count}` rendered literally to a resident is the failure
    // being prevented, and it is not the kind of thing a runtime test finds —
    // by the time a test can see it, someone has already shipped it.
    const t = createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({}))).t;

    // A key with no placeholders takes no values, and one with placeholders
    // requires exactly the names the English source declares.
    expect(t("portal.tab.submit")).toBe(EN_PORTAL_MESSAGES["portal.tab.submit"]);
    expect(t("portal.itemCount", { count: 3 })).toContain("3");
    expect(t("provenance.untranslated.knownSource", { language: "Español", sourceLanguage: "English" })).toContain(
      "Español"
    );

    // @ts-expect-error — a required interpolation may not be omitted.
    t("language.current");
    // @ts-expect-error — a misspelled value name may not be accepted.
    t("language.current", { lang: "Español" });
    // @ts-expect-error — one of two placeholders is not enough.
    t("provenance.untranslated.knownSource", { language: "Español" });
    // @ts-expect-error — a key with no placeholders takes no second argument.
    t("portal.tab.submit", { count: 1 });
    // @ts-expect-error — an extra value is a sign the string changed under the call site.
    t("language.current", { language: "Español", extra: "x" });
    // @ts-expect-error — a key the English catalog does not declare does not exist.
    t("portal.doesNotExist");
    // @ts-expect-error — a key widened to `string` cannot be resolved, so it is refused.
    t("portal.tab.submit" as string);
  });
});
