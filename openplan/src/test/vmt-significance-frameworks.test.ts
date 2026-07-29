import { describe, expect, it } from "vitest";

import {
  BUILT_IN_VMT_SIGNIFICANCE_FRAMEWORKS,
  createVmtSignificanceFrameworkRegistry,
  describeJurisdiction,
  vmtSignificanceFrameworkRegistry,
  type VmtSignificanceFrameworkDescriptor,
} from "@/lib/planner-pack/vmt-significance-frameworks";
import { US_CA_CEQA_15064_3_FRAMEWORK } from "@/lib/planner-pack/frameworks/us-ca-ceqa-15064-3";
import {
  buildVmtSignificanceScreeningRow,
  claimStatusLabel,
  claimTierEvidence,
  determinationToken,
  parseVmtSignificanceScreeningRow,
  summarizeVmtDetermination,
} from "@/lib/planner-pack/vmt-screening-records";
import { computeCeqaVmt } from "@/lib/planner-pack/ceqa";

function descriptor(
  overrides: Partial<VmtSignificanceFrameworkDescriptor> = {}
): VmtSignificanceFrameworkDescriptor {
  return {
    frameworkId: "xx_test_framework_v1",
    frameworkName: "Test VMT significance framework",
    version: "1.0.0",
    jurisdiction: { country: "XX", subdivision: "YY", label: "Testland" },
    scopeStatement: "Applies to projects reviewed under the Testland statute.",
    statutoryCitation: "Testland Code §1.",
    screeningCaveat: "Screening-level only.",
    defaultThresholdPct: 0.15,
    defaultThresholdRationale: "Testland guidance.",
    defaultReferenceVmtPerCapita: 20,
    defaultReferenceRationale: "Testland average.",
    ...overrides,
  };
}

describe("a jurisdiction with no registered framework is told so, not given someone else's law", () => {
  const registry = createVmtSignificanceFrameworkRegistry([descriptor()]);

  it("refuses an uncovered jurisdiction and names the place and the coverage", () => {
    const resolution = registry.resolve({ country: "US", subdivision: "OH", label: "Franklin County" });

    expect(resolution.kind).toBe("not_covered");
    if (resolution.kind !== "not_covered") return;
    expect(resolution.reason).toContain("Franklin County");
    expect(resolution.reason).toContain("US-OH");
    expect(resolution.reason).toContain("Testland");
    expect(resolution.reason).toMatch(/will not issue a significance determination/i);
  });

  it("never substitutes an interim default, unlike the reimbursement-profile registry", () => {
    // The load-bearing divergence. An unresolved reimbursement profile can fall
    // back to a labeled default; an unresolved SIGNIFICANCE framework cannot,
    // because the fallback would be a false statement about the law.
    const resolution = registry.resolve({ country: "US", subdivision: "OH" });
    expect(resolution).not.toHaveProperty("framework");
    expect(Object.keys(registry)).not.toContain("defaultProfileId");
  });

  it("treats an unstated jurisdiction as its own answer, not as uncovered", () => {
    const resolution = registry.resolve(null);

    expect(resolution.kind).toBe("jurisdiction_unknown");
    if (resolution.kind !== "jurisdiction_unknown") return;
    expect(resolution.reason).toMatch(/has not stated where it works/i);
    expect(resolution.reason).toMatch(/home geography/i);
  });

  it("will not pick a subdivision-scoped framework for a workspace whose subdivision is unknown", () => {
    const resolution = registry.resolve({ country: "XX", subdivision: null });

    // The framework covers XX-YY only. A workspace known to be in XX but not
    // which subdivision must not inherit it.
    expect(resolution.kind).toBe("not_covered");
  });

  it("blames the unknown subdivision, not a coverage gap, when a framework for the country exists", () => {
    // A metro/micro home geography carries no subdivision code (a CBSA is not
    // state-prefixed and may span states). Telling that workspace "no framework
    // is registered for your area" is false whenever one is registered for the
    // subdivision it is actually in, and it points the planner at the wrong fix.
    const resolution = registry.resolve({ country: "XX", subdivision: null, label: "A metro area" });

    expect(resolution.kind).toBe("not_covered");
    if (resolution.kind !== "not_covered") return;
    expect(resolution.reason).toMatch(/cannot tell which subdivision/i);
    expect(resolution.reason).toContain("A metro area");
    expect(resolution.reason).toContain("Testland");
    expect(resolution.reason).not.toMatch(/No VMT significance framework is registered for/i);
  });

  it("still reports a genuine coverage gap as one", () => {
    // Subdivision KNOWN and unmatched — the reason must stay the plain one.
    const resolution = registry.resolve({ country: "XX", subdivision: "ZZ" });
    expect(resolution.kind).toBe("not_covered");
    if (resolution.kind !== "not_covered") return;
    expect(resolution.reason).toMatch(/No VMT significance framework is registered for/i);
    expect(resolution.reason).not.toMatch(/cannot tell which subdivision/i);
  });

  it("does not claim an unknown subdivision blocks anything when the country registers nothing", () => {
    const resolution = registry.resolve({ country: "QQ", subdivision: null });
    expect(resolution.kind).toBe("not_covered");
    if (resolution.kind !== "not_covered") return;
    expect(resolution.reason).toMatch(/No VMT significance framework is registered for/i);
  });

  it("refuses to choose when two frameworks cover the same place", () => {
    const ambiguous = createVmtSignificanceFrameworkRegistry([
      descriptor(),
      descriptor({ frameworkId: "xx_second_v1", frameworkName: "Second framework" }),
    ]);
    const resolution = ambiguous.resolve({ country: "XX", subdivision: "YY" });

    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind !== "ambiguous") return;
    expect(resolution.frameworks).toHaveLength(2);
    expect(resolution.reason).toMatch(/will not choose between them/i);
  });

  it("matches a nationwide framework when no subdivision pack exists", () => {
    const nationwide = createVmtSignificanceFrameworkRegistry([
      descriptor({ frameworkId: "xx_national_v1", jurisdiction: { country: "XX", label: "Testland" } }),
    ]);

    expect(nationwide.resolve({ country: "XX", subdivision: "ZZ" }).kind).toBe("covered");
    expect(nationwide.resolve({ country: "XX", subdivision: null }).kind).toBe("covered");
  });

  it("names a place by its own label when it has one, by ISO code when it does not", () => {
    expect(describeJurisdiction({ country: "US", subdivision: "OH", label: "Franklin County" })).toBe(
      "Franklin County (US-OH)"
    );
    expect(describeJurisdiction({ country: "US", subdivision: null, label: null })).toBe("US");
  });
});

