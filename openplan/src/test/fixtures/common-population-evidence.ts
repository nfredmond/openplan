/** Supplied identity fixtures. These do not establish Census origin or model accuracy. */
import { createHash } from "node:crypto";
import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";

export const POPULATION_ATTEMPT_ID = "12121212-1212-4212-8212-121212121212";

export function populationFixture(sourceRunId = "run-aeq-base", custody: "managed_attempt" | "legacy_stage_snapshot" = "managed_attempt") {
  const sourceProfile = {
    adapter: "us_census_acs5_pums", acs_summary_endpoint: "https://api.census.gov/data/2023/acs/acs5",
    pums_endpoint: "https://api.census.gov/data/2023/acs/acs5/pums", sample_years: [2019, 2023],
    income_dollar_year: 2023, puma_fields: { "2020": "PUMA" },
  };
  const basis = {
    schema: "openplan.common-population-identity.v1",
    manifest: { path: "common_population.json", sha256: "a".repeat(64), bytes: 1234 },
    source_profile: sourceProfile, universe: "household_residents",
    exclusions: { group_quarters: "excluded_unassessed", full_population_coverage: "unassessed" },
    selected_zone_map: { path: "selected_zones.json", sha256: "b".repeat(64), bytes: 111 },
    realized_zone_counts: [{ zone_id: 7, households: 1, persons: 2, workers: 1 }, { zone_id: 9, households: 0, persons: 0, workers: 0 }],
    source_manifest: { path: "source_manifest.json", sha256: "c".repeat(64), bytes: 222 },
  };
  const payload = sortedCompactJson(basis);
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  const source = { modelRunId: sourceRunId, artifactId: "34343434-3434-4434-8434-343434343434",
    stageId: "56565656-5656-4565-8565-565656565656", attemptId: custody === "managed_attempt" ? POPULATION_ATTEMPT_ID : null,
    sha256: basis.manifest.sha256, sizeBytes: basis.manifest.bytes };
  return {
    basis, source, digest,
    sourceMetadata: { schema: "openplan.common-population.v1", custody, population_basis: basis, population_basis_payload_json: payload,
      population_basis_digest: digest, origin: null, scientific_acceptance: "unassessed" },
    metadata: { population_custody: custody, population_basis: basis, population_basis_payload_json: payload, population_basis_digest: digest },
    generate: { schema: "openplan.common-population-request.v1", custody, mode: "generate", comparisonPolicy: "fixed_population_auto_trip_change", sourceProfile },
    reuse: { schema: "openplan.common-population-request.v1", custody, mode: "reuse", comparisonPolicy: "fixed_population_auto_trip_change", source },
    snapshot: { schema: "openplan.common-population-comparison.v1", custody, comparisonPolicy: "fixed_population_auto_trip_change",
      sourceRunId, source, manifest: basis.manifest, populationBasis: basis, populationBasisDigest: digest },
  };
}
