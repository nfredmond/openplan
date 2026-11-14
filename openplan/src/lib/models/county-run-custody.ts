import "server-only";
import { isDeepStrictEqual } from "node:util";
import { countyOnrampManifestSchema, countyOnrampValidationSummarySchema } from "@/lib/models/county-onramp";

/** Check retained metadata without reconstructing missing historical facts. Empty
 * objects are the county-run writer's explicit pre-manifest state. */
export function countyRunCustodyError(row: {
  manifest_json?: unknown;
  validation_summary_json?: unknown;
}): string | null {
  const manifestValue = row.manifest_json;
  const validationValue = row.validation_summary_json ?? {};
  const validation = countyOnrampValidationSummarySchema.safeParse(validationValue);
  if (!validation.success) return "County validation metadata is malformed. No evidence record can be displayed or downloaded.";
  if (manifestValue == null || (typeof manifestValue === "object" && !Array.isArray(manifestValue) && Object.keys(manifestValue).length === 0)) {
    return null;
  }
  const manifest = countyOnrampManifestSchema.safeParse(manifestValue);
  if (!manifest.success) return "County manifest metadata is malformed. No evidence record can be displayed or downloaded.";
  if (!isDeepStrictEqual(manifest.data.summary.validation ?? {}, validation.data)) {
    return "County validation summaries disagree. No evidence record can be displayed or downloaded.";
  }
  return null;
}
