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
  // Added 2026-08-05. The first eleven were California-weighted — Armenian,
  // Farsi, Punjabi and Tagalog are Title VI safe-harbour languages in this
  // state and rarely elsewhere — which made the portal's coverage a fact about
  // where OpenPlan was written rather than about who uses it. These ten are the
  // languages a US agency outside California most often owes language access
  // to: Hmong in the Central Valley and the Twin Cities, Khmer in Long Beach
  // and Lowell, Haitian Creole in Florida and New York, Portuguese in southern
  // New England, Somali in Minnesota and Ohio, Amharic around DC and Seattle,
  // French in Louisiana, Maine and West African communities, Urdu in New York
  // and Texas, Bengali in New York City, Polish in Chicago.
  "hmn",
  "km",
  "ht",
  "pt",
  "so",
  "am",
  "fr",
  "ur",
  "bn",
  "pl",
  // Diné Bizaad, the largest Indigenous language in the United States, and the
  // reason `MACHINE_TRANSLATION_UNAVAILABLE` below exists. OpenPlan names tribes
  // as a primary audience; a portal that cannot be published in Navajo at all is
  // a worse answer than one an agency's own speakers write. It carries no
  // machine-translation lane — see that constant for the reasoning.
  "nv",
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
  hmn: "Hmong",
  km: "Khmer",
  ht: "Haitian Creole",
  pt: "Portuguese",
  so: "Somali",
  am: "Amharic",
  fr: "French",
  ur: "Urdu",
  bn: "Bengali",
  pl: "Polish",
  nv: "Navajo",
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
 * lists come to disagree about what the newest language is.
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
  hmn: "Hmoob",
  km: "ខ្មែរ",
  ht: "Kreyòl Ayisyen",
  pt: "Português",
  so: "Soomaali",
  am: "አማርኛ",
  fr: "Français",
  ur: "اردو",
  bn: "বাংলা",
  pl: "Polski",
  nv: "Diné Bizaad",
};

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return typeof value === "string" && (TRANSLATION_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Languages OpenPlan will NOT machine-translate into, and the reason, phrased
 * for whoever is refused.
 *
 * WHY A LANGUAGE WOULD BE CARRIED BUT NOT MACHINE-TRANSLATED. These are two
 * different capabilities and only one of them is a model's to have. An agency
 * publishing its own consultation in a language — operator-authored text, a
 * human's words, reviewed before it goes out — is language access working. A
 * model generating that same text is a guess wearing the agency's name, and in
 * a Title VI context the agency's words are legally binding. Where machine
 * quality is genuinely unreliable, the honest product is the first capability
 * without the second, said out loud.
 *
 * A refusal here is deliberately NOT a quiet absence: every surface that would
 * otherwise offer a machine translation must show this reason instead, so a
 * planner learns why the button is missing rather than assuming the feature is
 * broken. `MACHINE_TRANSLATION_UNAVAILABLE_REASON` names the constant a route
 * returns; `campaign-translations-panel.tsx` renders it in place of the
 * suggest/publish controls.
 *
 * Adding a language here is a product decision, not a tuning knob — it removes
 * a capability a planner may already be using.
 */
export const MACHINE_TRANSLATION_UNAVAILABLE: Partial<Record<TranslationLanguage, string>> = {
  nv:
    "OpenPlan does not machine-translate into Diné Bizaad. Machine translation quality for Navajo is not dependable, and a bad translation on a public consultation is worse than none in the one context where an agency's words are legally binding. Navajo translations here are written by people — the portal renders them exactly as any other language.",
};

/**
 * Why machine translation is refused for this language, or null when it is
 * offered. Callers MUST render the reason rather than treating null-vs-string
 * as a bare boolean; the sentence is the whole point.
 */
export function machineTranslationUnavailableReason(
  language: TranslationLanguage
): string | null {
  return MACHINE_TRANSLATION_UNAVAILABLE[language] ?? null;
}

/** True when a model may be asked to produce text in this language. */
export function supportsMachineTranslation(language: TranslationLanguage): boolean {
  return machineTranslationUnavailableReason(language) === null;
}

export const TRANSLATION_CAVEAT =
  "Machine translation, provided for convenience. The original comment is the authoritative record of what was said.";
