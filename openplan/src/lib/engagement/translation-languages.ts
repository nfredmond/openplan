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

/**
 * The same languages, each written in ITS OWN script.
 *
 * `TRANSLATION_LANGUAGE_LABELS` above names a language to an English reader —
 * which is exactly the wrong audience for a language chooser. A resident who
 * reads only Farsi cannot find "Farsi" on a page, because "Farsi" is an English
 * word; they can find «فارسی». So the participant-facing picker renders THIS
 * map, and the operator-facing translation UI keeps rendering the English one.
 *
 * It lives here rather than in the portal because it is a second label for the
 * one language taxonomy, and a parallel label map in another file is how two
 * lists come to disagree about what the tenth language is.
 */
export const TRANSLATION_LANGUAGE_NATIVE_LABELS: Record<TranslationLanguage, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
  vi: "Tiếng Việt",
  tl: "Tagalog",
  ko: "한국어",
  ar: "العربية",
  hy: "Հայերեն",
  fa: "فارسی",
  ru: "Русский",
  pa: "ਪੰਜਾਬੀ",
};

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return typeof value === "string" && (TRANSLATION_LANGUAGES as readonly string[]).includes(value);
}

export const TRANSLATION_CAVEAT =
  "Machine translation, provided for convenience. The original comment is the authoritative record of what was said.";
