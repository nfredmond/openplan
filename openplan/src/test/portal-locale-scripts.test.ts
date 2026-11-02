/**
 * A READER WHO ASKS FOR ONE SCRIPT IS NEVER SERVED ANOTHER.
 *
 * OpenPlan carries one Chinese slot, written in Simplified characters, and one
 * Punjabi slot, written in Gurmukhi. A reader of Traditional characters or of
 * Shahmukhi who is handed those pages is not reading a regional variant; they
 * are reading a script they may not read at all, under the agency's name. So a
 * tag naming another script, or a region that implies one, falls through to the
 * next language the reader accepts, or to English, which the page labels.
 *
 * Blind spot: the slot's script is a table, and the last test checks the table
 * against the letters the catalogs actually use. It cannot tell Simplified from
 * Traditional characters; both are Unicode Han.
 */
import { describe, expect, it } from "vitest";
import {
  PORTAL_LOCALES,
  normalizePortalLocaleTag,
  parseAcceptLanguage,
  portalLocaleBcp47,
  resolvePortalLocale,
} from "@/lib/engagement/portal-i18n/locales";
import { PORTAL_MESSAGE_CATALOGS } from "@/lib/engagement/portal-i18n/messages";
import { TRANSLATION_LANGUAGE_SCRIPTS } from "@/lib/engagement/translation-languages";

