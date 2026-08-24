/**
 * Human signatures in Land Use Plans. These routes exist for planners, but an
 * assistant action must not ride them: each choice authors public policy,
 * legal posture, or the exact record released to the public.
 */
import { describe, expect, it } from "vitest";

import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

const REFUSED = [
  {
    label: "adopting a land use plan",
    groups: [["adopt", "land", "plan"]],
    provokers: ["adopt_land_use_plan"],
    reason: "Adoption is the legislative body's decision and must name the exact frozen hash, instrument, vote, date, and human-selected supporting artifact.",
  },
  {
    label: "authoring legal findings",
    groups: [["legal", "finding"], ["adoption", "finding"]],
    provokers: ["record_legal_finding", "write_adoption_finding"],
    reason: "A plausible finding is consequential legal content. A review sheet cannot establish that the evidence supports it.",
  },
  {
    label: "selecting plan evidence",
    groups: [["select", "plan", "evidence"], ["attach", "adoption", "evidence"]],
    provokers: ["select_land_plan_evidence", "attach_adoption_evidence"],
    reason: "The pairing between a claim and an artifact is itself authored content, even when the payload carries only ids.",
  },
  {
    label: "selecting mapped designations",
    groups: [["select", "map", "designation"], ["attach", "designation", "layer"]],
    provokers: ["select_map_designation", "attach_designation_layer"],
    reason: "Choosing which future-land-use layer governs the plan is a public policy judgment. The map can look ordinary while expressing the wrong adopted pattern.",
  },
  {
    label: "publishing a land use plan",
    groups: [["publish", "land", "plan"], ["release", "plan", "packet"]],
    provokers: ["publish_land_use_plan", "release_plan_packet"],
    reason: "Publication makes the frozen record public and must remain a deliberate human act after the privacy exclusions and exact hash are checked.",
  },
] as const;

const REGISTERED = Object.keys(ACTION_METADATA);
function matches(kind: string, groups: readonly (readonly string[])[]) {
  return groups.some((group) => group.every((word) => kind.includes(word)));
}

describe("human-only Land Use Plans actions remain refused", () => {
  for (const refusal of REFUSED) {
    it(`does not register ${refusal.label}`, () => {
      const offenders = REGISTERED.filter((kind) => matches(kind, refusal.groups));
      expect(offenders, `${refusal.reason} If that argument changes, record why before removing this refusal.`).toEqual([]);
    });
  }

  it("guards every refusal matcher with a plausible action name", () => {
    for (const refusal of REFUSED) {
      expect(refusal.provokers).toHaveLength(refusal.groups.length);
      refusal.provokers.forEach((provoker, index) => expect(matches(provoker, [refusal.groups[index]])).toBe(true));
    }
  });

  it("does not refuse grounded drafting or an unrelated registered report action", () => {
    expect(REGISTERED).toContain("generate_report_artifact");
    for (const innocent of ["draft_land_use_policy", "generate_report_artifact"]) {
      expect(REFUSED.filter((refusal) => matches(innocent, refusal.groups))).toEqual([]);
    }
  });
});