describe("a registration bug fails loudly rather than shipping an unresolvable framework", () => {
  it("rejects a duplicate id", () => {
    expect(() => createVmtSignificanceFrameworkRegistry([descriptor(), descriptor()])).toThrow(
      /Duplicate/i
    );
  });

  it("rejects a framework that cannot cite its own authority", () => {
    expect(() =>
      createVmtSignificanceFrameworkRegistry([descriptor({ statutoryCitation: "  " })])
    ).toThrow(/statutory citation/i);
  });

  it("rejects a framework that cannot say what it covers", () => {
    expect(() => createVmtSignificanceFrameworkRegistry([descriptor({ scopeStatement: "" })])).toThrow(
      /scope statement/i
    );
  });

  it("rejects a threshold that is not a fraction, and a non-positive reference", () => {
    expect(() =>
      createVmtSignificanceFrameworkRegistry([descriptor({ defaultThresholdPct: 15 })])
    ).toThrow(/fraction strictly between 0 and 1/i);
    expect(() =>
      createVmtSignificanceFrameworkRegistry([descriptor({ defaultReferenceVmtPerCapita: 0 })])
    ).toThrow(/greater than 0/i);
  });
});

describe("the shipped California framework", () => {
  it("covers a California workspace and carries its own citation, threshold, and reference", () => {
    const resolution = vmtSignificanceFrameworkRegistry.resolve({
      country: "US",
      subdivision: "CA",
      label: "Some County",
    });

    expect(resolution.kind).toBe("covered");
    if (resolution.kind !== "covered") return;
    expect(resolution.framework.frameworkId).toBe(US_CA_CEQA_15064_3_FRAMEWORK.frameworkId);
    expect(resolution.basis).toBe("workspace_home_geography");
    expect(resolution.framework.statutoryCitation).toMatch(/§15064\.3/);
    expect(resolution.framework.defaultThresholdPct).toBe(0.15);
    expect(resolution.framework.defaultReferenceVmtPerCapita).toBeGreaterThan(0);
    expect(resolution.framework.scopeStatement).toMatch(/California/);
  });

  it("does not reach a workspace in another state", () => {
    expect(vmtSignificanceFrameworkRegistry.resolve({ country: "US", subdivision: "TX" }).kind).toBe(
      "not_covered"
    );
    expect(vmtSignificanceFrameworkRegistry.resolve({ country: "CA" }).kind).toBe("not_covered");
  });

  it("registers exactly the descriptors it declares", () => {
    expect(BUILT_IN_VMT_SIGNIFICANCE_FRAMEWORKS).toContain(US_CA_CEQA_15064_3_FRAMEWORK);
    expect(vmtSignificanceFrameworkRegistry.get(US_CA_CEQA_15064_3_FRAMEWORK.frameworkId)).toBe(
      US_CA_CEQA_15064_3_FRAMEWORK
    );
    expect(vmtSignificanceFrameworkRegistry.get("no_such_framework")).toBeNull();
  });
});

