/**
 * What OpenPlan says to a planner holding a file geodatabase.
 *
 * WHY THIS IS NOT "UNSUPPORTED FORMAT". A .gdb is what a county GIS shop hands
 * out — often the ONLY thing they hand out — and it is a directory of binary
 * tables (or a zip of them) that no in-browser parser is going to read. Falling
 * into a generic "unsupported file type" refusal would teach that planner
 * nothing except that OpenPlan does not work with their agency's data. It is
 * also nearly always wrong as advice: they have ArcGIS Pro open, and exporting
 * to a shapefile or GeoJSON is four clicks.
 *
 * SO THE REFUSAL CARRIES THE FREE WAY OUT FIRST, and the operator's option
 * second — in the `src/lib/aerial/processing-availability.ts` mould, where an
 * unconfigured deployment names exactly what an operator would set rather than
 * claiming a capability does not exist. A planner reading this can finish their
 * work in the next five minutes without anyone provisioning anything.
 *
 * SERVER-ONLY: these env vars are unprefixed and must not reach a browser
 * bundle. Call from a route handler or a server component.
 */

export const SPATIAL_CONVERSION_WORKER_URL_ENV = "OPENPLAN_SPATIAL_WORKER_URL";
export const SPATIAL_CONVERSION_WORKER_TOKEN_ENV = "OPENPLAN_SPATIAL_WORKER_TOKEN";

/**
 * True when both halves of the worker credential pair are present.
 *
 * Read as literal property accesses rather than `process.env[name]` so the
 * values survive Next's build-time env handling, and mirroring the dispatch
 * condition exactly: a deployment with a URL and no token is NOT configured,
 * and must not be told otherwise.
 */
export function isSpatialConversionWorkerConfigured(): boolean {
  const url = process.env.OPENPLAN_SPATIAL_WORKER_URL?.trim();
  const token = process.env.OPENPLAN_SPATIAL_WORKER_TOKEN?.trim();
  return Boolean(url && token);
}

export type SpatialConversionAvailabilityNotice = {
  title: string;
  description: string;
  /** The step a planner can take right now, with no operator involved. */
  exportPath: string;
};

/**
 * THE EXPORT PATH, WRITTEN ONCE.
 *
 * Named as a constant because it is the load-bearing sentence of the whole
 * refusal and it is asserted by
 * `src/test/an-unconfigured-deployment-names-the-export-path.test.ts` — a
 * refusal that lost it would still look like a polite error message while
 * having stopped being useful.
 */
export const FILE_GEODATABASE_EXPORT_PATH =
  "In ArcGIS Pro: right-click the layer → Data → Export Features, and save it as a shapefile or GeoJSON. " +
  "In QGIS: right-click the layer → Export → Save Features As, and choose GeoJSON. Then upload that file here.";

/**
 * The two honest things this deployment can say about converting a format
 * OpenPlan cannot read in-process.
 *
 * Pure and parameterised so both branches are testable without touching the
 * environment; the caller supplies the answer from
 * `isSpatialConversionWorkerConfigured()`.
 */
export function describeSpatialConversionAvailability(
  workerConfigured: boolean,
  format: string = "file geodatabase"
): SpatialConversionAvailabilityNotice {
  if (!workerConfigured) {
    return {
      title: `OpenPlan cannot read a ${format} on this deployment`,
      description:
        `A ${format} is a binary format that needs GDAL to open, and this deployment has not configured a conversion ` +
        `worker (${SPATIAL_CONVERSION_WORKER_URL_ENV} and ${SPATIAL_CONVERSION_WORKER_TOKEN_ENV}). Nothing was stored ` +
        `and nothing was guessed. You do not need to wait for anyone: export the layer you want to a shapefile or ` +
        `GeoJSON and upload that instead.`,
      exportPath: FILE_GEODATABASE_EXPORT_PATH,
    };
  }

  // THE CONFIGURED BRANCH NAMES A REAL GAP RATHER THAN A CAPABILITY.
  //
  // This build has no dispatch path: nothing uploads the file to a worker, and
  // nothing consumes a conversion callback. An operator who set the two env
  // vars has provisioned a worker OpenPlan does not yet call, and saying "this
  // deployment can convert a file geodatabase" to them would be the aerial
  // defect exactly inverted — a live surface claiming a capability the code
  // does not have. When the dispatch lane lands, this branch is what changes.
  return {
    title: `A conversion worker is configured, but OpenPlan does not use it yet`,
    description:
      `This deployment has set ${SPATIAL_CONVERSION_WORKER_URL_ENV} and ${SPATIAL_CONVERSION_WORKER_TOKEN_ENV}, but ` +
      `this build has no dispatch path to a conversion worker: it never uploads a ${format} anywhere and never asks ` +
      `for a conversion. Nothing was stored and nothing was guessed. Export the layer you want to a shapefile or ` +
      `GeoJSON and upload that instead — that path is complete today. When conversion does land, the worker will ` +
      `report the coordinate system it found, OpenPlan will decide against the same registry it uses for every other ` +
      `upload, and the version will record that PROJ did the transform rather than OpenPlan.`,
    exportPath: FILE_GEODATABASE_EXPORT_PATH,
  };
}
