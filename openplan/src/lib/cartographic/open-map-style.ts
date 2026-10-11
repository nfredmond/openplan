/**
 * A map with no Mapbox key: an operator-chosen MapLibre style.
 *
 * `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL` names a MapLibre style JSON. Two ways to
 * use it, described in docs/SELF_HOSTING.md:
 *
 *   - Fully local: a regional `.pmtiles` extract and a style served by the
 *     deployment itself (a same-origin path such as `/maps/style.json`), so the
 *     map makes no request outside the deployment.
 *   - Keyless public tiles: a free style such as OpenFreeMap's. No key and no
 *     account, but the resident's browser fetches tiles from that host.
 *
 * A Mapbox key, when set, still wins: this is what a deployment without one
 * gets instead of a words-only form.
 */

export const OPEN_MAP_STYLE_ENV = "NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL";

/** The style URL to use, or null when none is configured or it is not a URL a browser can load. */
export function resolveOpenMapStyleUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The origin the style is served from, for the content-security policy. Null
 * for a same-origin path, which `'self'` already covers.
 */
export function openMapStyleOrigin(value: string | null | undefined): string | null {
  const style = resolveOpenMapStyleUrl(value);
  if (!style || style.startsWith("/")) return null;
  return new URL(style).origin;
}