describe("a determination cannot be summarized without its tier and its jurisdiction", () => {
  it("carries all four facts in the collapsed line", () => {
    const line = summarizeVmtDetermination({
      determination: "potentially_significant",
      frameworkName: US_CA_CEQA_15064_3_FRAMEWORK.frameworkName,
      jurisdictionLabel: US_CA_CEQA_15064_3_FRAMEWORK.jurisdiction.label,
      claimStatus: "screening_grade",
      claimStatusSource: "recorded_claim_decision",
      inputBasis: "screening",
    });

    expect(line).toContain("Potentially significant");
    expect(line).toContain(US_CA_CEQA_15064_3_FRAMEWORK.frameworkName);
    expect(line).toContain("California, United States");
    expect(line).toContain("screening-grade");
    expect(line).toContain("screening VMT");
  });

  it("says the tier is not recorded rather than assuming one", () => {
    const line = summarizeVmtDetermination({
      determination: "less_than_significant",
      frameworkName: "F",
      jurisdictionLabel: "J",
      claimStatus: null,
      claimStatusSource: "not_recorded",
      inputBasis: "calibrated",
    });

    expect(line).toContain("claim tier not recorded");
    expect(line).not.toMatch(/screening-grade/);
    expect(line).toContain("calibrated (count-tuned) VMT");
  });

  it("turns an absent modeling claim decision into 'not recorded', never a default tier", () => {
    expect(claimTierEvidence(null)).toEqual({ claimStatus: null, claimStatusSource: "not_recorded" });
    expect(claimTierEvidence(undefined)).toEqual({
      claimStatus: null,
      claimStatusSource: "not_recorded",
    });
    expect(claimTierEvidence("calibrated_to_counts")).toEqual({
      claimStatus: "calibrated_to_counts",
      claimStatusSource: "recorded_claim_decision",
    });
    expect(claimStatusLabel(null)).toBe("Claim tier not recorded");
  });

  it("maps the engine's wording onto the stored token", () => {
    expect(determinationToken({ significant: true })).toBe("potentially_significant");
    expect(determinationToken({ significant: false })).toBe("less_than_significant");
  });
});

describe("the stored row takes its jurisdiction from the descriptor, never from a constant", () => {
  const result = computeCeqaVmt([{ scenario_id: "run-a", population: 1, daily_vmt: 21.5 }], {
    referenceVmtPerCapita: 20,
    thresholdPct: 0.15,
  });

  function rowFor(framework: VmtSignificanceFrameworkDescriptor) {
    return buildVmtSignificanceScreeningRow({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "model_run", modelRunId: "22222222-2222-4222-8222-222222222222" },
      framework,
      jurisdiction: { country: "XX", subdivision: "YY", label: "A county in Testland" },
      jurisdictionBasis: "workspace_home_geography",
      claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
      inputBasis: "screening",
      vmtKpiName: "resident_vmt_per_capita",
      subjectRun: { status: "succeeded", engineKey: "aequilibrae" },
      result,
      createdBy: "33333333-3333-4333-8333-333333333333",
    });
  }

  it("writes a fabricated jurisdiction's framework with no California anywhere in the row", () => {
    // The property that makes "add a descriptor, not a call site" true: nothing
    // in the row builder knows which jurisdiction it is serving.
    const row = rowFor(descriptor());

    expect(row.framework_id).toBe("xx_test_framework_v1");
    expect(row.framework_name).toBe("Test VMT significance framework");
    expect(row.jurisdiction_country).toBe("XX");
    expect(row.jurisdiction_subdivision).toBe("YY");
    expect(row.jurisdiction_label).toBe("Testland");
    expect(row.jurisdiction_basis).toBe("workspace_home_geography");
    expect(JSON.stringify(row)).not.toMatch(/California|15064/i);
  });

  it("stores the determination, its arithmetic, its tier, and its basis", () => {
    const row = rowFor(US_CA_CEQA_15064_3_FRAMEWORK);

    // Reference 20, threshold 15% → cut line 17.0; 21.5 is above it.
    expect(row.determination).toBe("potentially_significant");
    expect(row.mitigation_required).toBe(true);
    expect(row.vmt_per_capita).toBe(21.5);
    expect(row.threshold_vmt_per_capita).toBe(17);
    expect(row.claim_status).toBe("screening_grade");
    expect(row.claim_status_source).toBe("recorded_claim_decision");
    expect(row.input_basis).toBe("screening");
    expect(row.vmt_kpi_name).toBe("resident_vmt_per_capita");
  });

  it("refuses to store a determination the engine did not produce", () => {
    const empty = { ...result, scenarios: [] };
    expect(() =>
      buildVmtSignificanceScreeningRow({
        workspaceId: "w",
        subject: { kind: "county_run", countyRunId: "c" },
        framework: descriptor(),
        jurisdiction: { country: "XX", subdivision: null, label: null },
        jurisdictionBasis: "workspace_home_geography",
        claimTier: { claimStatus: null, claimStatusSource: "not_recorded" },
        inputBasis: "screening",
        vmtKpiName: "vmt_per_capita",
        subjectRun: { status: "succeeded", engineKey: "aequilibrae" },
        result: empty,
        createdBy: "u",
      })
    ).toThrow(/no scenario/i);
  });

  it("keeps the run's status and engine on the determination, so a later reader can audit it", () => {
    // The route refuses an unfinished run or an ineligible engine, but a refusal
    // leaves no trace on the rows that WERE written. Without this, a stored
    // determination could not be told apart from one issued before the gate
    // existed — and `model_runs` may by then say something different, or be gone.
    const row = rowFor(descriptor());
    const inputs = row.inputs_json as { subjectRun: { status: string; engineKey: string } };

    expect(inputs.subjectRun).toEqual({ status: "succeeded", engineKey: "aequilibrae" });
  });
});

