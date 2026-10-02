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

/** Only same-origin app paths, so `next` cannot be turned into an open redirect. */
export function safeNextPath(raw: string | null): string {
  if (!raw) return FALLBACK_PATH;
  // Reject protocol-relative ("//evil.com"), backslash variants browsers treat
  // the same way, and absolute URLs outright.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return FALLBACK_PATH;
  return raw;
}

export function resolveCallbackDestination(rawNext: string | null, origin: string): URL {
  const destination = new URL(safeNextPath(rawNext), origin);
  // Belt and braces: a parse that escaped the origin falls back to the default.
  if (destination.origin !== new URL(origin).origin) return new URL(FALLBACK_PATH, origin);
  return destination;
}
