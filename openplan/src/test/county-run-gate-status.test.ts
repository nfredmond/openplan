import { describe, expect, it } from "vitest";
import {
  COUNTY_RUN_PASSING_GATE_STATUSES,
  isPassingCountyRunGateStatus,
} from "@/lib/models/county-onramp";

/**
 * Reaching `validated-screening` means the validation slice RAN, not that it
 * passed. A run whose worst matched facility blows past the critical-facility
 * error threshold still lands in that stage, carrying a gate status that says
 * it is prototype-grade. Counting it as evidence would let a failed validation
 * strengthen a claim.
 *
 * This rule used to be expressed by comparing against a constant exported from
 * one specific county's example module, which made a jurisdiction-neutral
 * question depend on a place.
 */
describe("county-run screening gate status", () => {
  it("treats a recorded prototype-only gate as not passing", () => {
    expect(isPassingCountyRunGateStatus("internal prototype only")).toBe(false);
  });

  it("ignores casing and surrounding whitespace, since the status is recorded text not an enum", () => {
    expect(isPassingCountyRunGateStatus("  Internal Prototype Only  ")).toBe(false);
    expect(isPassingCountyRunGateStatus("INTERNAL PROTOTYPE ONLY")).toBe(false);
  });

  it("treats an UNRECOGNISED gate status as not passing", () => {
    /**
     * REVERSED 2026-08-08, deliberately. This asserted that
     * `"validated screening slice"` passed — a string nothing in the repository
     * emits. `classify_gate` returns exactly two values, so the old assertion
     * was not describing a producer's output; it was encoding the fail-open
     * default of a denylist, on the function that decides whether a county run
     * counts as passing modeling EVIDENCE.
     *
     * An unconstrained text column read against a denylist means any new or
     * misspelled status counts as a pass until somebody remembers to add it.
     * On a claim-boundary surface the default has to be "not evidence".
     */
    expect(isPassingCountyRunGateStatus("validated screening slice")).toBe(false);
    expect(isPassingCountyRunGateStatus("looks fine to me")).toBe(false);
    expect(isPassingCountyRunGateStatus("bounded screening ready")).toBe(false); // hyphen dropped
  });

  it("passes the one status the validator actually awards", () => {
    // `classify_gate` in validate_screening_observed_counts.py returns exactly
    // "bounded screening-ready" or "internal prototype only".
    expect(isPassingCountyRunGateStatus("bounded screening-ready")).toBe(true);
    expect(isPassingCountyRunGateStatus("  Bounded Screening-Ready  ")).toBe(true);
  });

  it("treats an absent or blank status as not passing rather than assuming success", () => {
    expect(isPassingCountyRunGateStatus(null)).toBe(false);
    expect(isPassingCountyRunGateStatus(undefined)).toBe(false);
    expect(isPassingCountyRunGateStatus("")).toBe(false);
    expect(isPassingCountyRunGateStatus("   ")).toBe(false);
  });

  it("keeps the non-passing list lowercase so the comparison stays total", () => {
    for (const status of COUNTY_RUN_PASSING_GATE_STATUSES) {
      expect(status).toBe(status.trim().toLowerCase());
    }
  });

  it("names no place", () => {
    const text = COUNTY_RUN_PASSING_GATE_STATUSES.join(" ").toLowerCase();
    expect(text).not.toContain("nevada");
    expect(text).not.toContain("county,");
  });
});
