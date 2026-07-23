import { describe, expect, it } from "vitest";

import { buildCountyRunModelingEvidenceBundle } from "@/lib/models/evidence-backbone";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";

/**
 * The observed-count source manifest is a citation: it must name the agency that
 * actually published the counts. These cases pin the two ways that used to go
 * wrong — a counts file whose path merely mentions an agency, and counts from a
 * state DOT other than the one the code was written around.
 */
function manifestWith(validation: Record<string, unknown>): CountyOnrampManifest {
  return {
    schema_version: "openplan.county_onramp_manifest.v1",
    generated_at: "2026-07-23T00:00:00Z",
    name: "county-runtime",
    county_fips: "53061",
    county_prefix: "SNOHOMISH",
    run_dir: "/tmp/run",
    mode: "existing-run",
    stage: "validated-screening",
    artifacts: {
      scaffold_csv: "/tmp/scaffold.csv",
      review_packet_md: "/tmp/review.md",
      run_summary_json: null,
      bundle_manifest_json: null,
      validation_summary_json: null,
    },
    runtime: {
      keep_project: true,
      force: false,
      overall_demand_scalar: null,
      external_demand_scalar: null,
      hbw_scalar: null,
      hbo_scalar: null,
      nhb_scalar: null,
    },
    summary: {
      run: {
        zone_count: 20,
        population_total: 1000,
        jobs_total: 500,
        loaded_links: 100,
        final_gap: 0.009,
        total_trips: 1000,
      },
      validation,
      bundle_validation: null,
    },
  } as unknown as CountyOnrampManifest;
}

function countsManifest(validation: Record<string, unknown>) {
  const bundle = buildCountyRunModelingEvidenceBundle({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    geographyLabel: "Snohomish County, WA",
    manifest: manifestWith(validation),
  });
  const source = bundle.sourceManifests.find((entry) => entry.sourceKey === "observed_count_validation");
  if (!source) throw new Error("expected an observed_count_validation source manifest");
  return source;
}

describe("observed-count source provenance", () => {
  it("cites the agency the counts declare, not one inferred from the file path", () => {
    const source = countsManifest({
      counts_source_csv: "/runs/snohomish/auto_aadt_counts.csv",
      count_source_agencies: ["WSDOT"],
      stations_total: 12,
      stations_matched: 9,
    });

    expect(source.sourceLabel).toContain("WSDOT");
    expect(source.citationText).toContain("published by WSDOT");
    expect((source.metadata as { sourceAgencies: string[] }).sourceAgencies).toEqual(["WSDOT"]);
    expect(JSON.stringify(source).toLowerCase()).not.toContain("caltrans");
  });

  it("never stamps a per-agency source kind on a count set", () => {
    const wsdot = countsManifest({
      counts_source_csv: "/runs/snohomish/counts.csv",
      count_source_agencies: ["WSDOT"],
    });
    // A path that happens to name an agency is not evidence of provenance.
    const misleadingPath = countsManifest({
      counts_source_csv: "/runs/snohomish/not_caltrans_wsdot_counts.csv",
      count_source_agencies: ["WSDOT"],
    });

    expect(wsdot.sourceKind).toBe("local_public_counts");
    expect(misleadingPath.sourceKind).toBe("local_public_counts");
    expect(misleadingPath.citationText).toContain("published by WSDOT");
  });

  it("says the agency is unrecorded rather than implying one", () => {
    const source = countsManifest({
      counts_source_csv: "/data/pilot/caltrans_2023_priority_counts.csv",
      stations_total: 5,
      stations_matched: 5,
    });

    expect(source.sourceLabel).toBe("Observed traffic count validation set");
    expect(source.citationText).toContain("Publishing agency not recorded");
    expect((source.metadata as { sourceAgencies: string[] }).sourceAgencies).toEqual([]);
  });

  it("cites every agency in a mixed count set", () => {
    const source = countsManifest({
      counts_source_csv: "/runs/snohomish/counts.csv",
      count_source_agencies: ["Snohomish County", "WSDOT"],
    });

    expect(source.citationText).toContain("published by Snohomish County, WSDOT");
  });
});
