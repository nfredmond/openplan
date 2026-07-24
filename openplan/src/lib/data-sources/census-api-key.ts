/**
 * The Census API key, and the one way to attach it to a request URL.
 *
 * WHY THIS IS ITS OWN MODULE
 *   api.census.gov does not reject an unauthenticated request with an error. It
 *   answers `302 Found` and redirects to `missing_key.html` — an HTML page. A
 *   JSON fetch then fails to parse, the caller's `.catch(() => [])` swallows it,
 *   and the feature returns an empty list. The user sees "no results", which is
 *   indistinguishable from "your search matched nothing".
 *
 *   That is exactly how US county search silently broke: `us-counties.ts` built
 *   its catalog URL by hand and omitted the key, so county lookup returned
 *   nothing on EVERY deployment — including ones that had a key configured —
 *   while the keyless TIGERweb city/CDP layers kept working. The bug was
 *   invisible because the failure mode is emptiness, not an error.
 *
 *   Centralizing it means a new Census call site cannot repeat the omission by
 *   forgetting a query parameter, and `src/test/census-api-key.test.ts` fails
 *   the build if one hand-rolls the URL anyway.
 */

/** The configured key, or null. Read at call time so tests can stub the env. */
export function censusApiKey(): string | null {
  return process.env.CENSUS_API_KEY?.trim() || null;
}

/**
 * Append the Census API key to a request URL, if one is configured.
 *
 * Deliberately a no-op when unset rather than a throw: some Census endpoints
 * tolerate low-volume unauthenticated use, and a hard failure here would take
 * down surfaces that currently degrade. The absence is reported to operators by
 * the deployment-health check instead (src/lib/config/deployment-health.ts).
 */
export function withCensusApiKey(url: string): string {
  const key = censusApiKey();
  if (!key) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${encodeURIComponent(key)}`;
}
