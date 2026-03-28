import { describe, expect, it } from "vitest";
import {
  countyOnrampManifestSchema,
  getCountyRunAllowedClaim,
  getCountyRunCaveats,
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
  getCountyRunStageLabel,
  getCountyRunStageTone,
} from "@/lib/models/county-onramp";
import {
  createCountyRunRequestSchema,
  ingestCountyRunManifestRequestSchema,
  type CountyRunListItem,
} from "@/lib/api/county-onramp";
import {
  buildCountyActivitySimBundleUiCard,
  buildCountyBehavioralPrototypeUiCard,
  buildCountyRunSummaryCounts,
  buildCountyRunUiCard,
  filterCountyRunListItemsByQuickView,
  getCountyRunMetricHighlights,
  getCountyRunNextAction,
  getCountyRunStatusLabel,
  sortCountyRunListItems,
} from "@/lib/ui/county-onramp";

const validatedManifestFixture = {
  schema_version: "openplan.county_onramp_manifest.v1",
  generated_at: "2026-03-24T23:00:00Z",
  name: "nevada-county-runtime-scalar0369-connectorbias2-20260324",
  county_fips: "06057",
  county_prefix: "NEVADA",
  run_dir: "/tmp/nevada",
  mode: "existing-run",
  stage: "validated-screening",
  artifacts: {
    scaffold_csv: "/tmp/scaffold.csv",
    review_packet_md: "/tmp/review.md",
    run_summary_json: "/tmp/run_summary.json",
    bundle_manifest_json: "/tmp/bundle_manifest.json",
    validation_summary_json: "/tmp/validation_summary.json",
    activitysim_bundle_manifest_json: "/tmp/activitysim/bundle_manifest.json",
    behavioral_prototype_manifest_json: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
    behavioral_runtime_manifest_json: "/tmp/behavioral/runtime/activitysim_runtime_manifest.json",
    behavioral_runtime_summary_json: "/tmp/behavioral/runtime/activitysim_runtime_summary.json",
    behavioral_ingestion_summary_json: "/tmp/behavioral/ingestion/activitysim_ingestion_summary.json",
    behavioral_kpi_summary_json: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_summary.json",
    behavioral_kpi_packet_md: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_packet.md",
  },
  runtime: {
    keep_project: true,
    force: false,
    overall_demand_scalar: 0.369,
    external_demand_scalar: null,
    hbw_scalar: null,
    hbo_scalar: null,
    nhb_scalar: null,
    activitysim_container_image: "python:3.11-slim",
    container_engine_cli: "docker",
    activitysim_container_cli_template: "python -m pip install activitysim && activitysim run",
    container_network_mode: "bridge",
  },
  summary: {
    run: {
      zone_count: 26,
      population_total: 102345,
      jobs_total: 45678,
      loaded_links: 3174,
      final_gap: 0.0091,
      total_trips: 231828.75,
    },
    validation: {
      screening_gate: {
        status_label: "bounded screening-ready",
      },
      metrics: {
        median_absolute_percent_error: 16.01,
        max_absolute_percent_error: 49.48,
      },
    },
    bundle_validation: {
      status_label: "bounded screening-ready",
    },
    activitysim_bundle: {
      status: "completed",
      output_dir: "/tmp/activitysim",
      manifest_path: "/tmp/activitysim/bundle_manifest.json",
      land_use_rows: 26,
      households: 41415,
      persons: 102322,
      skim_mode: "copy",
    },
    behavioral_prototype: {
      pipeline_status: "prototype_preflight_complete",
      runtime_status: "behavioral_runtime_blocked",
      runtime_mode: "preflight_only",
      runtime_posture: "containerized ActivitySim runtime configured via python:3.11-slim, but not executed",
      output_root: "/tmp/behavioral",
      prototype_manifest_path: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
      runtime_manifest_path: "/tmp/behavioral/runtime/activitysim_runtime_manifest.json",
      runtime_summary_path: "/tmp/behavioral/runtime/activitysim_runtime_summary.json",
      ingestion_summary_path: "/tmp/behavioral/ingestion/activitysim_ingestion_summary.json",
      kpi_summary_path: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_summary.json",
      kpi_packet_path: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_packet.md",
      caveats: ["ActivitySim CLI is not installed or not on PATH"],
    },
  },
} as const;

