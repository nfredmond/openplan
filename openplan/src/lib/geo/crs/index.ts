/**
 * The coordinate-reference-system lane's front door.
 *
 * Everything another lane needs is here, under the names the design memo froze,
 * so that no caller has to know which file a piece of this lives in. Two rules
 * govern what a caller may do with it:
 *
 *   1. DECIDING a coordinate system happens on the server. `resolveCrs`,
 *      `listCrsForRegion` and the registry behind them reach ~1.4 MB of
 *      generated data and, more importantly, answer a question with a claim
 *      attached: what a file IS. A browser tab must not be able to answer that
 *      about its own upload.
 *   2. APPLYING one happens wherever the file is. `reprojectFeature`,
 *      `checkAreaOfUse` and `spatialFileCrsFor` take an ENTRY, never a code, so
 *      the browser can transform a 200 MB shapefile without the registry
 *      following it into the bundle.
 *
 * No caller in another lane parses a file or writes a coordinate-system refusal
 * message. They render this lane's.
 */

export type {
  CrsAreaOfUse,
  CrsMethod,
  CrsProjectionParams,
  CrsRefusal,
  CrsRefusalReason,
  CrsRegistryEntry,
} from "./types";
export { CRS_METHODS, CRS_REFUSAL_REASONS } from "./types";

export type {
  Bbox,
  CrsPlacementCheck,
  CrsPlacementInput,
  CrsPlacementWarning,
  CrsPlacementWarningCode,
} from "./area-of-use";
export {
  AREA_OF_USE_MARGIN_DEGREES,
  HOME_GEOGRAPHY_WARNING_DEGREES,
  NULL_ISLAND_DEGREES,
  checkCrsPlacement as checkAreaOfUse,
} from "./area-of-use";

export { reprojectBbox, reprojectGeometry as reprojectFeature, reprojectPosition } from "./reproject";

export type { DescribableSrs } from "./describe";
export { describeSpatialFileSrs } from "./describe";

export { readWktCrs } from "./wkt";

export type { CrsRegionQuery, PrjIdentification } from "./registry";
export {
  CRS_REGISTRY_SOURCE,
  allCrsEntries,
  crsRegistrySize,
  crsSiblings,
  findCrsByCode,
  findCrsByName,
  identifyCrsFromPrj as resolveCrs,
  listCrsForRegion,
} from "./registry";

import { reprojectPosition } from "./reproject";
import type { CrsRegistryEntry } from "./types";
import type { SpatialFileCrs } from "../spatial-file-import";

/**
 * Bind a registry entry to the shape the shared file importer consumes.
 *
 * This is the whole seam between "which coordinate system is this?" — decided
 * on the server, with the registry — and "turn these numbers into longitude and
 * latitude", which happens wherever the file is. The importer receives a name,
 * a unit, and one function; it cannot look anything up, cannot change its mind,
 * and cannot silently fall back to WGS 84.
 */
export function spatialFileCrsFor(entry: CrsRegistryEntry): SpatialFileCrs {
  return {
    authority: entry.authority,
    code: entry.code,
    name: entry.name,
    unit: entry.unit,
    kind: entry.kind,
    datumNote: entry.datumShiftNote,
    toLngLat: (x, y) => reprojectPosition(entry, x, y),
  };
}
