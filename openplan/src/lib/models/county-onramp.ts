import { z } from "zod";

import {
  LINK_VALIDATION_NOT_SUPPORTED_CAVEAT,
  bandIntrazonalShare,
} from "@/lib/models/zone-resolution";

export const countyRunStageSchema = z.enum([
  "bootstrap-incomplete",
  "runtime-complete",
  "validation-scaffolded",
  "validated-screening",
]);

export type CountyRunStage = z.infer<typeof countyRunStageSchema>;

export const countyOnrampArtifactsSchema = z.object({
  scaffold_csv: z.string(),
  review_packet_md: z.string(),
  run_summary_json: z.string().nullable(),
  bundle_manifest_json: z.string().nullable(),
  validation_summary_json: z.string().nullable(),
}).passthrough();

export const countyOnrampRuntimeSchema = z.object({
  keep_project: z.boolean(),
  force: z.boolean(),
  overall_demand_scalar: z.number().nullable(),
  external_demand_scalar: z.number().nullable(),
  hbw_scalar: z.number().nullable(),
  hbo_scalar: z.number().nullable(),
  nhb_scalar: z.number().nullable(),
  activitysim_container_image: z.string().min(1).optional(),
  container_engine_cli: z.string().min(1).optional(),
  activitysim_container_cli_template: z.string().min(1).optional(),
  container_network_mode: z.string().min(1).optional(),
}).passthrough();

export const countyOnrampRunSnapshotSchema = z.object({
  zone_count: z.number().nullable(),
  population_total: z.number().nullable(),
  jobs_total: z.number().nullable(),
  loaded_links: z.number().nullable(),
  final_gap: z.number().nullable(),
  total_trips: z.number().nullable(),
  // Screening-grade VMT (optional): daily internal resident VMT and per-capita
  // VMT, with a provenance string documenting how they were derived. Absent for
  // runs whose producer has not computed VMT.
  daily_vmt: z.number().nullable().optional(),
  vmt_per_capita: z.number().nullable().optional(),
  vmt_provenance: z.string().nullable().optional(),
  // Share of internal trips beginning and ending in the same zone, as a
  // FRACTION (0-1) — the same unit and name the AequilibraE worker's KPI uses.
  // Optional and nullable because runs produced before the county lane recorded
  // it have no value, and 0 would be the most flattering possible substitute.
  intrazonal_trip_share: z.number().nullable().optional(),
}).passthrough();

export const countyOnrampScaffoldSummarySchema = z
  .object({
    station_count: z.number(),
    observed_volume_filled_count: z.number(),
    observed_volume_missing_count: z.number(),
    source_agency_filled_count: z.number(),
    source_agency_tbd_count: z.number(),
    source_description_filled_count: z.number(),
    source_description_missing_count: z.number(),
    ready_station_count: z.number(),
    next_action_label: z.string().min(1),
    inline_csv_content: z.string().min(1).optional(),
  })
  .passthrough();