describe("county onramp primitives", () => {
  it("parses a validated-screening manifest fixture", () => {
    const parsed = countyOnrampManifestSchema.parse(validatedManifestFixture);

    expect(parsed.stage).toBe("validated-screening");
    expect(parsed.summary.run.zone_count).toBe(26);
    expect(parsed.summary.validation?.screening_gate?.status_label).toBe("bounded screening-ready");
  });

  it("validates county run creation payloads", () => {
    const parsed = createCountyRunRequestSchema.parse({
      workspaceId: "123e4567-e89b-12d3-a456-426614174000",
      geographyType: "county_fips",
      geographyId: "06061",
      geographyLabel: "Placer County, CA",
      runName: "placer-county-runtime-connectorbias2-20260324",
      runtimeOptions: {
        keepProject: true,
      },
    });

    expect(parsed.geographyId).toBe("06061");
    expect(parsed.runtimeOptions.keepProject).toBe(true);
  });

  it("requires a manifest for completed ingest requests and an error for failed ones", () => {
    const completed = ingestCountyRunManifestRequestSchema.safeParse({
      status: "completed",
      manifest: validatedManifestFixture,
    });
    const failed = ingestCountyRunManifestRequestSchema.safeParse({
      status: "failed",
      error: { message: "Worker crashed" },
    });
    const invalid = ingestCountyRunManifestRequestSchema.safeParse({
      status: "failed",
    });

    expect(completed.success).toBe(true);
    expect(failed.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it("derives UI card state from a validated county manifest", () => {
    const manifest = countyOnrampManifestSchema.parse(validatedManifestFixture);
    const card = buildCountyRunUiCard({
      geographyLabel: "Nevada County, CA",
      manifest,
      stage: manifest.stage,
    });

    expect(card).toMatchObject({
      title: "Nevada County, CA",
      stageLabel: "Validated Screening",
      tone: "success",
      statusLabel: "bounded screening-ready",
    });
    expect(card.allowedClaim).toContain("bounded screening-ready");
    expect(card.caveats).toContain("Screening-grade only");
    expect(card.nextAction).toContain("validation report");
  });

  it("sorts county list items by recency, stage, and validation metrics", () => {
    const items: CountyRunListItem[] = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        geographyLabel: "Nevada County, CA",
        runName: "nevada-run",
        stage: "validated-screening",
        behavioralPipelineStatus: "prototype_preflight_complete",
        behavioralRuntimeStatus: "behavioral_runtime_blocked",
        behavioralComparisonReady: false,
        runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
        updatedAt: "2026-03-24T23:00:00Z",
        finalGap: 0.0091,
        medianApe: 16.01,
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        geographyLabel: "Placer County, CA",
        runName: "placer-run",
        stage: "runtime-complete",
        behavioralPipelineStatus: "behavioral_runtime_succeeded",
        behavioralRuntimeStatus: "behavioral_runtime_succeeded",
        behavioralComparisonReady: true,
        runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
        updatedAt: "2026-03-24T23:10:00Z",
        finalGap: 0.0042,
        medianApe: 12.5,
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        geographyLabel: "Yuba County, CA",
        runName: "yuba-run",
        stage: "bootstrap-incomplete",
        behavioralPipelineStatus: null,
        behavioralRuntimeStatus: null,
        behavioralComparisonReady: false,
        runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
        updatedAt: "2026-03-24T22:00:00Z",
        finalGap: null,
        medianApe: null,
      },
    ];

    expect(sortCountyRunListItems(items, "updated-desc").map((item) => item.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect(sortCountyRunListItems(items, "stage-desc").map((item) => item.id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect(sortCountyRunListItems(items, "final-gap-asc").map((item) => item.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect(sortCountyRunListItems(items, "median-ape-asc").map((item) => item.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect(filterCountyRunListItemsByQuickView(items, "comparison-ready").map((item) => item.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
    expect(filterCountyRunListItemsByQuickView(items, "best-validated").map((item) => item.id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
    expect(filterCountyRunListItemsByQuickView(items, "prototype-blocked").map((item) => item.id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
    expect(filterCountyRunListItemsByQuickView(items, "needs-attention").map((item) => item.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect(buildCountyRunSummaryCounts(items)).toEqual({
      totalRuns: 3,
      needsAttention: 2,
      prototypeBlocked: 1,
      comparisonReady: 1,
      validatedScreening: 1,
    });
  });

  it("exposes metric highlights and basic stage helpers", () => {
    const manifest = countyOnrampManifestSchema.parse(validatedManifestFixture);
    const metrics = getCountyRunMetricHighlights(manifest);
    const activitysimBundle = buildCountyActivitySimBundleUiCard(manifest);
    const behavioral = buildCountyBehavioralPrototypeUiCard(manifest);

    expect(metrics).toEqual({
      zoneCount: 26,
      loadedLinks: 3174,
      totalTrips: 231828.75,
      finalGap: 0.0091,
      medianApe: 16.01,
      maxApe: 49.48,
    });
    expect(activitysimBundle.statusLabel).toBe("Bundle ready");
    expect(activitysimBundle.ready).toBe(true);
    expect(activitysimBundle.claim).toContain("scaffold availability only");
    expect(activitysimBundle.manifestPath).toBe("/tmp/activitysim/bundle_manifest.json");
    expect(activitysimBundle.skimModeLabel).toBe("Copied skims");
    expect(behavioral.pipelineStatus).toBe("prototype_preflight_complete");
    expect(behavioral.runtimeStatus).toBe("behavioral_runtime_blocked");
    expect(behavioral.runtimePosture).toBe(
      "containerized ActivitySim runtime configured via python:3.11-slim, but not executed"
    );
    expect(behavioral.evidenceStatusLabel).toBe("Preflight only");
    expect(behavioral.evidenceSupportLabel).toContain("preflight-depth prototype artifacts only");
    expect(behavioral.evidencePacketReady).toBe(true);
    expect(behavioral.comparisonReady).toBe(false);
    expect(behavioral.evidencePacketPath).toBe("/tmp/behavioral/behavioral_demand_prototype_manifest.json");
    expect(behavioral.runtimeSummaryPath).toBe("/tmp/behavioral/runtime/activitysim_runtime_summary.json");
    expect(behavioral.ingestionSummaryPath).toBe("/tmp/behavioral/ingestion/activitysim_ingestion_summary.json");
    expect(behavioral.comparisonSummaryPath).toBe("/tmp/behavioral/kpis/activitysim_behavioral_kpi_summary.json");
    expect(behavioral.comparisonPacketPath).toBe("/tmp/behavioral/kpis/activitysim_behavioral_kpi_packet.md");
    expect(behavioral.comparisonSupportLabel).toContain("only reached preflight depth");
    expect(behavioral.claim).toContain("preflight depth");
    expect(getCountyRunStatusLabel(manifest)).toBe("bounded screening-ready");
    expect(getCountyRunStageLabel("runtime-complete")).toBe("Runtime Complete");
    expect(getCountyRunStageTone("validation-scaffolded")).toBe("warning");
    expect(getCountyRunAllowedClaim("bootstrap-incomplete")).toContain("in progress");
    expect(getCountyRunCaveats("runtime-complete")).toContain("No local validation result yet.");
    expect(getCountyRunEnqueueStatusLabel("queued_stub")).toBe("Enqueue Prepared");
    expect(getCountyRunEnqueueStatusTone("failed")).toBe("danger");
    expect(getCountyRunEnqueueHelpText("not-enqueued")).toContain("not yet been prepared");
    expect(getCountyRunNextAction("validation-scaffolded")).toContain("rerun validation");
  });
});
