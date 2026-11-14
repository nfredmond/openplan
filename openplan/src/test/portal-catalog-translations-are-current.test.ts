/**
 * A TRANSLATION IS SHOWN ONLY WHILE IT TRANSLATES THE ENGLISH BESIDE IT.
 *
 * Catalogs match English by key. Before fingerprints, rewriting an English
 * sentence left every translation of the old sentence in place, and residents
 * read a meaning the agency no longer published. Now each entry records which
 * English it was made from (`catalogs/translated-from.ts`). This file holds the
 * build to that record, and checks the page falls back to English when the
 * record and the English disagree.
 *
 * Blind spot: a fingerprint says which English a translation was MADE from,
 * not whether the translation is any good. Quality is for fluent readers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  portalCatalogSourceProblems,
  portalSourceFingerprint,
} from "@/lib/engagement/portal-i18n/catalog-sources";
import {
  PORTAL_CATALOG_KNOWN_STALE,
  PORTAL_CATALOG_TRANSLATED_FROM,
} from "@/lib/engagement/portal-i18n/catalogs/translated-from";
import {
  EN_PORTAL_MESSAGES,
  PORTAL_MESSAGE_CATALOGS,
  buildPortalMessageBundle,
  portalMessageCoverage,
  type PortalMessageKey,
} from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";

describe("the catalog guard", () => {
  it("finds every catalog entry translated from the current English, or listed as stale", () => {
    // The failure message names the locale, the key and the fingerprint to
    // record, so whoever changed the English knows exactly what is owed.
    expect(
      portalCatalogSourceProblems({
        english: EN_PORTAL_MESSAGES,
        catalogs: PORTAL_MESSAGE_CATALOGS,
        sources: PORTAL_CATALOG_TRANSLATED_FROM,
        knownStale: PORTAL_CATALOG_KNOWN_STALE,
      })
    ).toEqual([]);
  });

  it("fingerprints with FNV-1a over UTF-8, so a fingerprint can be checked by hand", () => {
    // Published FNV-1a 32-bit test vectors.
    expect(portalSourceFingerprint("")).toBe("811c9dc5");
    expect(portalSourceFingerprint("a")).toBe("e40c292c");
    expect(portalSourceFingerprint("foobar")).toBe("bf9cf968");
    // UTF-8 bytes (C3 A9), not the UTF-16 unit (E9, which gives 6c0b6c44).
    expect(portalSourceFingerprint("é")).toBe("1e9de8c1");
    expect(portalSourceFingerprint("Open for comments")).not.toBe(portalSourceFingerprint("Open for comments."));
  });

  // A two-key world small enough to read, standing in for the real catalogs.
  const english = { "page.submissionsOpen": "Open for comments", "portal.submit": "Send" } as Record<
    PortalMessageKey,
    string
  >;
  const catalogs = { es: { "page.submissionsOpen": "Abierto a comentarios", "portal.submit": "Enviar" } };
  const madeFrom = (map: Record<string, string>) =>
    Object.fromEntries(Object.entries(map).map(([key, value]) => [key, portalSourceFingerprint(value)]));

  it("fails when the English changes and nobody refreshes the translation or marks it stale", () => {
    const sources = { es: madeFrom({ "page.submissionsOpen": "Submissions open", "portal.submit": "Send" }) };
    const problems = portalCatalogSourceProblems({ english, catalogs, sources, knownStale: {} });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("es page.submissionsOpen: the English changed");
    expect(problems[0]).toContain(portalSourceFingerprint("Open for comments"));
  });

  it("accepts a changed English once the translation is listed as stale, and only then", () => {
    const sources = { es: madeFrom({ "page.submissionsOpen": "Submissions open", "portal.submit": "Send" }) };
    expect(
      portalCatalogSourceProblems({ english, catalogs, sources, knownStale: { es: ["page.submissionsOpen"] } })
    ).toEqual([]);

    // A stale list that outlives the refresh would hide the next real change.
    const refreshed = { es: madeFrom(english) };
    expect(
      portalCatalogSourceProblems({ english, catalogs, sources: refreshed, knownStale: { es: ["page.submissionsOpen"] } })
    ).toEqual(["es page.submissionsOpen: listed as stale but matches the current English. Remove it from the stale list."]);
  });

  it("fails on a translation with no record of its English", () => {
    const problems = portalCatalogSourceProblems({
      english,
      catalogs,
      sources: { es: madeFrom({ "portal.submit": "Send" }) },
      knownStale: {},
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("es page.submissionsOpen: no record");
  });
});

describe("what a resident sees", () => {
  it("shows English for a Spanish entry translated from English that has since changed", () => {
    // "Comentarios abiertos" was written on 2026-07-30 for "Submissions open".
    // The English became "Open for comments" on 2026-10-10. Whether the Spanish
    // still fits is a fluent reader's call, so until one makes it the page shows
    // English and counts the key as untranslated.
    const bundle = buildPortalMessageBundle(resolvePortalLocale({ requested: "es" }));

    for (const key of PORTAL_CATALOG_KNOWN_STALE.es ?? []) {
      expect(PORTAL_MESSAGE_CATALOGS.es?.[key]).toBeTruthy();
      expect(bundle.messages[key], key).toBe(EN_PORTAL_MESSAGES[key]);
      expect(bundle.fallbackKeys, key).toContain(key);
    }
    expect(PORTAL_CATALOG_KNOWN_STALE.es).toEqual(["page.submissionsOpen", "page.submissionsClosed"]);
    expect(portalMessageCoverage("es").missing).toEqual(PORTAL_CATALOG_KNOWN_STALE.es);

    // A current Spanish entry is still shown.
    expect(bundle.messages["page.submissionStatusDetail"]).toBe(
      PORTAL_MESSAGE_CATALOGS.es?.["page.submissionStatusDetail"]
    );
  });
});

describe("when the record and the English disagree at runtime", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/engagement/portal-i18n/catalogs/translated-from");
    vi.resetModules();
  });

  it("shows English for that key, even in a catalog the guard has not been run on", async () => {
    // Simulates an English rewrite the guard has not caught yet: the record for
    // one Chinese key no longer matches. The page must not show the old text.
    vi.resetModules();
    vi.doMock("@/lib/engagement/portal-i18n/catalogs/translated-from", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/engagement/portal-i18n/catalogs/translated-from")>();
      return {
        ...actual,
        PORTAL_CATALOG_TRANSLATED_FROM: {
          ...actual.PORTAL_CATALOG_TRANSLATED_FROM,
          zh: { ...actual.PORTAL_CATALOG_TRANSLATED_FROM.zh, "portal.tab.submit": portalSourceFingerprint("Share your input") },
        },
      };
    });
    const messages = await import("@/lib/engagement/portal-i18n/messages");
    const locales = await import("@/lib/engagement/portal-i18n/locales");

    const bundle = messages.buildPortalMessageBundle(locales.resolvePortalLocale({ requested: "zh" }));
    expect(bundle.messages["portal.tab.submit"]).toBe(messages.EN_PORTAL_MESSAGES["portal.tab.submit"]);
    expect(bundle.fallbackKeys).toEqual(["portal.tab.submit"]);
    // Every other key is still Chinese.
    expect(bundle.messages["portal.tab.feedback"]).toBe(messages.PORTAL_MESSAGE_CATALOGS.zh?.["portal.tab.feedback"]);
  });
});
