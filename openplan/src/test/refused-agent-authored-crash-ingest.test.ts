import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { ACTION_REGISTRY } from "@/lib/runtime/action-registry";

/**
 * TWO CRASH-LANE WRITES REFUSED AS ASSISTANT ACTIONS, 2026-08-12, on the day the
 * crash lane gained a person-level table and five new dimensions.
 *
 * WHY A TEST AND NOT A PARAGRAPH. The reasoning would otherwise live in
 * CLAUDE.md, which is gitignored in this repository — it exists on one machine
 * and reaches no fresh clone and no other contributor. A convention that
 * survives on exactly one disk is not a guardrail. This file is tracked, runs in
 * CI, and fails the build if a future session registers one of these without
 * re-arguing it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFUSAL 1 — the agent may not run a crash acquisition.
 *
 * It looks like the safest action in the module. It writes no prose, invents no
 * figure, and every number it stores comes from a government source. The rule it
 * breaks is subtler and it is the one this codebase treats most seriously: the
 * model would be authoring the QUESTION.
 *
 * A crash ingest takes a bounding box, a year window and a county code, and what
 * comes back is a permanent, cited record of real injuries and deaths that flows
 * into the corridor scorecard, the benefit-cost screen, the RTP safety criterion
 * and a grant application. Those three inputs are not retrieval parameters, they
 * are the analysis:
 *
 *   - THE STUDY AREA IS THE FINDING. Nudge a bounding box a few hundred metres
 *     and a corridor's fatal count changes. There is no way to see that on an
 *     approval sheet — four decimal numbers look equally plausible whichever
 *     ones they are — and the resulting figure carries a government attribution
 *     that makes it read as authoritative.
 *   - THE YEAR WINDOW IS THE TREND. Crash counts are volatile at corridor scale;
 *     choosing which years to include chooses whether safety is improving. A
 *     model that has read the surrounding conversation has every incentive to
 *     pick the window that supports it.
 *   - THE COUNTY CODE IS A DENOMINATOR. It is what makes the reported total
 *     exceed the mappable total, so a wrong or absent one silently changes the
 *     coverage disclosure the whole module rests on.
 *
 * Contrast with the twelve registered actions: each one's consequential values
 * are read by the route off a row the PLANNER already chose. Here there is no
 * such row — the study area is the payload. And this action is the shape the
 * repository's fifth refusal principle names: it empties a work queue the agent
 * can see ("this workspace has no crash data yet") and therefore carries a
 * standing incentive to fire.
 *
 * WHAT THE PLANNER LOSES: nothing they cannot do in one click. The acquisition
 * launcher already takes a study area from the one geography front door and a
 * year window from the shared crash-year helper. The agent may READ the result
 * and cite it, which is the useful half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFUSAL 2 — the agent may not read `safety_crash_parties`.
 *
 * A read refusal, which is rare here and deliberate. The table holds one row per
 * person: their role, their age band and how badly they were hurt, attached to a
 * precise coordinate and a date. Role plus band plus outcome plus place plus day
 * is quasi-identifying in a small town, and the failure mode of a model with
 * that in context is not a bad write — it is a sentence in a public-facing draft
 * that describes an identifiable person's injuries.
 *
 * The aggregate is what planning actually needs, and it is not refused: counts
 * by role, by band and by outcome are exactly what a safety action plan is
 * built from, and they carry no individual. So the boundary is drawn at the row,
 * not at the subject.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ratchet in one direction only: an entry may be REMOVED, but only by a
 * session that writes down why the argument changed.
 */

type RefusedCrashAction = {
  label: string;
  /**
   * A kind matches when it contains every word in ANY one group.
   *
   * Groups rather than single fragments, because a bare "crash" or "safety"
   * fragment would be useless the moment a legitimate crash-READING action is
   * registered — which is expected and desirable. Each group is a different
   * spelling a future session might plausibly reach for.
   */
  nameGroups: string[][];
  /** One plausible kind name PER GROUP, so no group can be a hole with no symptom. */
  provokes: string[];
  reason: string;
};

