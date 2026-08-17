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
  // WHETHER THE ASSIGNMENT REACHED EQUILIBRIUM — the answer, not the evidence.
  // `final_gap` alone needs a reader who knows the target and notices which
  // number is larger, and for as long as this lane has existed that gap arrived
  // as null anyway: the county on-ramp read it from the run summary while the
  // producer wrote it only to the bundle manifest, so a run that stopped
  // mid-calculation and a run that settled looked identical here.
  //
  // Optional and NULLABLE, never defaulted to false: a run whose producer did
  // not record convergence has not failed to converge, and asserting that it
  // did fail would be a claim nobody measured.
  assignment_converged: z.boolean().nullable().optional(),
  assignment_convergence_caveat: z.string().nullable().optional(),
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
  // WHICH ROAD EXTRACT the figures rest on. OpenStreetMap changes continuously,
  // so a run from last year and one from today describe different roads, and an
  // appendix defending a funded figure has to be able to say which. Optional
  // and nullable: runs produced before the lane recorded it genuinely do not
  // know, and inventing a date would be the worst possible substitute.
  // How much of residents' own driving leaves the study area — and is
  // therefore NOT in the per-capita figure, while those residents remain in
  // the population it is divided by. The smaller the area, the more the figure
  // understates: the same county measured 40.5 vehicle-miles per person and a
  // sub-county area inside it measured 10.8.
  resident_trips_leaving_study_area_share: z.number().nullable().optional(),
  per_capita_understatement_caveat: z.string().nullable().optional(),
  network_downloaded_at: z.string().nullable().optional(),
  network_source: z.string().nullable().optional(),
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
    // WHICH COUNTS A PERSON TYPED IN. Observed counts reach a run either from a
    // state DOT's published feed or from a planner's keyboard, and once they
    // are in the same column they are indistinguishable — while carrying
    // completely different authority. Accumulated across saves, never reset:
    // an edit made three saves ago is still a hand-entered figure.
    hand_edited_station_ids: z.array(z.string()).optional(),
    hand_edited_at: z.string().nullable().optional(),
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
 * Screening-gate statuses that DO count as passing modeling evidence.
 *
 * AN ALLOWLIST, FLIPPED FROM A DENYLIST 2026-08-08 — a deliberate behaviour
 * change, decided rather than deferred.
 *
 * It used to name the one non-passing status and treat everything else as a
 * pass, which fails OPEN: any new or misspelled gate string a producer writes
 * counts as evidence until somebody remembers to add it. The comment below
 * already said why that is the wrong default — this value "is recorded by
 * whatever produced the run's validation summary rather than by a Postgres
 * enum" — and an unconstrained field read against a denylist is the definition
 * of a fail-open control. On a claim-boundary surface the default has to be
 * "this is not evidence".
 *
 * The vocabulary is small and knowable: `classify_gate` in
 * `scripts/modeling/validate_screening_observed_counts.py` returns exactly
 * `bounded screening-ready` or `internal prototype only`. The old denylist test
 * asserted that `"validated screening slice"` passed — a string nothing in the
 * repository emits, so the assertion encoded the fail-open default rather than
 * a real producer's output.
 *
 * Reaching the validated-screening STAGE says the validation slice ran, not
 * that it passed: a run whose worst matched facility blows past the critical
 * threshold is still stamped validated-screening, with a gate recording that it
 * is prototype-grade. Treating that as evidence would let a failed validation
 * strengthen a claim.
 *
 * Matching is case-insensitive and trims. Jurisdiction-neutral: it keys on the
 * gate a run recorded about itself, never on which county was run.
 */
export const COUNTY_RUN_PASSING_GATE_STATUSES: readonly string[] = ["bounded screening-ready"];

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
  // Fails CLOSED: an unrecognised status is not evidence.
  if (!COUNTY_RUN_PASSING_GATE_STATUSES.includes(normalized)) return false;
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

/**
 * The caveats that must travel with a county run, given its stage AND what the
 * run actually did.
 *
 * THE MANIFEST ARGUMENT IS REQUIRED, INCLUDING WHEN IT IS NULL, and that is
 * deliberate. Two of these caveats used to be fixed strings decided by the stage
 * alone, and both became false as the modelling lane grew:
 *
 *   - "Uncalibrated" was shown on runs that HAD been fitted to published traffic
 *     counts, on the same screen as the calibration result.
 *   - nothing said whether the synthetic population came from real survey
 *     records or was expanded from the trip model's own zone attributes, which
 *     is the difference between two independent methods and one method twice.
 *
 * An optional parameter would have let a call site keep the stale list without
 * anyone choosing to. Passing `null` is still allowed — a caller with no
 * manifest genuinely knows nothing — but it has to be written down.
 */
export function getCountyRunCaveats(
  stage: CountyRunStage,
  manifest: CountyOnrampManifest | null
): string[] {
  if (stage === "validated-screening") {
    return [
      "Screening-grade only",
      calibrationCaveat(manifest),
      populationCaveat(manifest),
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

/** Whether this run was fitted to published counts, read from its own record. */
function calibrationCaveat(manifest: CountyOnrampManifest | null): string {
  const calibration = (manifest as unknown as Record<string, unknown> | null)?.calibration;
  if (!calibration || typeof calibration !== "object") return "Uncalibrated";
  const record = calibration as Record<string, unknown>;
  if (record.performed !== true) return "Uncalibrated";
  const holdout = (record.holdout_station_count as number | undefined) ?? null;
  return holdout
    ? `Calibrated to published counts, graded on ${holdout} stations held back from the fitting`
    : "Calibrated to published counts";
}

/**
 * Where this run's households came from, which decides whether the behavioural
 * lane is an independent second method or a rearrangement of the first one's
 * inputs.
 */
function populationCaveat(manifest: CountyOnrampManifest | null): string {
  const summary = (manifest as unknown as Record<string, unknown> | null)?.summary;
  const bundle = (summary as Record<string, unknown> | undefined)?.activitysim_bundle;
  const population = (bundle as Record<string, unknown> | undefined)?.population;
  const status = (population as Record<string, unknown> | undefined)?.status;
  if (status === "fitted_to_published_totals") {
    return "Households built from real Census survey answers; travel behaviour still not modelled";
  }
  return "Not behavioral demand";
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
