import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_RUN_MODE_KEYS, getManagedRunModeDefinition } from "@/lib/models/run-modes";
import { rtpEvidenceRunWarnings, type RtpEvidenceRunDisclosure } from "@/lib/rtp/modeling-evidence";

/**
 * An RTP citation's engine caveat is DERIVED from the engine registry.
 *
 * WHAT THIS PREVENTS. `rtpEvidenceRunWarnings` originally read
 * `engineKey === "sketch_abm"` and carried that engine's "~56% below the CARB
 * reference" figure as a string literal. Two defects in one branch:
 *
 *   1. One engine's identity was baked into RTP citation logic — the
 *      hardcoding rule, applied to an engine instead of a place.
 *   2. Worse, it was silent: adding a sixth engine produced RTP citations with
 *      NO caveat at all, and nothing anywhere would have failed. That is the
 *      shipped-invisible shape — the absence of a warning looks exactly like a
 *      run that needs no warning.
 *
 * The fix inverts the default: every engine in the registry gets its caveat
 * disclosed beside a citation, so a new engine arrives already covered. This
 * guard fails if anyone re-introduces a per-engine branch here.
 */

const RTP_EVIDENCE_MODULE = path.join(process.cwd(), "src", "lib", "rtp", "modeling-evidence.ts");

/** Strip comments — the module explains the old literal on purpose. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

function disclosureFor(engineKey: string | null): RtpEvidenceRunDisclosure {
  return {
    engineKey,
    status: "succeeded",
    claimStatus: null,
    claimReadFailed: false,
    runReadFailed: false,
  };
}

describe("RTP citation caveats are derived, not hardcoded", () => {
  it("names no engine key in the RTP evidence module", () => {
    const code = codeOf(RTP_EVIDENCE_MODULE);
    const named = MANAGED_RUN_MODE_KEYS.filter((key) => code.includes(`"${key}"`));

    expect(
      named,
      "RTP citation logic must not test for a specific engine — read the caveat from the run-mode registry"
    ).toEqual([]);
  });

  it("discloses every registered engine's caveat, so a new engine cannot ship silently", () => {
    for (const key of MANAGED_RUN_MODE_KEYS) {
      const warnings = rtpEvidenceRunWarnings(disclosureFor(key));
      expect(warnings, `${key} produced no citation caveat`).toContain(
        getManagedRunModeDefinition(key).caveatSummary
      );
    }
  });

  /**
   * The assertion above would pass against a hardcoded copy of every caveat.
   * This one proves the text actually comes FROM the registry at call time: the
   * sketch engine's caveat carries a figure that exists in exactly one place.
   */
  it("carries the sketch engine's validation figure through from the registry", () => {
    const registryCaveat = getManagedRunModeDefinition("sketch_abm").caveatSummary;
    expect(registryCaveat).toMatch(/56%/);
    expect(rtpEvidenceRunWarnings(disclosureFor("sketch_abm"))).toContain(registryCaveat);
    // And the figure is not separately spelled in the RTP module.
    expect(codeOf(RTP_EVIDENCE_MODULE)).not.toMatch(/56%/);
  });

  it("says nothing about an engine it does not have", () => {
    // A null engine key means the run's engine was not recorded or could not be
    // read. The disclosure LINE already states which; inventing a caveat for an
    // engine we cannot name would be asserting something unknown.
    expect(rtpEvidenceRunWarnings(disclosureFor(null))).toEqual([]);
  });

  it("still warns about a failed run, independently of the engine caveat", () => {
    const failed = { ...disclosureFor("sketch_abm"), status: "failed" };
    const warnings = rtpEvidenceRunWarnings(failed);
    expect(warnings.some((warning) => warning.includes("failed"))).toBe(true);
    expect(warnings).toContain(getManagedRunModeDefinition("sketch_abm").caveatSummary);
  });

  it("never refuses a citation — warnings are additive text only", () => {
    // Disclose, never restrict: the function's contract is to return strings a
    // reader sees, and it must have no way to signal "do not render this".
    for (const key of MANAGED_RUN_MODE_KEYS) {
      for (const status of ["succeeded", "failed", "running"]) {
        const warnings = rtpEvidenceRunWarnings({ ...disclosureFor(key), status });
        expect(Array.isArray(warnings)).toBe(true);
        expect(warnings.every((warning) => typeof warning === "string")).toBe(true);
      }
    }
  });
});
