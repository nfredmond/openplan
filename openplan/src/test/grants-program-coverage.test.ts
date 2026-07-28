import { describe, expect, it } from "vitest";
import {
  GRANT_PROGRAM_BUNDLES,
  GRANT_PROGRAM_CATALOG,
  describeGrantProgramCoverage,
  listGrantProgramsWithBundle,
  type GrantProgramBundle,
} from "@/lib/grants/programs";

// The defect this suite guards: the catalog flattens every registered bundle
// into one list, so an agency outside California was shown California's state
// programs with nothing to say they were not its own. Federal coverage is
// genuinely national; a state bundle is not, and the difference has to be on the
// surface. Nothing may be hidden — a consultant legitimately works across
// states — so the fix is labeling, and labeling has to be registry-driven.

const OHIO_BUNDLE: GrantProgramBundle = {
  key: "us-oh-test",
  label: "Ohio state programs",
  jurisdiction: { country: "US", subdivision: "OH", label: "Ohio" },
  programs: [
    {
      key: "oh-test-program",
      name: "Ohio Test Program",
      administeringAgency: "Ohio Test Agency",
      level: "state",
      typicalApplicants: "Cities, counties",
      eligibleProjectTypes: ["Test"],
      cycleNote: "Verify the current call with the administering agency.",
      matchRequirement: "Verify current guidelines.",
      url: "https://example.gov/test",
      summary: "A registration fixture, not a real program.",
    },
  ],
};

