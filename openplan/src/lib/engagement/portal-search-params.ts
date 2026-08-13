/**
 * The two things every portal surface needs out of a URL's query string.
 *
 * Both were written out three times — the map route, the context route, and now
 * the operator preview — and the copies had already begun to matter: the
 * language a resident asked for and the query string a link must preserve are
 * the same decision on every one of those surfaces, and a surface that forgot
 * either would silently answer in English or drop the rest of the URL.
 */

export type PortalSearchParams = Record<string, string | string[] | undefined>;

/**
 * The explicit language choice, out of the URL.
 *
 * A repeated `?lang=` (which a hand-edited or double-appended URL produces)
 * yields an array; the first entry wins rather than the request being refused.
 * A public link that somebody mangled must still open the consultation.
 */
export function portalRequestedLocale(
  searchParams: PortalSearchParams | undefined,
  key: string
): string | null {
  const raw = searchParams?.[key];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

/**
 * The query string as the participant sees it, so a page's own links preserve
 * everything else that was on the URL.
 */
export function portalSearchString(searchParams: PortalSearchParams | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  return params.toString();
}
