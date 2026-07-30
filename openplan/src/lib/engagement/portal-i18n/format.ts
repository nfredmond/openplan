/**
 * DATES AND NUMBERS IN THE PARTICIPANT'S LOCALE.
 *
 * A Spanish page carrying "3/7/2026, 6:00:00 PM" is half-translated, and worse
 * than that, ambiguous: in most of the world that string names a different day
 * than the one intended. The engage page used a bare `toLocaleString()`, which
 * in a server render means the SERVER's locale — en-US on every deployment this
 * product will ever run on — regardless of who is reading.
 *
 * These helpers exist so no surface has to remember to pass a locale: a call
 * that forgets it does not compile, because the locale is the second required
 * argument.
 *
 * WHAT `Intl` WILL AND WILL NOT DO. For a well-formed tag it has no data for,
 * `Intl` falls back to the runtime's default locale rather than throwing. That
 * is a real limit and it is not hidden anywhere: a Tagalog page may render an
 * en-US date if the deployment's ICU build lacks `fil`. It is still strictly
 * better than never asking, and the failure is a formatting difference rather
 * than a wrong claim.
 */

/**
 * `Intl` throws a `RangeError` on a malformed tag. Every tag this module is
 * given comes from `PORTAL_LOCALES`, so that should be impossible — but a
 * public participant page is the wrong place to discover otherwise, so a bad
 * tag degrades to the runtime default instead of taking the page down.
 */
function safeFormatter<T>(build: (locale: string | undefined) => T, locale: string): T {
  try {
    return build(locale);
  } catch {
    return build(undefined);
  }
}

/**
 * A timestamp as a date and time. Returns the RAW value when it is not a date —
 * the same choice the page made before, and the right one: an unparseable
 * timestamp shown verbatim is debuggable, while "Invalid Date" on a public page
 * is not.
 */
export function formatPortalDateTime(
  value: string | number | Date | null | undefined,
  bcp47: string,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return safeFormatter(
    (locale) =>
      new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium", timeStyle: "short" }).format(parsed),
    bcp47
  );
}

/** A timestamp as a date alone. */
export function formatPortalDate(
  value: string | number | Date | null | undefined,
  bcp47: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return formatPortalDateTime(value, bcp47, options ?? { dateStyle: "medium" });
}

/**
 * A number in the participant's locale — thousands separators and decimal marks
 * included, which differ between the languages in this list and are read wrong
 * when they are wrong.
 */
export function formatPortalNumber(
  value: number | null | undefined,
  bcp47: string,
  options?: Intl.NumberFormatOptions
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return safeFormatter((locale) => new Intl.NumberFormat(locale, options).format(value), bcp47);
}

/**
 * A byte size in the participant's locale.
 *
 * Here because the portal's photo-upload copy states a limit, and "5 MB"
 * hardcoded into a sentence is both an untranslated unit and a number that
 * silently disagrees with `ENGAGEMENT_PHOTO_MAX_BYTES` the day someone changes
 * it.
 */
export function formatPortalMegabytes(bytes: number, bcp47: string): string {
  const megabytes = bytes / (1024 * 1024);
  const rounded = Number.isInteger(megabytes) ? megabytes : Number(megabytes.toFixed(1));
  return `${formatPortalNumber(rounded, bcp47)} MB`;
}
