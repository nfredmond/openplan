import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPopulationSourceRegistry, populationSourceRegistry, isRetainedPopulationSourceProfile,
  POPULATION_PROFILE_PURPOSES, type PopulationSourceRegistration } from "@/lib/geographies/population-source-registry";
import { resolveZoneAttributeSource, ZONE_ATTRIBUTE_SOURCES } from "@/lib/geographies/zone-attribute-source";
import { verifiedGuidedPopulation } from "@/lib/models/guided-model-evidence";
import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";
import { populationFixture } from "@/test/fixtures/common-population-evidence";

const catalog = JSON.parse(readFileSync("../scripts/modeling/population_source_profiles.v1.json", "utf8")) as {
  schema: string; profiles: PopulationSourceRegistration[];
};
const canonical2023 = {
  adapter: "us_census_acs5_pums", acs_summary_endpoint: "https://api.census.gov/data/2023/acs/acs5",
  pums_endpoint: "https://api.census.gov/data/2023/acs/acs5/pums", sample_years: [2019, 2023],
  income_dollar_year: 2023, puma_fields: { "2020": "PUMA" },
};
const canonical2022 = {
  adapter: "us_census_acs5_pums", acs_summary_endpoint: "https://api.census.gov/data/2022/acs/acs5",
  pums_endpoint: "https://api.census.gov/data/2022/acs/acs5/pums", sample_years: [2018, 2022],
  income_dollar_year: 2022, puma_fields: { "2020": "PUMA20", "2010": "PUMA10" },
};
const badProfiles: unknown[] = [
  undefined, null, [], "profile", {}, { ...canonical2023, adapter: "unknown" },
  { ...canonical2023, income_dollar_year: 2024 }, { ...canonical2023, income_dollar_year: "2023" },
  { ...canonical2023, pums_endpoint: canonical2022.pums_endpoint },
  { ...canonical2023, sample_years: [2018, 2023] }, { ...canonical2023, puma_fields: canonical2022.puma_fields },
  { ...canonical2023, extra: true }, { ...canonical2023, puma_fields: { "2020": "PUMA", extra: "PUMA" } },
  { ...canonical2023, acs_summary_endpoint: canonical2023.acs_summary_endpoint + "/" },
  { ...canonical2023, pums_endpoint: canonical2023.pums_endpoint + "/" },
];

describe("registered technical population profiles, without scientific acceptance", () => {
  it("keeps exactly the two canonical retained identities and the actual one-adapter selection", () => {
    expect(catalog.schema).toBe("openplan.population-source-profiles.v1");
    expect(catalog.profiles.map((entry) => entry.profile)).toEqual([canonical2022, canonical2023]);
    expect(ZONE_ATTRIBUTE_SOURCES).toHaveLength(1);
    expect(resolveZoneAttributeSource()).toBe(ZONE_ATTRIBUTE_SOURCES[0]);
    expect(resolveZoneAttributeSource().retainedPopulation?.profile("new_guided_launch"))
      .toEqual({ status: "supported", profile: canonical2023 });
    for (const entry of catalog.profiles) for (const purpose of POPULATION_PROFILE_PURPOSES) {
      expect(populationSourceRegistry.profileAllowed(entry.profile, purpose))
        .toBe(entry.capabilities?.[purpose] === "supported");
    }
    expect(populationSourceRegistry.forDescriptor(catalog.profiles[0].descriptor, "new_guided_launch").status).toBe("unsupported");
    expect(populationSourceRegistry.forDescriptor(catalog.profiles[0].descriptor, "retained_validation"))
      .toEqual({ status: "supported", profile: canonical2022 });
  });

  it.each(badProfiles)("refuses malformed, legacy and unregistered canonical profiles %j", (profile) => {
    const before = structuredClone(profile);
    expect(isRetainedPopulationSourceProfile(profile)).toBe(false);
    expect(profile).toEqual(before);
  });

  it("does not default missing capabilities or enroll descriptor copies", () => {
    const entry = structuredClone(catalog.profiles[1]);
    const registry = createPopulationSourceRegistry([{ ...entry, capabilities: {} }]);
    for (const purpose of POPULATION_PROFILE_PURPOSES) {
      expect(registry.forDescriptor(entry.descriptor, purpose).status).toBe("unassessed");
      expect(registry.profileAllowed(entry.profile, purpose)).toBe(false);
    }
    for (const field of ["id", "vintage", "retrievalUrl"] as const) {
      expect(populationSourceRegistry.forDescriptor({ ...entry.descriptor, [field]: "unregistered" }, "new_guided_launch").status).toBe("unsupported");
    }
    const withoutCapabilities = { ...entry }; delete withoutCapabilities.capabilities;
    expect(createPopulationSourceRegistry([withoutCapabilities]).forDescriptor(entry.descriptor, "new_guided_launch").status).toBe("unassessed");
    expect(createPopulationSourceRegistry([{ ...entry, capabilities: { new_guided_launch: "unknown" } }])
      .forDescriptor(entry.descriptor, "new_guided_launch").status).toBe("unassessed");
    entry.descriptor.id = "mutated after registry construction";
    expect(registry.forDescriptor(catalog.profiles[1].descriptor, "new_guided_launch").status).toBe("unassessed");
    const result = populationSourceRegistry.forDescriptor(catalog.profiles[1].descriptor, "new_guided_launch");
    if (result.status !== "supported") throw new Error("Expected supported fixture");
    result.profile.extra = true;
    expect(populationSourceRegistry.forDescriptor(catalog.profiles[1].descriptor, "new_guided_launch"))
      .toEqual({ status: "supported", profile: canonical2023 });
  });

  it.each([canonical2022, canonical2023, ...badProfiles.filter((value) => value !== undefined)])("uses the same registry in the actual evidence reader without stripping %j", (profile) => {
    const f = populationFixture();
    const basis = { ...f.metadata.population_basis, source_profile: profile };
    const payload = sortedCompactJson(basis);
    const metadata = { ...f.metadata, population_basis: basis, population_basis_payload_json: payload,
      population_basis_digest: createHash("sha256").update(payload).digest("hex") };
    const before = structuredClone(metadata);
    const evidence = verifiedGuidedPopulation(metadata);
    const expected = [canonical2022, canonical2023].some((known) => sortedCompactJson(known) === sortedCompactJson(profile));
    expect(evidence.state).toBe(expected ? "verified" : "invalid");
    if (evidence.state === "verified") {
      expect(evidence.basis.source_profile).toBe(profile);
      expect(evidence.payloadJson).toBe(payload);
    }
    expect(metadata).toEqual(before);
  });
});