const REFUSED: RefusedCrashAction[] = [
  {
    label: "running a crash acquisition for a study area",
    nameGroups: [
      ["ingest", "crash"],
      ["acquire", "crash"],
      ["fetch", "crash"],
      ["import", "crash"],
      ["run", "crash"],
      ["load", "collision"],
      ["crash", "study_area"],
    ],
    provokes: [
      "ingest_crash_data",
      "acquire_crash_records",
      "fetch_crashes_for_study_area",
      "import_crash_history",
      "run_crash_acquisition",
      "load_collision_records",
      "attach_crash_study_area",
    ],
    reason:
      "the bounding box, the year window and the county code ARE the analysis, and a wrong one is " +
      "indistinguishable from a right one on an approval sheet while the result carries a government " +
      "attribution",
  },
  {
    label: "reading person-level crash rows",
    nameGroups: [
      ["read", "part", "crash"],
      ["list", "crash", "part"],
      ["get", "crash", "victim"],
      ["crash", "person"],
      ["injured", "person"],
      ["crash", "occupant"],
    ],
    provokes: [
      "read_crash_parties",
      "list_crash_parties",
      "get_crash_victims",
      "summarize_crash_persons",
      "list_injured_persons",
      "read_crash_occupants",
    ],
    reason:
      "role + age band + injury outcome + precise coordinate + date is quasi-identifying; the aggregate " +
      "is what planning needs and is not refused",
  },
];

function matchesGroup(kind: string, group: string[]): boolean {
  const normalized = kind.toLowerCase();
  return group.every((word) => normalized.includes(word));
}

function matchesEntry(kind: string, entry: RefusedCrashAction): boolean {
  return entry.nameGroups.some((group) => matchesGroup(kind, group));
}

describe("refused agent-authored crash ingest", () => {
  const registeredKinds = [...new Set([...Object.keys(ACTION_METADATA), ...Object.keys(ACTION_REGISTRY)])];

  it("finds the action registry it is guarding", () => {
    // Without this the sweep below could pass against an empty registry, which
    // is the vacuous shape this repository has shipped before.
    expect(registeredKinds.length).toBeGreaterThan(5);
  });

  it("registers no crash-lane write or person-level read", () => {
    const offenders: string[] = [];
    for (const entry of REFUSED) {
      for (const kind of registeredKinds) {
        if (matchesEntry(kind, entry)) {
          offenders.push(`${kind} is registered but "${entry.label}" is refused — ${entry.reason}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("guards the guard — every NAME GROUP catches something on its own", () => {
    // The obvious version of this test asserts each ENTRY catches its provokes,
    // and it survives a typo in a single group because the entry's other groups
    // still match. A group that matches nothing is a hole with no symptom, so
    // each is exercised individually.
    for (const entry of REFUSED) {
      expect(entry.provokes, entry.label).toHaveLength(entry.nameGroups.length);
      entry.nameGroups.forEach((group, index) => {
        expect(
          matchesGroup(entry.provokes[index], group),
          `${entry.label}: group [${group.join(", ")}] must catch "${entry.provokes[index]}"`
        ).toBe(true);
      });
    }
  });

  it("guards the guard — the patterns do not swallow a legitimate crash READ", () => {
    // Reading the workspace's own acquired, AGGREGATED crash evidence is exactly
    // what the agent should be able to do, and a refusal list broad enough to
    // block it would be a refusal of the module rather than of these two writes.
    for (const permitted of [
      "read_safety_crash_summary",
      "cite_crash_evidence",
      "summarize_crash_severity_counts",
      "describe_crash_coverage",
    ]) {
      for (const entry of REFUSED) {
        expect(matchesEntry(permitted, entry), `${permitted} vs ${entry.label}`).toBe(false);
      }
    }
  });
});