export const countyOnrampValidationSummarySchema = z
  .object({
    screening_gate: z
      .object({
        status_label: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    metrics: z
      .object({
        median_absolute_percent_error: z.number().nullable().optional(),
        mean_absolute_percent_error: z.number().nullable().optional(),
        min_absolute_percent_error: z.number().nullable().optional(),
        max_absolute_percent_error: z.number().nullable().optional(),
        spearman_rho_facility_ranking: z.number().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const countyRunEnqueueStatusSchema = z.enum(["not-enqueued", "prepared", "submitted", "failed"]);

export type CountyRunEnqueueStatus = z.infer<typeof countyRunEnqueueStatusSchema>;

export const countyOnrampManifestSchema = z.object({
  schema_version: z.literal("openplan.county_onramp_manifest.v1"),
  generated_at: z.string(),
  name: z.string().min(1),
  county_fips: z.string().nullable(),
  county_prefix: z.string().min(1),
  run_dir: z.string().min(1),
  mode: z.enum(["build-and-bootstrap", "existing-run"]),
  stage: countyRunStageSchema,
  artifacts: countyOnrampArtifactsSchema,
  runtime: countyOnrampRuntimeSchema,
  summary: z
    .object({
      run: countyOnrampRunSnapshotSchema,
      validation: countyOnrampValidationSummarySchema.nullable(),
      bundle_validation: z.record(z.string(), z.unknown()).nullable(),
      scaffold: countyOnrampScaffoldSummarySchema.nullable().optional(),
    })
    .passthrough(),
});

export type CountyOnrampArtifacts = z.infer<typeof countyOnrampArtifactsSchema>;
export type CountyOnrampRuntime = z.infer<typeof countyOnrampRuntimeSchema>;
export type CountyOnrampRunSnapshot = z.infer<typeof countyOnrampRunSnapshotSchema>;
export type CountyOnrampScaffoldSummary = z.infer<typeof countyOnrampScaffoldSummarySchema>;
export type CountyOnrampValidationSummary = z.infer<typeof countyOnrampValidationSummarySchema>;
export type CountyOnrampManifest = z.infer<typeof countyOnrampManifestSchema>;

/**
 * Screening-gate statuses that mean a county run must NOT be treated as
 * passing modeling evidence, even once it reaches `validated-screening`.
 *
 * Reaching the validated-screening stage says the validation slice RAN, not
 * that it passed: a run whose worst matched facility blows past the
 * critical-facility error threshold is still stamped validated-screening, with
 * a gate status recording that it is prototype-grade. Treating that as
 * evidence would let a failed validation strengthen a claim.
 *
 * Matching is case-insensitive and trims, because this value is recorded by
 * whatever produced the run's validation summary rather than by a Postgres
 * enum. It is a jurisdiction-neutral rule: it keys on the gate the run
 * recorded about itself, never on which county was run.
 */
export const COUNTY_RUN_NON_PASSING_GATE_STATUSES: readonly string[] = ["internal prototype only"];

/**
 * Whether a recorded screening-gate status counts as passing evidence.
 *
 * `intrazonalTripShare` is the FRACTION of this run's trips that begin and end
 * in the same zone — travel that carries VMT and no link volume. Where that
 * share is past OpenPlan's threshold, a link-level comparison to observed
 * counts cannot establish anything, so the gate it produced cannot make the run
 * passing evidence no matter what it says.
 *
 * WHY THE VERDICT IS RECOMPUTED HERE RATHER THAN READ OFF THE ROW. The county
 * lane's validator writes its gate string offline, before this qualification
 * existed, and an operator reruns it by hand. Banding the NUMBER at read time
 * gives one answer for runs recorded before and after — the same rule the run
 * zone panel follows, and for the same reason: producers store different
 * things, and one of them stores nothing.
 *
 * Omitting the share (null/undefined) leaves the gate's own verdict standing.
 * An unmeasured share is a missing measurement, not a coarse zone system, and
 * refusing every county run recorded before the share existed would be a
 * refusal nobody could act on.
 */
export function isPassingCountyRunGateStatus(
  statusLabel: string | null | undefined,
  intrazonalTripShare?: number | null
): boolean {
  const normalized = statusLabel?.trim().toLowerCase();
  if (!normalized) return false;
  if (COUNTY_RUN_NON_PASSING_GATE_STATUSES.includes(normalized)) return false;
  if (typeof intrazonalTripShare === "number" && Number.isFinite(intrazonalTripShare)) {
    // The share is stored as a fraction; the banding works in percent.
    if (!bandIntrazonalShare(intrazonalTripShare * 100, null).supportsLinkLevelValidation) {
      return false;
    }
  }
  return true;
}

/**
 * What to tell a planner when a county run's gate was set aside by its own zone
 * system. Null when the zone system does not disqualify the comparison, so a
 * caller can render this without deciding anything itself.
 */
export function countyRunZoneResolutionCaveat(
  intrazonalTripShare: number | null | undefined,
  zoneCount?: number | null
): string | null {
  if (typeof intrazonalTripShare !== "number" || !Number.isFinite(intrazonalTripShare)) {
    return null;
  }
  const banded = bandIntrazonalShare(intrazonalTripShare * 100, zoneCount ?? null);
  if (banded.supportsLinkLevelValidation) return null;
  return `${banded.summary} ${LINK_VALIDATION_NOT_SUPPORTED_CAVEAT}`;
}

export function getCountyRunStageLabel(stage: CountyRunStage): string {
  switch (stage) {
    case "bootstrap-incomplete":
      return "Running";
    case "runtime-complete":
      return "Runtime Complete";
    case "validation-scaffolded":
      return "Validation In Progress";
    case "validated-screening":
      return "Validated Screening";
    default:
      return stage;
  }
}

export function getCountyRunStageTone(stage: CountyRunStage): "neutral" | "info" | "warning" | "success" {
  switch (stage) {
    case "bootstrap-incomplete":
      return "neutral";
    case "runtime-complete":
      return "info";
    case "validation-scaffolded":
      return "warning";
    case "validated-screening":
      return "success";
    default:
      return "neutral";
  }
}

export function getCountyRunAllowedClaim(stage: CountyRunStage): string {
  switch (stage) {
    case "bootstrap-incomplete":
      return "County onboarding job is in progress.";
    case "runtime-complete":
      return "County runtime completed. Local validation has not yet been completed.";
    case "validation-scaffolded":
      return "County has entered the validation workflow, but is not yet bounded screening-ready.";
    case "validated-screening":
      return "County has a bounded screening-ready result on the documented validated slice, with explicit caveats.";
    default:
      return "County state available.";
  }
}

export function getCountyRunCaveats(stage: CountyRunStage): string[] {
  if (stage === "validated-screening") {
    return [
      "Screening-grade only",
      "Uncalibrated",
      "Not behavioral demand",
      "Not client-ready forecasting",
      "Validated slice only",
    ];
  }
  if (stage === "validation-scaffolded") {
    return ["Not ready for outward modeling claims."];
  }
  if (stage === "runtime-complete") {
    return ["Screening-grade runtime output only.", "No local validation result yet."];
  }
  return ["County onboarding job is still in progress."];
}

export function getCountyRunEnqueueStatusLabel(status: CountyRunEnqueueStatus): string {
  switch (status) {
    case "prepared":
      return "Prepared — not sent";
    case "submitted":
      return "Sent to the worker";
    case "failed":
      return "Send failed";
    case "not-enqueued":
    default:
      return "Not started";
  }
}

export function getCountyRunEnqueueStatusTone(status: CountyRunEnqueueStatus): "neutral" | "info" | "danger" {
  switch (status) {
    case "prepared":
    case "submitted":
      return "info";
    case "failed":
      return "danger";
    case "not-enqueued":
    default:
      return "neutral";
  }
}

export function getCountyRunEnqueueHelpText(status: CountyRunEnqueueStatus): string {
  switch (status) {
    case "prepared":
      return "The county setup handoff is prepared but has not been sent anywhere yet.";
    case "submitted":
      return "The county setup job was sent to the configured worker.";
    case "failed":
      return "The last attempt to send this county setup job failed and needs operator review.";
    case "not-enqueued":
    default:
      return "This county run has not been prepared for background setup yet.";
  }
}
