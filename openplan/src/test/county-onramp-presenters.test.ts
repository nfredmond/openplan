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
  },
} as const;

describe("county onramp presenters", () => {
  it("parses a valid manifest and rejects malformed shapes", () => {
    expect(parseCountyOnrampManifest(manifest)?.stage).toBe("validated-screening");
    expect(parseCountyOnrampManifest({ nope: true })).toBeNull();
  });

  it("presents county run list items", () => {
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
        updated_at: "2026-03-24T23:00:00Z",
      })
    ).toEqual({
      id: "123e4567-e89b-12d3-a456-426614174000",
      geographyLabel: "Nevada County, CA",
      runName: "nevada-run",
      stage: "validated-screening",
      statusLabel: "bounded screening-ready",
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
          },
        },
        manifest_json: manifest,
        validation_summary_json: { screening_gate: { status_label: "bounded screening-ready" } },
      },
      artifacts: [{ artifact_type: "validation_scaffold_csv", path: "/tmp/scaffold.csv" }],
      origin: "https://openplan.example.com",
    });

    expect(detail.geographyLabel).toBe("Nevada County, CA");
    expect(detail.manifest?.stage).toBe("validated-screening");
    expect(detail.workerPayload?.callback.manifestIngestUrl).toBe(
      "https://openplan.example.com/api/county-runs/123e4567-e89b-12d3-a456-426614174000/manifest"
    );
    expect(detail.artifacts).toEqual([{ artifactType: "validation_scaffold_csv", path: "/tmp/scaffold.csv" }]);
    expect(detail.validationSummary).toEqual({ screening_gate: { status_label: "bounded screening-ready" } });
  });
});
