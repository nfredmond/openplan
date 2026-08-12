/**
 * What a workspace GIS layer must say about itself on screen.
 *
 * THE ONE PLACE THIS LANE DEPARTS FROM `describeMapLayerCoverage`, and why.
 * That function is keyed by `MapLayerKey`, a closed union whose members each
 * own a fixed noun ("projects", "crashes"). A workspace layer's noun is the
 * PLANNER'S OWN NAME for it — "Parcels", "Bike network", "1998 zoning" — which
 * a closed union cannot carry, and a generic noun would produce "Layers:
 * showing 500 of 214,391" on a panel listing four layers at once. So the counts
 * vocabulary is reused verbatim (`buildMapLayerDisclosure`, returned / matched /
 * dropped / truncated) and only the SENTENCES are local, exactly as
 * `context-layers.ts` does for the participant map.
 *
 * THE SENTENCE THAT DOES NOT EXIST ANYWHERE ELSE. Every other layer, at its
 * cap, says "showing 500 of 2,000 — the rest are not drawn". For a parcel
 * fabric that sentence is a trap: 500 arbitrary parcels of 214,391 draw as a
 * shredded fabric, and a planner looking at holes in their own parcel layer
 * will believe the holes are real. Above the cap this layer draws NOTHING and
 * says how many are there. Nothing on the map is then wrong.
 *
 * PURE — no I/O, no clock, no environment.
 */

import {
  MAP_FEATURE_LAYER_LIMIT,
  POSTGREST_MAX_ROWS_PER_REQUEST,
} from "@/lib/cartographic/layer-disclosure";
import type { WorkspaceGisVersion } from "./types";

/**
 * How many shapes one viewport request will draw.
 *
 * DERIVED, at twice the shared map-feature cap, so the relationship between the
 * caps stays legible and raising the shared one raises this with it. Twice
 * rather than ten times because of `POSTGREST_MAX_ROWS_PER_REQUEST`: PostgREST
 * silently truncates any single response at 1,000 rows, and a layer asking for
 * more would be cut by the platform with no error and no way to say so. This
 * sits exactly at that ceiling, and
 * `src/test/a-dense-layer-refuses-to-draw-rather-than-draw-half.test.ts` asserts
 * the relationship rather than restating the number.
 *
 * Two thousand parcels in one viewport is a planner zoomed out past the point
 * where individual parcels mean anything; one thousand is a dense downtown
 * block at a working zoom. The cap is not the interesting number — the
 * behaviour ABOVE it is.
 */
export const WORKSPACE_GIS_BBOX_DRAW_LIMIT = MAP_FEATURE_LAYER_LIMIT * 2;

/** Guard rail for the constant above; exported so a test can assert it. */
export const WORKSPACE_GIS_DRAW_LIMIT_FITS_ONE_REQUEST =
  WORKSPACE_GIS_BBOX_DRAW_LIMIT <= POSTGREST_MAX_ROWS_PER_REQUEST;

export type WorkspaceGisCoverageInput = {
  layerName: string;
  returnedCount: number;
  matchedCount: number;
  droppedCount: number;
  limit: number;
  tooDenseToDraw: boolean;
};

/**
 * The sentences for ONE layer in the current viewport.
 *
 * A list, never a joined string: a layer can be too dense AND carry undrawable
 * rows AND carry a datum caveat, and appending one to another lets a surface
 * render the first and lose the rest.
 */
