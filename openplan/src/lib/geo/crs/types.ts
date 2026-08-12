/**
 * The coordinate reference system registry, as a shape.
 *
 * ═══ WHY THE REGISTRY IS DATA AND ONLY THE METHODS ARE CODE ═══
 *
 * There are thousands of coordinate systems in use, and a planning department
 * in any given county uses one of them for reasons that predate everyone
 * currently employed there. A switch statement over "the projections we
 * support" would be a permanent, silent limit on who can use OpenPlan: adding
 * Ohio North in US survey feet would mean editing a call site, and whoever
 * needed it would instead be told their file is unsupported.
 *
 * So a CRS here is a ROW — identity, datum, unit, an area of use, and the
 * parameters of one projection METHOD. The methods are the only code, there are
 * a small fixed number of them, and each is a published formula rather than a
 * judgement. Adding a coordinate system is regenerating the registry. Adding a
 * METHOD is the rare event that needs a programmer.
 *
 * ═══ NORMALIZED AT GENERATION TIME, DELIBERATELY ═══
 *
 * Every angle in `params` is in DECIMAL DEGREES and every length is in METRES,
 * whatever the source said. This matters more than it sounds: the EPSG dataset
 * records many angles in unit-of-measure 9110, "sexagesimal DMS", where the
 * literal `38.26` means 38°26′00″ — not 38.26 degrees. Read as decimal degrees
 * that parameter puts California zone 3 about thirty kilometres north of where
 * it belongs, and every shape drawn in it looks entirely plausible. Doing the
 * conversion once, in the generator, under test, is the only version of this
 * that stays correct: a runtime that has to remember which unit a number is in
 * will eventually forget.
 *
 * `unitToMetres` is the exception and is NOT folded away, because it applies to
 * the file's coordinates rather than to the projection: a shapefile in
 * California zone 3 (ftUS) carries eastings in survey feet, and those have to
 * be converted before the projection formula sees them.
 */

/**
 * The projection methods OpenPlan implements.
 *
 * `geographic` is not a projection: it means the coordinates are already
 * longitude and latitude in degrees on the entry's datum, so "reprojection" is
 * the identity. It is a member rather than a null so that every registry entry
 * has a method and the exhaustive switch in `projections/index.ts` covers the
 * whole registry — an entry with no method could otherwise reach the
 * transformer and be quietly passed through unprojected.
 */
export const CRS_METHODS = [
  "geographic",
  "lambert_conformal_conic_1sp",
  "lambert_conformal_conic_2sp",
  "transverse_mercator",
  "hotine_oblique_mercator",
  "albers_equal_area",
  "pseudo_mercator",
] as const;

export type CrsMethod = (typeof CRS_METHODS)[number];

/**
 * Projection parameters, normalized: degrees for angles, metres for lengths.
 *
 * One flat record covers every method because the methods overlap heavily and a
 * per-method union would make the generated table's shape method-dependent —
 * which is exactly the kind of thing that goes wrong silently when a new method
 * is added. Each projection reads the fields it needs and `assertParams` proves
 * the ones it needs are present.
 */
export type CrsProjectionParams = {
  /** Semi-major axis of the ellipsoid, metres. */
  a: number;
  /** Inverse flattening. `Infinity` for a sphere (flattening 0). */
  invF: number;
  /** Latitude of natural origin / false origin / projection centre. */
  lat0?: number;
  /**
   * Longitude of origin, ALWAYS MEASURED FROM GREENWICH.
   *
   * For a projected system this is the natural origin / false origin /
   * projection centre. For a `geographic` system it is the system's PRIME
   * MERIDIAN, and it is applied as an offset to the file's longitudes.
   *
   * ═══ WHY "FROM GREENWICH" IS SPELLED OUT ═══
   *
   * EPSG states a projection's longitude of origin RELATIVE TO ITS DATUM'S OWN
   * PRIME MERIDIAN, and thirty-four of the systems in this registry are on a
   * datum whose prime meridian is not Greenwich — Paris, Ferro, Oslo, Lisbon,
   * Madrid, Brussels. EPSG:27571 (NTF Paris / Lambert zone I) declares a
   * longitude of origin of exactly 0, meaning the Paris meridian, 2.337229°
   * east of Greenwich. Stored as published and consumed as Greenwich, it put
   * Paris 171 km west of itself, in the English Channel — and inside the
   * system's own area of use, so `checkCrsPlacement` reported no problem.
   *
   * The prime meridian is therefore FOLDED IN at generation time, exactly as
   * sexagesimal degrees are, and for the same reason: a runtime that has to
   * remember which meridian a number is measured from will eventually forget.
   * Every consumer here may read this as a Greenwich longitude without asking.
   */
  lon0?: number;
  /** First standard parallel (two-parallel methods). */
  lat1?: number;
  /** Second standard parallel (two-parallel methods). */
  lat2?: number;
  /** Scale factor at the natural origin / projection centre. */
  k0?: number;
  /** False easting, metres. */
  x0?: number;
  /** False northing, metres. */
  y0?: number;
  /** Azimuth of the initial line at the projection centre (Hotine). */
  azimuth?: number;
  /** Angle from rectified to skew grid (Hotine). */
  gamma?: number;
  /**
   * Which Hotine Oblique Mercator variant this entry is.
   *
   * The two differ ONLY in where the false easting and northing are applied —
   * variant A at the natural origin, variant B at the projection centre — and
   * for Alaska zone 1 that difference is several hundred kilometres. It is a
   * parameter rather than two methods because the projection formula is
   * otherwise identical.
   */
  hotineVariant?: "A" | "B";
};

