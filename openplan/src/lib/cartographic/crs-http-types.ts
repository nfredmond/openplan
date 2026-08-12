/**
 * The wire shapes between the browser's upload wizard and the coordinate-system
 * registry, which lives on the server.
 *
 * ═══ WHY THIS FILE HAD TO EXIST ═══
 *
 * The CRS lane draws a hard line: DECIDING which system a file is in happens on
 * the server (it is a claim, and it reaches ~1.4 MB of generated data), while
 * APPLYING one happens wherever the file is — in the browser, because a 200 MB
 * shapefile never fits in a request body. `spatialFileCrsFor(entry)` is the
 * seam, and it takes an ENTRY.
 *
 * Which leaves a gap nothing else fills: the browser needs the entry, and the
 * entry only exists on the server. Every other lane's contract stops short of
 * it — the ingest route takes an already-parsed, already-reprojected file, so it
 * is far too late to be the thing that hands the browser its projection. So
 * these two requests exist, and they are deliberately the ONLY way a browser
 * reaches the registry.
 *
 * ═══ WHAT THE BROWSER IS AND IS NOT TRUSTED WITH ═══
 *
 * It receives the arithmetic — the ellipsoid, the parameters, the area of use —
 * and computes longitude and latitude with it. It does NOT decide what the file
 * is: the version row's `srs` and, critically, its `basis` are written by the
 * ingest route from the .prj text or the asserted code, server-side, exactly as
 * `crs-resolution.ts` describes. A tampered browser can draw a preview wrong on
 * its own screen; it cannot make the record say the file carried a .prj it did
 * not carry.
 *
 * PURE — types and one narrowing helper. No I/O.
 */

import type { CrsAreaOfUse, CrsRegistryEntry } from "@/lib/geo/crs/types";

/**
 * One row of the "which system is this file in?" picker.
 *
 * SUMMARY RATHER THAN THE WHOLE ENTRY, and the reason is weight: a regional
 * query legitimately returns a couple of hundred systems, and each full entry
 * carries projection parameters and every ESRI spelling it is known by. The
 * picker needs none of that — it needs what a planner reads in a list. The full
 * entry is fetched for the ONE system they choose.
 */
export type CrsPickerOption = {
  /** "EPSG:2226" — what the wizard sends back when the planner picks this row. */
  id: string;
  authority: string;
  code: string;
  name: string;
  unit: string;
  kind: "geographic" | "projected";
  datum: string;
  /** True when choosing this system obliges the planner to acknowledge a caveat. */
  requiresDatumAcknowledgement: boolean;
  datumShiftNote: string | null;
  /** The issuing authority's own words for what the system covers. */
  areaDescription: string;
};

export type CrsPickerResponse = {
  options: CrsPickerOption[];
  /**
   * Systems covering the region, before the response cap. Disclosed so a picker
   * showing 200 of 340 can say so instead of presenting a truncated list as the
   * complete set of systems that could apply.
   */
  matchedCount: number;
  /**
   * True when the query carried no region. The list is then whatever the
   * registry holds first, which is NOT a recommendation — the wizard says so.
   */
  unscoped: boolean;
};

/** What the server decided a `.prj` (or a chosen code) names. */
export type CrsIdentifyResponse =
  | {
      ok: true;
      entry: CrsRegistryEntry;
      /**
       * How the system was established. `prj_file` is the file's own testimony;
       * `planner_asserted` is a person's statement. The ingest route decides
       * this again, independently, from the same evidence — this copy exists so
       * the wizard can SAY which one it is about to record.
       */
      basis: "prj_file" | "planner_asserted";
      /**
       * The same projection on the same datum in other UNITS — the metre twin of
       * a survey-foot zone, and vice versa.
       *
       * FULL ENTRIES, not summaries, unlike the picker: `checkCrsPlacement` has
       * to actually reproject the file's corners under each one to say "you
       * chose feet and this file is in metres", and that needs the projection
       * parameters. There are at most a handful per zone, so the weight is
       * nothing like the picker's couple of hundred rows.
       */
      siblings: CrsRegistryEntry[];
    }
  | {
      ok: false;
      /** A `CrsRefusalReason`, or `crs_registry_unavailable`. */
      reason: string;
      /** Shown verbatim. Always names the real cause and the next step. */
      message: string;
      /** What the file said it was, when it said anything readable. */
      declaredName: string | null;
      declaredCode: string | null;
    };

export function crsPickerOptionFor(entry: {
  authority: string;
  code: string;
  name: string;
  unit: string;
  kind: "geographic" | "projected";
  datum: string;
  requiresDatumAcknowledgement: boolean;
  datumShiftNote: string | null;
  areaOfUse: CrsAreaOfUse;
}): CrsPickerOption {
  return {
    id: `${entry.authority}:${entry.code}`,
    authority: entry.authority,
    code: entry.code,
    name: entry.name,
    unit: entry.unit,
    kind: entry.kind,
    datum: entry.datum,
    requiresDatumAcknowledgement: entry.requiresDatumAcknowledgement,
    datumShiftNote: entry.datumShiftNote,
    areaDescription: entry.areaOfUse.description,
  };
}
