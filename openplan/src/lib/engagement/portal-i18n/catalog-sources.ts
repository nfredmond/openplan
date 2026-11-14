/**
 * WHICH ENGLISH A TRANSLATION WAS MADE FROM.
 *
 * Catalogs match English by key. Without more than that, a translation keeps
 * its old meaning silently when the English beside it is rewritten, and a
 * resident reads a sentence the agency no longer says. So every catalog entry
 * records a short fingerprint of the English it was translated from
 * (`catalogs/translated-from.ts`), and `messages.ts` shows an entry only while
 * that fingerprint matches the current English. A mismatch shows the English
 * and lists the key as a fallback, which the page already discloses.
 *
 * Client-safe: pure functions and type-only imports.
 */

import type { PortalLocale } from "./locales";
import type { PortalMessageCatalog, PortalMessageKey } from "./messages";

/** Per key, the fingerprint of the English a translation was made from. */
export type PortalCatalogSources = Partial<Record<PortalMessageKey, string>>;

const UTF8 = new TextEncoder();

/**
 * FNV-1a (32-bit) over the English string's UTF-8 bytes, as 8 hex digits.
 *
 * Detects change, not tampering: a rewritten string keeps its fingerprint by
 * accident about once in four billion rewrites. Any change to the bytes counts,
 * including punctuation and spacing, because the guard cannot tell which
 * changes alter meaning and a translator can.
 */
export function portalSourceFingerprint(english: string): string {
  let hash = 0x811c9dc5;
  for (const byte of UTF8.encode(english)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Every way the recorded sources disagree with the catalogs and the current
 * English, as sentences that say what to do. Empty means every translation on
 * record was made from the English it sits beside, or is listed as stale.
 *
 * The guard test runs this over the real catalogs. It is a function so the
 * test can also run it over a small made-up catalog and prove it fails.
 */
export function portalCatalogSourceProblems(input: {
  english: Readonly<Record<PortalMessageKey, string>>;
  catalogs: Readonly<Partial<Record<PortalLocale, PortalMessageCatalog>>>;
  sources: Readonly<Partial<Record<PortalLocale, PortalCatalogSources>>>;
  knownStale: Readonly<Partial<Record<PortalLocale, readonly PortalMessageKey[]>>>;
}): string[] {
  const problems: string[] = [];

  for (const [locale, catalog] of Object.entries(input.catalogs) as Array<[PortalLocale, PortalMessageCatalog]>) {
    const sources = input.sources[locale] ?? {};
    const stale = new Set(input.knownStale[locale] ?? []);

    for (const [key, translated] of Object.entries(catalog) as Array<[PortalMessageKey, string | undefined]>) {
      if (typeof translated !== "string" || translated.trim().length === 0) continue;
      const english = input.english[key];
      if (typeof english !== "string") continue;
      const current = portalSourceFingerprint(english);
      const recorded = sources[key];

      if (recorded === undefined) {
        problems.push(
          `${locale} ${key}: no record of which English this was translated from. ` +
            `If it was translated from the current English, record "${current}" in catalogs/translated-from.ts.`
        );
      } else if (recorded !== current && !stale.has(key)) {
        problems.push(
          `${locale} ${key}: the English changed after this was translated, so the page now shows English. ` +
            `Translate the current English and record "${current}", or list the key in PORTAL_CATALOG_KNOWN_STALE.`
        );
      } else if (recorded === current && stale.has(key)) {
        problems.push(`${locale} ${key}: listed as stale but matches the current English. Remove it from the stale list.`);
      }
    }

    for (const key of stale) {
      const translated = catalog[key];
      if (typeof translated !== "string" || translated.trim().length === 0) {
        problems.push(`${locale} ${key}: listed as stale but has no translation. Remove it from the stale list.`);
      }
    }
  }

  return problems;
}
