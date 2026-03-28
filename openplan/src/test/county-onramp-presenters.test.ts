import { describe, expect, it } from "vitest";
import {
  parseCountyOnrampManifest,
  presentCountyRunArtifact,
  presentCountyRunDetail,
  presentCountyRunListItem,
} from "@/lib/api/county-onramp-presenters";

const manifest = {
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
    behavioral_prototype_manifest_json: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
  },
  runtime: {
    keep_project: true,
    force: false,
    overall_demand_scalar: 0.369,
    external_demand_scalar: null,
    hbw_scalar: null,
    hbo_scalar: null,
    nhb_scalar: null,
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
    behavioral_prototype: {
      pipeline_status: "prototype_preflight_complete",
      runtime_status: "behavioral_runtime_blocked",
      runtime_mode: "preflight_only",
      prototype_manifest_path: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
      caveats: ["ActivitySim CLI is not installed or not on PATH"],
    },
  },
} as const;

describe("county onramp presenters", () => {
  it("parses a valid manifest and rejects malformed shapes", () => {
    expect(parseCountyOnrampManifest(manifest)?.stage).toBe("validated-screening");
    expect(parseCountyOnrampManifest({ nope: true })).toBeNull();
  });

  it("presents county run list items from recorded behavioral manifest state", () => {
    expect(
      presentCountyRunListItem({
        id: "123e4567-e89b-12d3-a456-426614174000",
        workspace_id: "123e4567-e89b-12d3-a456-426614174001",
        geography_type: "county_fips",
        geography_id: "06057",
        geography_label: "Nevada County, CA",
        run_name: "nevada-run",
        stage: "validated-screening",
        status_label: "bounded screening-ready",
        enqueue_status: "not-enqueued",
        last_enqueued_at: null,
        requested_runtime_json: {
          workspaceId: "123e4567-e89b-12d3-a456-426614174001",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-run",
          countyPrefix: "NEVADA",
          runtimeOptions: {
            keepProject: true,
            force: true,
            overallDemandScalar: null,
            externalDemandScalar: null,
            hbwScalar: null,
            hboScalar: null,
            nhbScalar: null,
            activitysimContainerImage: "python:3.11-slim",
            containerEngineCli: "docker",
            activitysimContainerCliTemplate:
              "bash -lc 'python -m pip install --no-cache-dir activitysim==1.5.1 && python -m activitysim.cli.run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}'",
            containerNetworkMode: "bridge",
          },
        },
        manifest_json: manifest,
        updated_at: "2026-03-24T23:00:00Z",
      })
    ).toEqual({
      id: "123e4567-e89b-12d3-a456-426614174000",
      geographyLabel: "Nevada County, CA",
      runName: "nevada-run",
      stage: "validated-screening",
      statusLabel: "bounded screening-ready",
      enqueueStatus: "not-enqueued",
      lastEnqueuedAt: null,
      runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
      behavioralPipelineStatus: "prototype_preflight_complete",
      behavioralRuntimeStatus: "behavioral_runtime_blocked",
      behavioralEvidenceReady: true,
      behavioralComparisonReady: false,
      behavioralEvidenceStatusLabel: "Preflight-only behavioral evidence",
      behavioralComparisonStatusLabel: "Comparison blocked: preflight only",
      updatedAt: "2026-03-24T23:00:00Z",
    });
  });

  it("presents artifacts and county run details", () => {
    const artifact = presentCountyRunArtifact({
      artifact_type: "validation_scaffold_csv",
      path: "/tmp/scaffold.csv",
    });
    expect(artifact).toEqual({
      artifactType: "validation_scaffold_csv",
      path: "/tmp/scaffold.csv",
    });

    const detail = presentCountyRunDetail({
      row: {
        id: "123e4567-e89b-12d3-a456-426614174000",
        workspace_id: "123e4567-e89b-12d3-a456-426614174001",
        geography_type: "county_fips",
        geography_id: "06057",
        geography_label: "Nevada County, CA",
        run_name: "nevada-run",
        stage: "validated-screening",
        status_label: "bounded screening-ready",
        enqueue_status: "queued_stub",
        last_enqueued_at: "2026-03-24T23:05:00Z",
        requested_runtime_json: {
          workspaceId: "123e4567-e89b-12d3-a456-426614174001",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-run",
          countyPrefix: "NEVADA",
          runtimeOptions: {
            keepProject: true,
            force: true,
            overallDemandScalar: 0.369,
            externalDemandScalar: null,
            hbwScalar: null,
            hboScalar: null,
            nhbScalar: null,
            activitysimContainerImage: "python:3.11-slim",
            containerEngineCli: "docker",
            activitysimContainerCliTemplate:
              "bash -lc 'python -m pip install --no-cache-dir activitysim==1.5.1 && python -m activitysim.cli.run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}'",
            containerNetworkMode: "bridge",
          },
        },
        manifest_json: manifest,
        validation_summary_json: { screening_gate: { status_label: "bounded screening-ready" } },
      },
      artifacts: [{ artifact_type: "validation_scaffold_csv", path: "/tmp/scaffold.csv" }],
      origin: "https://openplan.example.com",
    });

    expect(detail.geographyLabel).toBe("Nevada County, CA");
    expect(detail.enqueueStatus).toBe("queued_stub");
    expect(detail.lastEnqueuedAt).toBe("2026-03-24T23:05:00Z");
    expect(detail.runtimePresetLabel).toBe("Containerized behavioral smoke runtime (prototype)");
    expect(detail.manifest?.stage).toBe("validated-screening");
    expect(detail.workerPayload?.callback.manifestIngestUrl).toBe(
      "https://openplan.example.com/api/county-runs/123e4567-e89b-12d3-a456-426614174000/manifest"
    );
    expect(detail.artifacts).toEqual([{ artifactType: "validation_scaffold_csv", path: "/tmp/scaffold.csv" }]);
    expect(detail.validationSummary).toEqual({ screening_gate: { status_label: "bounded screening-ready" } });
  });
});
