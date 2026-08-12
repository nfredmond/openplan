/**
 * The one sentence that explains a layer's coordinate system to a planner.
 *
 * ═══ WHY ONE FUNCTION, PRODUCT-WIDE ═══
 *
 * This started as `describeContextLayerSrs` inside the engagement lane, and the
 * reason it moved here is that the sentence is the disclosure. If the
 * engagement panel and the workspace-layer panel each write their own version,
 * they drift, and the day one of them stops saying "no datum transformation was
 * applied" is the day that fact stops being true for a planner without anything
 * changing in the code that does the work.
 *
 * ═══ IT READS AS EVIDENCE, NEVER AS REASSURANCE ═══
 *
 * "Your .prj said WGS 84", "GeoJSON is WGS 84 by specification and this file
 * named nothing else", and "you told us this is California zone 3" are three
 * different amounts of evidence, and a planner has to be able to tell them
 * apart. The third one in particular is a STATEMENT SOMEBODY MADE — it names
 * them, and it never reads as though the file said it.
 */

import type { SpatialFileSrsBasis } from "../spatial-file-import";

export type DescribableSrs = {
  /** Registry that issued the code, e.g. "EPSG". Null when nothing named one. */
  authority: string | null;
  /** Code within that registry, e.g. "4326". */
  code: string | null;
  /** What a planner reads: "WGS 84", "NAD83 / California zone 2 (ftUS)". */
  name: string;
  basis: SpatialFileSrsBasis;
  /**
   * The system the file's coordinates were transformed FROM, when OpenPlan
   * reprojected them. Null when the file was already longitude/latitude.
   */
  reprojectedFrom?: {
    name: string;
    authority: string | null;
    code: string | null;
    /** "US survey foot", "metre" — the unit the file's numbers were in. */
    unit: string;
  } | null;
  /**
   * The permanent datum caveat, when the source datum is far enough from WGS 84
   * to matter. Comes from the registry entry, measured rather than estimated.
   */
  datumNote?: string | null;
  /** Who stated the coordinate system, for `planner_asserted` only. */
  assertedBy?: string | null;
};

function identify(srs: { authority: string | null; code: string | null; name: string }): string {
  const identifier = srs.authority && srs.code ? `${srs.authority}:${srs.code}` : null;
  return identifier ? `${srs.name} (${identifier})` : srs.name;
}

/**
 * Whether a stored SRS is WGS 84 itself, by identifier or by name.
 *
 * Name matching is a fallback, not the primary test: ESRI-written .prj files
 * routinely carry no AUTHORITY at all, and "GCS_WGS_1984" is what they say
 * instead. Anything this cannot confirm is treated as NOT WGS 84, which errs
 * toward disclosing a datum note that was not strictly needed rather than
 * suppressing one that was.
 */
function isWgs84(srs: { authority: string | null; code: string | null; name: string }): boolean {
  if (srs.authority?.toUpperCase() === "EPSG" && srs.code === "4326") return true;
  if (srs.code?.toUpperCase() === "CRS84") return true;
  return /^(gcs_)?wgs[ _]?(19)?84$/i.test(srs.name.trim());
}

/** The default datum sentence, for a geographic file drawn as given. */
const DRAWN_AS_GIVEN =
  " Coordinates are drawn as given; no datum transformation to WGS 84 is applied, which can shift positions by a metre or two.";

export function describeSpatialFileSrs(srs: DescribableSrs): string {
  const named = identify(srs);

  // A reprojection is the biggest thing that happened to this file and it is
  // said first. A planner comparing a layer against aerial imagery needs to
  // know OpenPlan moved every coordinate, and from what.
  const reprojection = srs.reprojectedFrom
    ? `OpenPlan converted this layer from ${identify(srs.reprojectedFrom)}, whose coordinates are in ` +
      `${srs.reprojectedFrom.unit === "metre" ? "metres" : `${srs.reprojectedFrom.unit}s`}, into longitude and ` +
      `latitude. `
    : "";

  const datum = srs.datumNote ? ` ${srs.datumNote}` : "";

  switch (srs.basis) {
    case "prj_file":
      return (
        `${reprojection}Coordinate system read from the shapefile's .prj file: ${named}.` +
        (srs.datumNote ? datum : isWgs84(srs) || srs.reprojectedFrom ? "" : DRAWN_AS_GIVEN)
      );
    case "geojson_crs_member":
      return `${reprojection}Coordinate system read from the file's own crs member: ${named}.${datum}`;
    case "geojson_rfc7946_default":
      return `The file named no coordinate system. GeoJSON is defined as ${named} by RFC 7946, so it was read as that — not guessed.`;
    case "kml_specification":
      return `KML is defined as ${named} by the OGC specification, so it was read as that — not guessed.`;
    case "planner_asserted":
      // NAMED, ALWAYS. This is the one basis where the answer came from a
      // person rather than from the file, and the record has to say so — both
      // because it is the truth and because it is the thing to re-check first
      // when a layer turns out to be in the wrong place.
      return (
        `${reprojection}This file said nothing about its coordinate system. ` +
        `${srs.assertedBy ? `${srs.assertedBy} stated` : "It was stated"} that it is ` +
        `${srs.reprojectedFrom ? identify(srs.reprojectedFrom) : named}; OpenPlan did not read that from the file ` +
        `and cannot confirm it, beyond having checked that the layer lands inside the area that system covers.` +
        datum
      );
  }
}
