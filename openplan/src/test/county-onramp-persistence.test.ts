import { describe, expect, it } from "vitest";
import { countyOnrampManifestSchema } from "@/lib/models/county-onramp";
import {
  buildCountyRunArtifacts,
  buildCountyRunRecord,
  deriveCountyRunStatusLabel,
} from "@/lib/api/county-onramp-persistence";

const manifest = countyOnrampManifestSchema.parse({
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
});

describe("county onramp persistence helpers", () => {
  it("derives a county run record from a manifest", () => {
    const record = buildCountyRunRecord({
      workspaceId: "123e4567-e89b-12d3-a456-426614174000",
      geographyId: "06057",
      geographyLabel: "Nevada County, CA",
      manifest,
    });

    expect(record).toMatchObject({
      workspace_id: "123e4567-e89b-12d3-a456-426614174000",
      geography_type: "county_fips",
      geography_id: "06057",
      geography_label: "Nevada County, CA",
      run_name: manifest.name,
      stage: "validated-screening",
      status_label: "bounded screening-ready",
      mode: "existing-run",
    });
    expect(record.run_summary_json).toMatchObject({ zone_count: 26, loaded_links: 3174 });
    expect(record.validation_summary_json).toMatchObject({
      screening_gate: { status_label: "bounded screening-ready" },
    });
  });

  it("derives county artifact rows from a manifest", () => {
    const artifacts = buildCountyRunArtifacts({
      workspaceId: "123e4567-e89b-12d3-a456-426614174000",
      manifest,
    });

    expect(artifacts).toHaveLength(5);
    expect(artifacts[0]).toMatchObject({
      workspace_id: "123e4567-e89b-12d3-a456-426614174000",
      artifact_type: "validation_scaffold_csv",
      path: "/tmp/scaffold.csv",
      mime_type: "text/csv",
    });
    expect(artifacts.map((artifact) => artifact.artifact_type)).toEqual([
      "validation_scaffold_csv",
      "validation_review_packet_md",
      "run_summary_json",
      "bundle_manifest_json",
      "validation_summary_json",
    ]);
  });

  it("derives a nullable status label when validation is absent", () => {
    expect(deriveCountyRunStatusLabel(manifest)).toBe("bounded screening-ready");

    const runtimeOnly = countyOnrampManifestSchema.parse({
      ...manifest,
      stage: "runtime-complete",
      summary: {
        ...manifest.summary,
        validation: null,
      },
    });

    expect(deriveCountyRunStatusLabel(runtimeOnly)).toBeNull();
  });
});
