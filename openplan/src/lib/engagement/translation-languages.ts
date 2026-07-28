/**
 * The client-safe half of engagement translation: languages, labels, and the
 * caveat string. Split from `translation.ts` because the engine there reaches
 * the Anthropic access layer (node:crypto / node:async_hooks via the
 * workspace-integration context), which must never enter a browser bundle —
 * and the public portal only needs these constants.
 */

/**
 * Languages a participant can translate INTO — the demographics language set,
 * minus the non-language sentinels ("other" / "prefer_not_to_say"). Kept as an
 * explicit list (not derived) so adding a translation language is a deliberate,
 * reviewed change with a matching display label below.
 */
export const TRANSLATION_LANGUAGES = [
  "en",
  "es",
  "zh",
  "vi",
  "tl",
  "ko",
  "ar",
  "hy",
  "fa",
  "ru",
  "pa",
] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

export const TRANSLATION_LANGUAGE_LABELS: Record<TranslationLanguage, string> = {
  en: "English",
  es: "Spanish",
  zh: "Chinese",
  vi: "Vietnamese",
  tl: "Tagalog",
  ko: "Korean",
  ar: "Arabic",
  hy: "Armenian",
  fa: "Farsi",
  ru: "Russian",
  pa: "Punjabi",
};

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return typeof value === "string" && (TRANSLATION_LANGUAGES as readonly string[]).includes(value);
}

export const TRANSLATION_CAVEAT =
  "Machine translation, provided for convenience. The original comment is the authoritative record of what was said.";
