import { z } from "zod";

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
  activitysim_bundle_manifest_json: z.string().nullable().optional(),
  behavioral_prototype_manifest_json: z.string().nullable().optional(),
  behavioral_runtime_manifest_json: z.string().nullable().optional(),
  behavioral_runtime_summary_json: z.string().nullable().optional(),
  behavioral_ingestion_summary_json: z.string().nullable().optional(),
  behavioral_kpi_summary_json: z.string().nullable().optional(),
  behavioral_kpi_packet_md: z.string().nullable().optional(),
});

export const countyOnrampRuntimeSchema = z.object({
  keep_project: z.boolean(),
  force: z.boolean(),
  overall_demand_scalar: z.number().nullable(),
  external_demand_scalar: z.number().nullable(),
  hbw_scalar: z.number().nullable(),
  hbo_scalar: z.number().nullable(),
  nhb_scalar: z.number().nullable(),
  activitysim_container_image: z.string().nullable().optional(),
  container_engine_cli: z.string().nullable().optional(),
  activitysim_container_cli_template: z.string().nullable().optional(),
  container_network_mode: z.string().nullable().optional(),
});

export const countyOnrampRunSnapshotSchema = z.object({
  zone_count: z.number().nullable(),
  population_total: z.number().nullable(),
  jobs_total: z.number().nullable(),
  loaded_links: z.number().nullable(),
  final_gap: z.number().nullable(),
  total_trips: z.number().nullable(),
});

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

export const countyOnrampActivitySimBundleSummarySchema = z
  .object({
    status: z.enum(["completed", "failed", "not-built"]),
    output_dir: z.string().nullable().optional(),
    manifest_path: z.string().nullable().optional(),
    land_use_rows: z.number().nullable().optional(),
    households: z.number().nullable().optional(),
    persons: z.number().nullable().optional(),
    skim_mode: z.enum(["copy", "symlink"]).nullable().optional(),
    error: z
      .object({
        message: z.string().min(1),
        kind: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const countyOnrampBehavioralPrototypeSummarySchema = z
  .object({
    pipeline_status: z
      .enum([
        "prototype_preflight_complete",
        "behavioral_runtime_succeeded",
        "behavioral_runtime_failed",
        "prototype_pipeline_failed",
        "prototype_pipeline_running",
      ])
      .nullable()
      .optional(),
    runtime_status: z
      .enum(["behavioral_runtime_blocked", "behavioral_runtime_succeeded", "behavioral_runtime_failed"])
      .nullable()
      .optional(),
    runtime_mode: z.string().nullable().optional(),
    runtime_posture: z.string().nullable().optional(),
    output_root: z.string().nullable().optional(),
    prototype_manifest_path: z.string().nullable().optional(),
    runtime_manifest_path: z.string().nullable().optional(),
    runtime_summary_path: z.string().nullable().optional(),
    ingestion_summary_path: z.string().nullable().optional(),
    kpi_summary_path: z.string().nullable().optional(),
    kpi_packet_path: z.string().nullable().optional(),
    caveats: z.array(z.string()).optional(),
  })
  .passthrough();

export const countyRunEnqueueStatusSchema = z.enum(["not-enqueued", "queued_stub", "failed"]);

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
  summary: z.object({
    run: countyOnrampRunSnapshotSchema,
    validation: countyOnrampValidationSummarySchema.nullable(),
    bundle_validation: z.record(z.string(), z.unknown()).nullable(),
    activitysim_bundle: countyOnrampActivitySimBundleSummarySchema.nullable().optional(),
    behavioral_prototype: countyOnrampBehavioralPrototypeSummarySchema.nullable().optional(),
  }),
});

export type CountyOnrampArtifacts = z.infer<typeof countyOnrampArtifactsSchema>;
export type CountyOnrampRuntime = z.infer<typeof countyOnrampRuntimeSchema>;
export type CountyOnrampRunSnapshot = z.infer<typeof countyOnrampRunSnapshotSchema>;
export type CountyOnrampValidationSummary = z.infer<typeof countyOnrampValidationSummarySchema>;
export type CountyOnrampActivitySimBundleSummary = z.infer<typeof countyOnrampActivitySimBundleSummarySchema>;
export type CountyOnrampBehavioralPrototypeSummary = z.infer<typeof countyOnrampBehavioralPrototypeSummarySchema>;
export type CountyOnrampManifest = z.infer<typeof countyOnrampManifestSchema>;

export function getCountyRunStageLabel(stage: CountyRunStage): string {
  switch (stage) {
    case "bootstrap-incomplete":
      return "Bootstrap In Progress";
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

export function getCountyRunStageReasonLabel(input: {
  stage: CountyRunStage;
  enqueueStatus?: CountyRunEnqueueStatus | null;
  statusLabel?: string | null;
  behavioralPipelineStatus?: string | null;
  behavioralRuntimeStatus?: string | null;
  behavioralComparisonReady?: boolean | null;
  behavioralEvidenceReady?: boolean | null;
}): string | null {
  if (input.stage === "validated-screening") {
    return input.statusLabel?.trim() || "Validation gate passed on the documented slice.";
  }

  if (input.stage === "validation-scaffolded") {
    return "Scaffold exists; count ingestion or station cleanup is still underway.";
  }

  if (input.stage === "runtime-complete") {
    return "Runtime artifacts are complete; observed-count validation has not closed yet.";
  }

  if (input.behavioralComparisonReady) {
    return "Behavioral comparison artifacts are ready for internal review.";
  }

  if (input.behavioralPipelineStatus === "prototype_pipeline_running") {
    return "Behavioral prototype lane is still running.";
  }

  if (input.behavioralRuntimeStatus === "behavioral_runtime_blocked") {
    return "Behavioral runtime was requested but only reached preflight depth.";
  }

  if (input.behavioralRuntimeStatus === "behavioral_runtime_failed") {
    return "Behavioral runtime attempted execution and failed.";
  }

  if (input.behavioralEvidenceReady) {
    return "Prototype evidence artifacts exist, but comparison-ready outputs are not complete.";
  }

  if (input.enqueueStatus === "queued_stub") {
    return "Bootstrap handoff is prepared for background execution.";
  }

  if (input.enqueueStatus === "failed") {
    return "Most recent enqueue/bootstrap attempt failed and needs operator review.";
  }

  return "County onboarding job is still running or awaiting its first recorded runtime artifacts.";
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
    case "queued_stub":
      return "Enqueue Prepared";
    case "failed":
      return "Enqueue Failed";
    case "not-enqueued":
    default:
      return "Not Enqueued";
  }
}

export function getCountyRunEnqueueStatusTone(status: CountyRunEnqueueStatus): "neutral" | "info" | "danger" {
  switch (status) {
    case "queued_stub":
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
    case "queued_stub":
      return "County bootstrap handoff is prepared for background execution.";
    case "failed":
      return "Most recent enqueue/bootstrap attempt failed and needs operator review.";
    case "not-enqueued":
    default:
      return "County run has not yet been prepared for background bootstrap.";
  }
}