describe("script subtags", () => {
  it("does not serve Simplified characters to a reader of Traditional characters", () => {
    for (const tag of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO", "ZH-HANT-TW", "zh_Hant_HK", "cmn-Hant-TW", "zh-Hant-CN"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBeNull();
    }
    // Cantonese is written in Traditional characters unless the tag says otherwise.
    for (const tag of ["yue", "yue-HK", "zh-yue-HK", "yue-Hant"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBeNull();
    }
  });

  it("serves Simplified characters to a reader who asked for them", () => {
    for (const tag of ["zh", "zh-Hans", "zh-CN", "zh-SG", "zh-Hans-TW", "zh-Hans-HK", "cmn-Hans-CN", "yue-Hans", "yue-CN"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBe("zh");
    }
  });

  it("does not serve Gurmukhi to a reader of Shahmukhi", () => {
    for (const tag of ["pa-Arab", "pa-PK", "pa-Arab-PK", "pa_Arab", "pan-PK", "pnb", "pnb-PK", "pnb-Arab"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBeNull();
    }
    for (const tag of ["pa", "pa-IN", "pa-Guru", "pa-Guru-IN", "pa-Guru-PK", "pan", "pnb-Guru"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBe("pa");
    }
  });

  it("holds every carried language to its slot's script, not only Chinese and Punjabi", () => {
    // Hmong is catalogued in Latin letters; Pahawh and Nyiakeng Puachue readers
    // are not served Latin as though it were theirs.
    for (const tag of ["hmn-Hmng", "hmn-Hmnp", "mww-Hmnp", "hnj-Hmng"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBeNull();
    }
    for (const tag of ["hmn", "hmn-Latn", "mww", "hnj-US"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBe("hmn");
    }
    // Osmanya Somali, Baybayin Tagalog and Latin-letter Russian likewise.
    expect(normalizePortalLocaleTag("so-Osma")).toBeNull();
    expect(normalizePortalLocaleTag("tl-Tglg")).toBeNull();
    expect(normalizePortalLocaleTag("ru-Latn")).toBeNull();
    // Korean text is Hangul, which a `Hang` or `Kore` reader reads.
    expect(normalizePortalLocaleTag("ko-Hang")).toBe("ko");
    expect(normalizePortalLocaleTag("ko-Kore-KR")).toBe("ko");
    // A script that matches is not a reason to refuse.
    expect(normalizePortalLocaleTag("es-Latn-MX")).toBe("es");
    expect(normalizePortalLocaleTag("ar-Arab-EG")).toBe("ar");
  });

  it("still carries no catalog for languages that are written in two scripts and not carried at all", () => {
    for (const tag of ["sr-Latn", "sr-Cyrl", "uz-Arab", "uz-Latn", "az-Arab", "az-Latn", "mn-Mong", "mn-Cyrl", "ku-Arab", "ckb", "kmr-Latn"]) {
      expect(normalizePortalLocaleTag(tag), tag).toBeNull();
    }
  });

  it("does not let a region choose a catalog", () => {
    // One Spanish, one Chinese: a region only ever tells us the script.
    expect(normalizePortalLocaleTag("es-MX")).toBe("es");
    expect(normalizePortalLocaleTag("es_419")).toBe("es");
    expect(normalizePortalLocaleTag("pt-PT")).toBe("pt");
    expect(normalizePortalLocaleTag("fr-CA")).toBe("fr");
    expect(normalizePortalLocaleTag("ur-IN")).toBe("ur");
  });
});

describe("Accept-Language with scripts", () => {
  it("does not fall back to Simplified when a Traditional browser adds the bare base language", () => {
    // What Chrome on a Taiwanese or Hong Kong handset sends.
    expect(parseAcceptLanguage("zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("en");
    expect(parseAcceptLanguage("zh-HK,zh;q=0.9")).toBeNull();
    expect(parseAcceptLanguage("zh-Hant,zh;q=0.9,ko;q=0.5")).toBe("ko");
    // Order is by weight, so a heavier refusal still governs a lighter bare tag.
    expect(parseAcceptLanguage("zh;q=0.5,zh-TW")).toBeNull();
    expect(parseAcceptLanguage("pa-PK,pa;q=0.9,ur;q=0.8")).toBe("ur");
  });

  it("honours a reader who lists Simplified characters after Traditional ones", () => {
    expect(parseAcceptLanguage("zh-TW,zh-CN;q=0.9")).toBe("zh");
    expect(parseAcceptLanguage("pa-PK,pa-IN;q=0.5")).toBe("pa");
    expect(parseAcceptLanguage("zh-Hant,zh-Hans;q=0.5,en;q=0.4")).toBe("zh");
    // And a bare zh with nothing before it is Simplified, as CLDR says.
    expect(parseAcceptLanguage("zh,en;q=0.5")).toBe("zh");
  });

  it("keeps weight order across languages", () => {
    expect(parseAcceptLanguage("en;q=0.2,zh-TW;q=0.9,vi;q=0.5")).toBe("vi");
    expect(parseAcceptLanguage("pa-Arab;q=0.9,pa-Guru;q=0.8")).toBe("pa");
  });
});

describe("the resolved locale", () => {
  it("says it is not available when a link names Traditional characters, and does not use the device's bare zh", () => {
    const resolved = resolvePortalLocale({ requested: "zh-Hant", acceptLanguage: "zh,en;q=0.5" });
    expect(resolved.locale).toBe("en");
    expect(resolved.source).toBe("accept_language");
    expect(resolved.unsupportedRequest).toBe("zh-Hant");
  });

  it("uses the device's Simplified request when the link's script is refused", () => {
    const resolved = resolvePortalLocale({ requested: "zh-TW", acceptLanguage: "zh-CN" });
    expect(resolved.locale).toBe("zh");
    expect(resolved.unsupportedRequest).toBe("zh-TW");
  });

  it("names Chinese by its script, to people and to browsers", () => {
    const chinese = resolvePortalLocale({ requested: "zh" });
    expect(chinese.nativeName).toBe("简体中文");
    expect(chinese.bcp47).toBe("zh-Hans");
    expect(portalLocaleBcp47("zh")).toBe("zh-Hans");
    // Every other code already implies the script its slot is written in.
    for (const locale of PORTAL_LOCALES.filter((code) => code !== "zh")) {
      expect(portalLocaleBcp47(locale), locale).toBe(locale);
    }
  });
});

describe("the script table", () => {
  // ISO 15924 slot script -> the Unicode Script property its letters carry.
  const UNICODE_SCRIPT: Record<string, string> = {
    Latn: "Latin",
    Hans: "Han",
    Kore: "Hangul",
    Arab: "Arabic",
    Armn: "Armenian",
    Cyrl: "Cyrillic",
    Guru: "Gurmukhi",
    Khmr: "Khmer",
    Ethi: "Ethiopic",
    Beng: "Bengali",
  };

  it.each(Object.keys(PORTAL_MESSAGE_CATALOGS))("matches the letters the %s catalog is written in", (locale) => {
    const catalog = PORTAL_MESSAGE_CATALOGS[locale as keyof typeof PORTAL_MESSAGE_CATALOGS] ?? {};
    // Placeholders and the product name are Latin in every catalog; drop them.
    const text = Object.values(catalog)
      .join(" ")
      .replace(/\{[a-zA-Z0-9_]+\}/g, "")
      .replace(/OpenPlan|ZIP|PDF|GeoJSON|CSV|KML/g, "");
    const counts = new Map<string, number>();
    for (const script of new Set(Object.values(UNICODE_SCRIPT))) {
      counts.set(script, text.match(new RegExp(`\\p{Script=${script}}`, "gu"))?.length ?? 0);
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(dominant).toBe(UNICODE_SCRIPT[TRANSLATION_LANGUAGE_SCRIPTS[locale as keyof typeof TRANSLATION_LANGUAGE_SCRIPTS]]);
  });
});