/**
 * The geographic bounds within which a coordinate system is defined to work.
 *
 * This is the load-bearing field of the whole registry. A State Plane zone is a
 * projection fitted to one strip of one state; feed it coordinates from
 * somewhere else and it still returns a longitude and latitude, plausibly
 * formatted and completely wrong. The area of use is what lets OpenPlan notice.
 */
export type CrsAreaOfUse = {
  west: number;
  south: number;
  east: number;
  north: number;
  /** What the issuing authority says this system is for, verbatim. */
  description: string;
};

/**
 * One coordinate reference system.
 *
 * The first eight fields are deliberately the shape the workspace-GIS store
 * consumes (`WorkspaceGisCrsEntry`), so an entry is assignable to it without a
 * conversion step: that lane must be able to record what a layer was read as
 * without being able to reproject anything.
 */
export type CrsRegistryEntry = {
  /** "EPSG" or "ESRI" — the registry that issued the code. */
  authority: string;
  /** Code within that authority, e.g. "2226". */
  code: string;
  /** What a planner reads: "NAD83 / California zone 2 (ftUS)". */
  name: string;
  /** The unit the FILE's coordinates are in: "metre", "US survey foot", "degree". */
  unit: string;
  kind: "geographic" | "projected";
  /** The geodetic datum's name, e.g. "North American Datum 1983". */
  datum: string;
  /**
   * True when reading this datum's coordinates as WGS 84 — which is what
   * OpenPlan does, because it ships no datum-shift grids — moves shapes far
   * enough that a planner has to be told. See `datumShiftMetres`.
   */
  requiresDatumAcknowledgement: boolean;
  /** The permanent caveat sentence, or null when the datum needs no note. */
  datumShiftNote: string | null;

  // ── Beyond the store's half ────────────────────────────────────────────────

  /**
   * How far, in metres, treating this datum's coordinates as WGS 84 can move a
   * shape within this system's area of use — measured by the generator against
   * PROJ's own datum transformations, not estimated.
   *
   * `null` means PROJ has no transformation for this datum at all beyond a
   * ballpark one, so the magnitude is UNKNOWN. Unknown is treated as worse than
   * large, never as zero.
   */
  datumShiftMetres: number | null;
  /** How many metres one unit of the file's coordinates is. 1 for degrees. */
  unitToMetres: number;
  method: CrsMethod;
  params: CrsProjectionParams;
  areaOfUse: CrsAreaOfUse;
  /**
   * Other spellings this system is known by — chiefly the ESRI names that ESRI
   * writes into a `.prj` with no AUTHORITY element at all, such as
   * `NAD_1983_StatePlane_California_II_FIPS_0402_Feet`.
   *
   * Matching against these is EXACT after normalization, never fuzzy. A
   * near-miss on a zone name is the failure this whole module exists to
   * prevent.
   */
  aliases: string[];
  /**
   * Identifies the same projection on the same datum expressed in a different
   * unit — "California zone 3 in metres" and "California zone 3 in US survey
   * feet" share a sibling key and differ only in `unit`.
   *
   * Derived from the NORMALIZED parameters, so it is a statement about the
   * geometry rather than about the names, which is what makes
   * "you have chosen feet and this file is in metres" a claim OpenPlan can
   * actually prove.
   */
  siblingKey: string;
};

/** Why a coordinate system could not be established, or could not be trusted. */
export const CRS_REFUSAL_REASONS = [
  /** The file named a system, and the registry does not carry it. */
  "crs_not_in_registry",
  /** The file named nothing and nobody asserted anything. */
  "crs_evidence_missing",
  /** The .prj was present but unreadable as WKT. */
  "crs_unreadable",
  /** Read as the stated system, the data lands outside where that system works. */
  "crs_outside_area_of_use",
  /** As above, and the same zone in the other unit fits. */
  "crs_unit_mismatch",
  /** Read as the stated system, the data lands at the origin of the world. */
  "crs_null_island",
] as const;

export type CrsRefusalReason = (typeof CRS_REFUSAL_REASONS)[number];

export type CrsRefusal = {
  ok: false;
  reason: CrsRefusalReason;
  /** Shown to the planner. Always names the real cause and the next step. */
  message: string;
};
