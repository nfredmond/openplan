import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { countyRunCustodyError } from "@/lib/models/county-run-custody";

const manifest = {
  schema_version: "openplan.county_onramp_manifest.v1", generated_at: "2026-10-23T00:00:00Z",
  name: "synthetic", county_fips: null, county_prefix: "SYNTHETIC", run_dir: "/synthetic", mode: "existing-run", stage: "runtime-complete",
  artifacts: { scaffold_csv: "", review_packet_md: "", run_summary_json: null, bundle_manifest_json: null, validation_summary_json: null },
  runtime: { keep_project: false, force: false, overall_demand_scalar: null, external_demand_scalar: null, hbw_scalar: null, hbo_scalar: null, nhb_scalar: null },
  summary: { run: { zone_count: null, population_total: null, jobs_total: null, loaded_links: null, final_gap: null, total_trips: null }, validation: null, bundle_validation: null },
};

describe("county retained metadata custody", () => {
  it.each([null, undefined, {}])("accepts the writer's absent manifest state %s without inventing evidence", manifest_json => {
    expect(countyRunCustodyError({ manifest_json, validation_summary_json: {} })).toBeNull();
  });
  it("accepts a manifest with no validation and the writer's empty summary", () => {
    expect(countyRunCustodyError({ manifest_json: manifest, validation_summary_json: {} })).toBeNull();
  });
  it("keeps loaded, unloaded, unmatched and unsupported accounting unchanged, including genuine zero", () => {
    const validation = { coverage: { loaded: 7, unloaded: 0, unmatched: 3, unsupported: 2 }, observation_ids: ["loaded", "unloaded", "unmatched", "unsupported"] };
    const row = { manifest_json: { ...manifest, summary: { ...manifest.summary, validation } }, validation_summary_json: structuredClone(validation) };
    const before = structuredClone(row);
    expect(countyRunCustodyError(row)).toBeNull();
    expect(row).toEqual(before);
    for (const key of Object.keys(validation.coverage)) {
      const changed = structuredClone(row);
      delete (changed.validation_summary_json.coverage as Record<string, number>)[key];
      expect(countyRunCustodyError(changed)).toContain("summaries disagree");
    }
  });
  it.each([[], "broken", { schema_version: "unknown" }])("rejects a malformed nonempty manifest %s", manifest_json => {
    expect(countyRunCustodyError({ manifest_json })).toContain("manifest metadata is malformed");
  });
  it.each([[], "broken", { metrics: { median_absolute_percent_error: "zero" } }])("rejects malformed validation metadata %s", validation_summary_json => {
    expect(countyRunCustodyError({ manifest_json: {}, validation_summary_json })).toContain("validation metadata is malformed");
  });
});