describe("describeGrantProgramCoverage", () => {
  it("marks a state bundle as this workspace's when the jurisdiction matches", () => {
    const coverage = describeGrantProgramCoverage({ country: "US", subdivision: "CA" });

    const california = coverage.bundles.find((bundle) => bundle.key === "us-ca");
    const federal = coverage.bundles.find((bundle) => bundle.key === "us");

    expect(california?.scope).toBe("jurisdiction_match");
    expect(california?.coversWorkspace).toBe(true);
    // The jurisdiction is still stated — the absence of a caveat must never be
    // mistaken for the absence of a limit.
    expect(california?.scopeLabel).toBe("California");
    expect(federal?.scope).toBe("nationwide_match");
    expect(coverage.disclosure).toBeNull();
    expect(coverage.coveredProgramCount).toBe(GRANT_PROGRAM_CATALOG.length);
  });

  it("marks a state bundle as another jurisdiction's, and says no bundle is registered for this one", () => {
    const coverage = describeGrantProgramCoverage({ country: "US", subdivision: "OH" });

    const california = coverage.bundles.find((bundle) => bundle.key === "us-ca");
    const federal = coverage.bundles.find((bundle) => bundle.key === "us");

    expect(california?.scope).toBe("other_jurisdiction");
    expect(california?.coversWorkspace).toBe(false);
    expect(california?.scopeLabel).toBe("California — not this workspace's jurisdiction");
    // Federal programs really are national; the disclosure must not smear them.
    expect(federal?.scope).toBe("nationwide_match");

    expect(coverage.disclosure?.reason).toBe("no_bundle_for_jurisdiction");
    expect(coverage.disclosure?.headline).toBe(
      "No grant program bundle is registered for US-OH"
    );
    expect(coverage.disclosure?.detail).toContain("California state programs");
    expect(coverage.disclosure?.detail).toContain("not this workspace's funding menu");
    expect(coverage.disclosure?.detail).toContain("US federal programs do apply here");
    expect(coverage.disclosure?.action).toContain("US-OH");
  });

  it("hides nothing from a workspace the state bundle does not cover", () => {
    const coverage = describeGrantProgramCoverage({ country: "US", subdivision: "OH" });

    expect(coverage.programs).toHaveLength(GRANT_PROGRAM_CATALOG.length);
    expect(coverage.programs.map((entry) => entry.program.key)).toEqual(
      GRANT_PROGRAM_CATALOG.map((program) => program.key)
    );
    expect(coverage.coveredProgramCount).toBeLessThan(GRANT_PROGRAM_CATALOG.length);
  });

  it("discloses an unset geography instead of guessing one", () => {
    const coverage = describeGrantProgramCoverage(null);

    expect(coverage.workspaceJurisdictionLabel).toBeNull();
    for (const bundle of coverage.bundles) {
      expect(bundle.scope).toBe("unknown_jurisdiction");
      expect(bundle.coversWorkspace).toBe(false);
      expect(bundle.scopeLabel).toContain("coverage unconfirmed");
    }
    // Unknowable, not zero: a count here would read as a finding.
    expect(coverage.coveredProgramCount).toBeNull();
    expect(coverage.disclosure?.reason).toBe("no_workspace_jurisdiction");
    expect(coverage.disclosure?.headline).toContain("has not said where it works");
    expect(coverage.disclosure?.action).toContain("home geography");
    expect(coverage.programs).toHaveLength(GRANT_PROGRAM_CATALOG.length);
  });

  it("treats a country-only geography as unable to judge subdivision-scoped bundles", () => {
    // A multi-state metro, or a source that cannot say which subdivision.
    const coverage = describeGrantProgramCoverage({ country: "US", subdivision: null });

    expect(coverage.bundles.find((bundle) => bundle.key === "us-ca")?.scope).toBe(
      "unknown_jurisdiction"
    );
    expect(coverage.bundles.find((bundle) => bundle.key === "us")?.scope).toBe("nationwide_match");
    expect(coverage.disclosure?.reason).toBe("no_workspace_subdivision");
    expect(coverage.disclosure?.detail).toContain("California state programs");
    expect(coverage.disclosure?.detail).toContain("US federal programs apply throughout US");
  });

  it("treats a bundle from another country as another jurisdiction's", () => {
    const coverage = describeGrantProgramCoverage({ country: "CA", subdivision: "ON" });

    for (const bundle of coverage.bundles) {
      expect(bundle.scope).toBe("other_jurisdiction");
    }
    expect(coverage.disclosure?.reason).toBe("no_bundle_for_jurisdiction");
    expect(coverage.disclosure?.detail).toContain("CA-ON");
  });

  it("normalizes case and whitespace in the workspace's codes", () => {
    const coverage = describeGrantProgramCoverage({ country: " us ", subdivision: "ca" });

    expect(coverage.workspaceJurisdictionLabel).toBe("US-CA");
    expect(coverage.bundles.find((bundle) => bundle.key === "us-ca")?.scope).toBe(
      "jurisdiction_match"
    );
  });

  it("labels a newly registered bundle correctly with no call-site change", () => {
    // The registry-driven guarantee: adding `us-oh.ts` must require editing only
    // the registration list, never this resolver or any consumer.
    const bundles = [...GRANT_PROGRAM_BUNDLES, OHIO_BUNDLE];
    const ohio = describeGrantProgramCoverage({ country: "US", subdivision: "OH" }, bundles);
    const california = describeGrantProgramCoverage({ country: "US", subdivision: "CA" }, bundles);

    expect(ohio.bundles.find((bundle) => bundle.key === "us-oh-test")?.scope).toBe(
      "jurisdiction_match"
    );
    expect(ohio.disclosure).toBeNull();
    expect(ohio.programs).toHaveLength(GRANT_PROGRAM_CATALOG.length + 1);

    expect(california.bundles.find((bundle) => bundle.key === "us-oh-test")?.scopeLabel).toBe(
      "Ohio — not this workspace's jurisdiction"
    );
    // California is covered, so the catalog owes it no gap disclosure even
    // though it can now see another state's programs — they are labeled.
    expect(california.disclosure).toBeNull();
  });

  it("keeps every program attached to the bundle that registered it", () => {
    const withBundle = listGrantProgramsWithBundle();

    expect(withBundle).toHaveLength(GRANT_PROGRAM_CATALOG.length);
    for (const { program, bundle } of withBundle) {
      expect(bundle.programs).toContain(program);
    }
  });
});
