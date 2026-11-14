/**
 * The Census TIGERweb map services that county and place search read. Shared
 * by `place-resolver` and `us-counties` so the two cannot drift onto different
 * services or layer ids. TIGERweb needs no API key.
 *
 * Read from https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer?f=json
 * ("Census Current (2026) WMS", January 1, 2026 vintage) and
 * .../tigerWMS_Census2020/MapServer?f=json ("Census 2020 WMS", January 1, 2020
 * vintage) on 2026-11-01.
 */

const TIGERWEB_ROOT = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";

/** Current legal and statistical boundaries: what exists today. */
export const TIGERWEB_CURRENT_BASE = `${TIGERWEB_ROOT}/tigerWMS_Current/MapServer`;

/** The 2020 Census vintage, read only for its POP100 population field. */
export const TIGERWEB_CENSUS2020_BASE = `${TIGERWEB_ROOT}/tigerWMS_Census2020/MapServer`;

/**
 * The Counties layer on each service. Both are layer 82, read from
 * .../tigerWMS_Current/MapServer/82?f=json (fields GEOID, STATE, COUNTY,
 * BASENAME, NAME, LSADC; maxRecordCount 100000) and
 * .../tigerWMS_Census2020/MapServer/82?f=json (the same fields plus POP100) on
 * 2026-11-01. They are named separately because other layer ids differ between
 * the two services.
 */
export const TIGERWEB_CURRENT_COUNTY_LAYER = 82;
export const TIGERWEB_CENSUS2020_COUNTY_LAYER = 82;