describe("a stored row this code cannot fully understand reads as absent, not as a weaker determination", () => {
  const valid = {
    id: "s1",
    workspace_id: "w1",
    model_run_id: "r1",
    county_run_id: null,
    framework_id: "us_ca_ceqa_15064_3_v1",
    framework_name: "CEQA §15064.3 VMT significance screening",
    framework_version: "1.0.0",
    jurisdiction_country: "US",
    jurisdiction_subdivision: "CA",
    jurisdiction_label: "California, United States",
    jurisdiction_basis: "workspace_home_geography",
    claim_status: "screening_grade",
    claim_status_source: "recorded_claim_decision",
    input_basis: "screening",
    vmt_kpi_name: "resident_vmt_per_capita",
    population_kpi_name: null,
    scenario_id: "run-a",
    determination: "potentially_significant",
    mitigation_required: true,
    vmt_per_capita: 21.5,
    threshold_vmt_per_capita: 17,
    reference_vmt_per_capita: 20,
    threshold_pct: 0.15,
    reference_label: "regional",
    project_type: "residential",
    engine_version: "openplan-planner-pack-ts",
    created_at: "2026-07-28T10:00:00.000Z",
  };

  it("parses a complete row", () => {
    const record = parseVmtSignificanceScreeningRow(valid);
    expect(record?.determination).toBe("potentially_significant");
    expect(record?.claimStatus).toBe("screening_grade");
    // PostgREST hands NUMERIC back as a string once it leaves the JSON-safe
    // range; a real number must not render as NaN.
    expect(parseVmtSignificanceScreeningRow({ ...valid, vmt_per_capita: "21.5" })?.vmtPerCapita).toBe(
      21.5
    );
  });

  it("rejects a row whose tier and provenance disagree", () => {
    expect(parseVmtSignificanceScreeningRow({ ...valid, claim_status: null })).toBeNull();
    expect(
      parseVmtSignificanceScreeningRow({ ...valid, claim_status_source: "not_recorded" })
    ).toBeNull();
  });

  it("rejects a row carrying a tier from a vocabulary this build does not know", () => {
    expect(parseVmtSignificanceScreeningRow({ ...valid, claim_status: "future_tier" })).toBeNull();
  });

  it("parses the record the API route actually puts on the wire", () => {
    // The route returns ALREADY-PARSED records (camelCase), and the browser
    // re-validates them with this same function. Reading only the snake_case
    // spelling made every stored determination parse as null in the browser:
    // the saved history rendered as empty with no message, and every successful
    // save announced itself as "saved but could not be read back — do not
    // retry". Both are a determination disappearing quietly.
    const wireRecord = parseVmtSignificanceScreeningRow(valid);
    expect(wireRecord).not.toBeNull();

    const reparsed = parseVmtSignificanceScreeningRow(
      JSON.parse(JSON.stringify(wireRecord)) as unknown
    );
    expect(reparsed).toEqual(wireRecord);
  });

  it("rejects a row whose mitigation flag is not a boolean rather than reading it as 'not required'", () => {
    expect(parseVmtSignificanceScreeningRow({ ...valid, mitigation_required: "true" })).toBeNull();
    expect(parseVmtSignificanceScreeningRow({ ...valid, mitigation_required: null })).toBeNull();
  });

  it("rejects a row with no jurisdiction or no framework", () => {
    expect(parseVmtSignificanceScreeningRow({ ...valid, jurisdiction_label: "" })).toBeNull();
    expect(parseVmtSignificanceScreeningRow({ ...valid, framework_id: null })).toBeNull();
    expect(parseVmtSignificanceScreeningRow({ ...valid, determination: "maybe" })).toBeNull();
    expect(parseVmtSignificanceScreeningRow(null)).toBeNull();
  });
});
