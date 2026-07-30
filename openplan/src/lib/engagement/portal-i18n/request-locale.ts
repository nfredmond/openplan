/**
 * The one place the request's `Accept-Language` header is read.
 *
 * WHY IT IS READ HERE AND NOT AT EACH PAGE. Two participant surfaces render the
 * portal — the full public page and the embeddable widget — and only one of
 * them is being changed in this pass. A header read that each page had to
 * remember to perform is a header read one page forgets, and the symptom would
 * be an embed that ignores a resident's device language while the page beside
 * it honours it. `loadPublicPortalBundle` calls this, so both get it.
 *
 * WHY THE IMPORT IS DYNAMIC. `next/headers` only works inside a request scope.
 * Component tests render these pages directly, with no Next runtime at all, and
 * a module-level import would make the import itself the failure. Deferred and
 * caught, a missing request scope degrades to "the browser said nothing", which
 * is exactly what it means outside a request.
 */
export async function readAcceptLanguageHeader(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const store = await headers();
    return store.get("accept-language");
  } catch {
    return null;
  }
}
