/**
 * Map a Census county GEOID to a source-specific county code.
 *
 * CCRS reports `County Code` using California's ALPHABETICAL county numbering
 * (1 = Alameda … 58 = Yuba), not the Census FIPS code. Both sequences are
 * assigned alphabetically, and California's county FIPS codes are the odd
 * numbers 001, 003, … 115, so the two are related exactly:
 *
 *     ccrsCountyCode = (countyFips + 1) / 2
 *
 * Verified against live CCRS data across the full range — Alameda (FIPS 001 → 1),
 * Los Angeles (037 → 19), Nevada (057 → 29), San Diego (073 → 37), and Yuba
 * (115 → 58) each return their real city lists. A hardcoded 58-row table would
 * add nothing but a maintenance burden.
 *
 * Why this matters: the county code is the LOSSLESS way to count a county's
 * reported crashes. An ungeocoded crash has no coordinates and can therefore
 * never satisfy a bounding-box predicate, so without it the app silently
 * under-reports by roughly the ungeocoded share.
 */

export const CALIFORNIA_STATE_FIPS = "06";

/** A Census county GEOID is 5 digits: 2-digit state FIPS + 3-digit county FIPS. */
const COUNTY_GEOID = /^(\d{2})(\d{3})$/;

export type CountyGeoidParts = { stateFips: string; countyFips: number };

export function parseCountyGeoid(geoid: string): CountyGeoidParts | null {
  const match = COUNTY_GEOID.exec(geoid.trim());
  if (!match) return null;
  const countyFips = Number.parseInt(match[2], 10);
  if (!Number.isFinite(countyFips) || countyFips <= 0) return null;
  return { stateFips: match[1], countyFips };
}

/**
 * The CCRS county code for a California county GEOID, or null when the geoid is
 * malformed, not a county, or outside California.
 *
 * Returning null is not a failure — it means "no lossless county filter is
 * available for this selection", and the caller falls back to a bbox-only query
 * whose reported and mappable totals are equal by construction.
 */
export function ccrsCountyCodeFromGeoid(geoid: string | null | undefined): number | null {
  if (!geoid) return null;
  const parts = parseCountyGeoid(geoid);
  if (!parts || parts.stateFips !== CALIFORNIA_STATE_FIPS) return null;
  // California county FIPS codes are odd (001, 003, … 115); anything even is not
  // a real CA county and must not be silently halved into a plausible-looking code.
  if (parts.countyFips % 2 === 0 || parts.countyFips > 115) return null;
  return (parts.countyFips + 1) / 2;
}
