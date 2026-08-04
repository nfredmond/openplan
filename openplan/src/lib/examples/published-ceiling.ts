import {
  NEVADA_COUNTY_MAX_APE_PERCENT,
  NEVADA_COUNTY_RUN_CONTEXT,
} from "./nevada-county-2026-03-24";

/**
 * The worst validation figure OpenPlan has PUBLISHED, computed — never
 * restated — from the example records in this directory.
 *
 * Why published records and not the database: /legal is a public page, and a
 * "live ceiling" queried from modeling_validation_results would aggregate
 * customer workspaces' validation data onto a public surface. The honest
 * live-ness is with respect to what the project itself publishes: every
 * fixture added here (a calibration example, a new county) updates /legal's
 * stated ceiling automatically, and a guard fails if any page restates the
 * number instead of deriving it.
 */

export type PublishedValidationRecord = {
  label: string;
  runDate: string;
  maxApePercent: number;
};

export const PUBLISHED_VALIDATION_RECORDS: readonly PublishedValidationRecord[] = [
  {
    label: "Nevada County screening run",
    runDate: NEVADA_COUNTY_RUN_CONTEXT.createdAt.slice(0, 10),
    maxApePercent: NEVADA_COUNTY_MAX_APE_PERCENT,
  },
];

/** The worst record in a set — exported separately so the logic is testable. */
export function worstPublishedRecord(
  records: readonly PublishedValidationRecord[]
): PublishedValidationRecord {
  if (records.length === 0) {
    throw new Error("No published validation records exist — /legal cannot state a ceiling.");
  }
  return records.reduce((worst, record) =>
    record.maxApePercent > worst.maxApePercent ? record : worst
  );
}

export function publishedValidationCeiling(): PublishedValidationRecord {
  return worstPublishedRecord(PUBLISHED_VALIDATION_RECORDS);
}
