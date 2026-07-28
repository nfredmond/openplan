import { describe, expect, it } from "vitest";
import {
  COUNTY_RUN_NON_PASSING_GATE_STATUSES,
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

  it("treats a substantive gate status as passing", () => {
    expect(isPassingCountyRunGateStatus("validated screening slice")).toBe(true);
  });

  it("treats an absent or blank status as not passing rather than assuming success", () => {
    expect(isPassingCountyRunGateStatus(null)).toBe(false);
    expect(isPassingCountyRunGateStatus(undefined)).toBe(false);
    expect(isPassingCountyRunGateStatus("")).toBe(false);
    expect(isPassingCountyRunGateStatus("   ")).toBe(false);
  });

  it("keeps the non-passing list lowercase so the comparison stays total", () => {
    for (const status of COUNTY_RUN_NON_PASSING_GATE_STATUSES) {
      expect(status).toBe(status.trim().toLowerCase());
    }
  });

  it("names no place", () => {
    const text = COUNTY_RUN_NON_PASSING_GATE_STATUSES.join(" ").toLowerCase();
    expect(text).not.toContain("nevada");
    expect(text).not.toContain("county,");
  });
});
