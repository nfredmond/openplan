/**
 * Where the auth callback sends a person after their emailed link is redeemed.
 *
 * `next` arrives as a path that may carry its own query string, for example
 * `/dashboard?intent=modeling`. Assigning that whole string to `URL.pathname`
 * percent-encodes the `?`, which produced `/dashboard%3Fintent=modeling` and a
 * 404 for anyone who confirmed their email from a "Where to start" door. Parse
 * it as a relative URL instead so path, query and hash each land in their own
 * part.
 */

const FALLBACK_PATH = "/dashboard";
const PROBE_ORIGIN = "https://openplan.invalid";

/**
 * Only same-origin app paths, so `next` cannot be turned into an open redirect.
 *
 * The sign-in and sign-up pages hand this result straight to `router.push`,
 * which resolves it as a URL. The URL parser drops tab, CR and LF and reads
 * "\" as "/", so "/\t/evil.example" passes a prefix check and still resolves
 * to https://evil.example/. Refuse those characters and confirm the parsed
 * origin does not change.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw) return FALLBACK_PATH;
  // Reject protocol-relative ("//evil.com"), backslash variants browsers treat
  // the same way, and absolute URLs outright.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return FALLBACK_PATH;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return FALLBACK_PATH;
  try {
    if (new URL(raw, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return FALLBACK_PATH;
  } catch {
    return FALLBACK_PATH;
  }
  return raw;
}

export function resolveCallbackDestination(rawNext: string | null, origin: string): URL {
  const fallback = new URL(FALLBACK_PATH, origin);
  try {
    const destination = new URL(safeNextPath(rawNext), origin);
    return destination.origin === fallback.origin ? destination : fallback;
  } catch {
    // A malformed caller-supplied path must not break a completed code exchange.
    return fallback;
  }
}

/**
 * Where /auth/confirm sends a person. The email template passes
 * `{{ .RedirectTo }}`, the full URL the page asked for, which is usually the
 * old callback (https://host/auth/callback?next=/reset-password). Keep only a
 * same-origin app path, unwrapping the callback's own `next`.
 */
export function confirmDestination(rawNext: string | null, origin: string): URL {
  if (!rawNext) return resolveCallbackDestination(null, origin);
  let parsed: URL;
  try {
    parsed = new URL(rawNext, origin);
  } catch {
    return resolveCallbackDestination(null, origin);
  }
  if (parsed.origin !== origin) return resolveCallbackDestination(null, origin);
  if (parsed.pathname === "/auth/callback" || parsed.pathname === "/auth/confirm") {
    return resolveCallbackDestination(parsed.searchParams.get("next"), origin);
  }
  return resolveCallbackDestination(`${parsed.pathname}${parsed.search}${parsed.hash}`, origin);
}