export function describeWorkspaceLayerCoverage(input: WorkspaceGisCoverageInput): string[] {
  const notes: string[] = [];
  const name = input.layerName.trim() || "This layer";

  if (input.tooDenseToDraw) {
    notes.push(
      `${name}: ${input.matchedCount.toLocaleString()} shapes in this view — more than OpenPlan draws at once ` +
        `(${input.limit.toLocaleString()}). None of them are drawn, because drawing some of a fabric looks like ` +
        `holes in the fabric. Zoom in and they appear.`
    );
  } else if (input.returnedCount < input.matchedCount) {
    // The platform truncated the response below the cap this route asked for.
    // Disclosed rather than presented as the whole view.
    notes.push(
      `${name}: showing ${input.returnedCount.toLocaleString()} of ${input.matchedCount.toLocaleString()} shapes in this ` +
        `view. The rest are not drawn, which is not a finding that they are not there.`
    );
  }

  if (input.droppedCount > 0) {
    const count = input.droppedCount;
    notes.push(
      `${name}: ${count.toLocaleString()} ${count === 1 ? "shape" : "shapes"} in this view could not be drawn because ` +
        `the stored geometry was unusable, so ${count === 1 ? "it is" : "they are"} missing from the map rather than ` +
        `absent from the file.`
    );
  }

  return notes;
}

/**
 * The sentences that ride with a VERSION wherever it appears — the panel, the
 * legend, the inspector, the version history.
 *
 * These are properties of the upload rather than of the current viewport, which
 * is why they are built separately and why the datum note among them is
 * permanent: a positional caveat a planner sees once at upload and never again
 * is a caveat that stops existing the moment somebody else opens the map.
 */
export function describeWorkspaceLayerVersion(
  version: Pick<
    WorkspaceGisVersion,
    | "srs"
    | "datumShiftNote"
    | "truncated"
    | "declaredFeatureCount"
    | "sourceFeatureCount"
    | "droppedFeatureCount"
    | "attributeEncoding"
    | "attributeEncodingIsFallback"
    | "reprojectionEngine"
  >
): string[] {
  const notes: string[] = [];

  if (version.srs.basis === "planner_asserted") {
    /*
      THE LAST SENTENCE USED TO BE A PROMISE OPENPLAN COULD NOT KEEP.

      It read "If it lands in the wrong place, that is the setting to change",
      which tells a planner there is a setting. There is not. Re-placing a layer
      would mean re-projecting the original coordinates under a different
      system, and OpenPlan does not keep the original file — `storage_bucket`
      and `storage_path` exist on the version row with nothing writing them,
      deliberately, because retaining a 200 MB upload needs a browser-direct-to-
      storage transport this repository does not have (migration
      20260812000015). What is stored is the geometry already reprojected to
      longitude/latitude, from which the original eastings cannot be recovered.

      So the note now says what is actually available: upload it again. Naming
      the real remedy is worth more than a shorter sentence that sends a planner
      hunting through a settings panel for a control that was never built.
    */
    notes.push(
      `This file carried no coordinate system, so it is drawn as ${version.srs.name} — stated by the person ` +
        `who uploaded it, not read from the file. If it lands in the wrong place, that statement is why. ` +
        `OpenPlan does not keep the original file, so there is no setting that moves it: upload the file ` +
        `again, choose the right system, and delete this layer.`
    );
  }

  if (version.datumShiftNote) {
    notes.push(version.datumShiftNote);
  }

  if (version.truncated) {
    const kept = version.declaredFeatureCount.toLocaleString();
    const held = version.sourceFeatureCount.toLocaleString();
    notes.push(
      `This upload stored ${kept} of the ${held} shapes in the file. What is missing is the tail of the file, not a ` +
        `selection — the layer is incomplete in a way the map cannot show you.`
    );
  }

  if (version.droppedFeatureCount > 0) {
    notes.push(
      `${version.droppedFeatureCount.toLocaleString()} shapes in the file could not be placed and were not stored, so ` +
        `they are missing from the map rather than absent from the file.`
    );
  }

  if (version.attributeEncodingIsFallback && version.attributeEncoding) {
    notes.push(
      `This file did not say how its text was encoded, so attributes were read as ${version.attributeEncoding}. ` +
        `Accented or non-Latin names may be wrong; the geometry is unaffected.`
    );
  }

  return notes;
}
