import { describe, expect, it } from "vitest";
import {
  GRANT_PROGRAM_BUNDLES,
  GRANT_PROGRAM_CATALOG,
} from "@/lib/grants/programs";
import {
  GRANT_PROGRAM_BUNDLES as BUNDLES_VIA_COMPAT_PATH,
  GRANT_PROGRAM_CATALOG as CATALOG_VIA_COMPAT_PATH,
} from "@/lib/grants/program-catalog";

// The registry keys each jurisdiction bundle by where its programs live:
// "us" carries federal-level entries and "us-ca" carries California
// state-level entries. Any bundle key missing from this map, or any entry
// filed under a bundle that does not match its level, fails below.
const EXPECTED_LEVEL_BY_BUNDLE_KEY: Record<string, string> = {
  us: "federal",
  "us-ca": "state",
};

describe("grant program jurisdiction registry", () => {
  it("has at least one registered bundle", () => {
    expect(GRANT_PROGRAM_BUNDLES.length).toBeGreaterThanOrEqual(1);
  });

  it("has unique, labeled bundle keys", () => {
    const keys = GRANT_PROGRAM_BUNDLES.map((bundle) => bundle.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const bundle of GRANT_PROGRAM_BUNDLES) {
      expect(bundle.key.trim().length).toBeGreaterThan(0);
      expect(bundle.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("makes every bundle declare where its programs are open", () => {
    // The coverage resolver asks each bundle where it applies rather than
    // knowing a list of places. A bundle registered without a jurisdiction — or
    // one that omits `subdivision` when it is not genuinely nationwide — would
    // be presented to every workspace in the country as if it were theirs.
    for (const bundle of GRANT_PROGRAM_BUNDLES) {
      expect(bundle.jurisdiction, `jurisdiction for bundle "${bundle.key}"`).toBeDefined();
      expect(bundle.jurisdiction.country, `country for bundle "${bundle.key}"`).toMatch(/^[A-Z]{2}$/);
      expect(bundle.jurisdiction.label.trim().length, `label for bundle "${bundle.key}"`).toBeGreaterThan(0);
      if (bundle.jurisdiction.subdivision !== undefined) {
        expect(
          bundle.jurisdiction.subdivision.trim().length,
          `subdivision for bundle "${bundle.key}"`
        ).toBeGreaterThan(0);
      }
      // A bundle of state-level programs cannot be nationwide, and a nationwide
      // bundle cannot carry state-level ones.
      const isNationwide = bundle.jurisdiction.subdivision === undefined;
      for (const program of bundle.programs) {
        expect(
          program.level === "federal",
          `program "${program.key}" level vs bundle "${bundle.key}" scope`
        ).toBe(isNationwide);
      }
    }
  });

  it("has unique program keys across ALL bundles", () => {
    const keys = GRANT_PROGRAM_BUNDLES.flatMap((bundle) =>
      bundle.programs.map((program) => program.key)
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes GRANT_PROGRAM_CATALOG as exactly the flattened bundles", () => {
    expect(GRANT_PROGRAM_CATALOG).toEqual(
      GRANT_PROGRAM_BUNDLES.flatMap((bundle) => bundle.programs)
    );
  });

  it("files every entry in the bundle matching its level — a misfiled entry fails", () => {
    for (const bundle of GRANT_PROGRAM_BUNDLES) {
      const expectedLevel = EXPECTED_LEVEL_BY_BUNDLE_KEY[bundle.key];
      expect(
        expectedLevel,
        `bundle "${bundle.key}" has no expected-level mapping in this test`
      ).toBeDefined();
      for (const program of bundle.programs) {
        expect(
          program.level,
          `program "${program.key}" is misfiled in bundle "${bundle.key}"`
        ).toBe(expectedLevel);
      }
    }
  });

  it("keeps the federal and California bundles registered and populated", () => {
    const federal = GRANT_PROGRAM_BUNDLES.find((bundle) => bundle.key === "us");
    const california = GRANT_PROGRAM_BUNDLES.find((bundle) => bundle.key === "us-ca");
    expect(federal?.programs.length).toBeGreaterThan(0);
    expect(california?.programs.length).toBeGreaterThan(0);
  });

  it("re-exports the same registry through @/lib/grants/program-catalog", () => {
    expect(CATALOG_VIA_COMPAT_PATH).toBe(GRANT_PROGRAM_CATALOG);
    expect(BUNDLES_VIA_COMPAT_PATH).toBe(GRANT_PROGRAM_BUNDLES);
  });
});
