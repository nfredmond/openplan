/**
 * Five RTP financial writes were deliberately REFUSED as assistant actions on
 * 2026-08-05, and this is the executable form of that decision.
 *
 * WHY A TEST AND NOT A PARAGRAPH. The reasoning lives in CLAUDE.md — but
 * CLAUDE.md is gitignored and untracked in this repository (removed in
 * `00170a8e` so the open-source repo does not publish the owner's tooling), so
 * it exists on one machine and reaches no fresh clone and no other contributor.
 * A convention that survives on exactly one disk is not a guardrail. This file
 * is tracked, runs in CI, and fails the build if a future session registers one
 * of these without re-arguing it.
 *
 * THE DECISION, in one sentence: OpenPlan's fiscal-constraint engine is built to
 * REFUSE to answer when the data is missing (`not_determined` outranks the
 * arithmetic), and each refused action is a way to make it stop refusing. An
 * agentic layer whose first lesson is "how to make not_determined go away" is
 * worth less than no agentic layer, because the value of an agent controlling a
 * planning system depends entirely on the planning system still being honest
 * when the agent is done with it.
 *
 * THE GAP THIS COVERS THAT NOTHING ELSE DOES. `an-agent-may-not-promote-a-tier`
 * derives its vocabulary from `CHECK (col IN (…))` constraints — but the fiscal
 * verdict (`constrained` | `over_committed` | `not_determined`) is COMPUTED at
 * read time from a NUMERIC sum and stored in no column at all. All five refused
 * actions promote that verdict, and every one of them would have passed that
 * guard green. A tier does not stop being a tier because it is computed.
 *
 * This is a ratchet in one direction only: an entry may be REMOVED from the
 * refused list, but only by a session that writes down why the argument changed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

/**
 * Kinds that must not appear in the action registry, and the one-line reason.
 * The names are the ones a future session would most plausibly reach for; the
 * substring match below is what actually does the work, so a near-miss spelling
 * is caught too.
 */
const REFUSED: ReadonlyArray<{ fragment: string; matchOnly?: string; reason: string }> = [
  {
    fragment: "financial_assumption",
    reason:
      "A model authoring a revenue or cost figure. One revenue row of ANY amount retires the `no_revenue_recorded` blocker and flips the plan to `constrained` on the public document. Only a copy-forward from a named existing row, with the route reading every value off it, may be argued.",
  },
  {
    fragment: "programmed_cost",
    reason:
      "A model authoring a project's cost in a plan. The right value comes from an engineer's estimate that exists nowhere in the database; any in-range number clears `unpriced_constrained_project` and a low one flips the balance to `constrained`. `funding_need_amount` is a DIFFERENT quantity and is not a valid source.",
  },
  {
    fragment: "performance_measure",
    reason:
      "A model authoring a baseline, a target or a data source. A baseline is a measurement of the world and a model cannot measure; `data_source` is the column that makes a measure evidence rather than an assertion. Only a registry-scaffold action with baseline/target/dataSource ABSENT from the payload may be registered.",
  },
  {
    // fragment + matchOnly rather than the one exact spelling: the original
    // entry was `delete_horizon_band`, which the realistic spelling
    // `delete_rtp_horizon_band` does NOT contain (every registered RTP kind
    // carries the `rtp_` infix) — a naming blind spot the 2026-08-10
    // adversarial review caught. Deletion staying refused is also what keeps
    // the scaffold action churn-safe: without it an agent would hold both
    // halves of a delete-and-rescaffold loop.
    fragment: "horizon_band",
    matchOnly: "delete",
    reason:
      "Deleting a period. `ON DELETE SET NULL` detaches every programmed project and destroys the record of which ones — and narrowing it to EMPTY bands selects the worst case, because deleting an empty out-year band converts a visibly undetermined future into a flat `constrained` with no blocker to notice.",
  },
  {
    fragment: "horizon_band",
    matchOnly: "remove",
    reason:
      "The `remove_` spelling of the deletion refusal above — same argument, refused by both names.",
  },
  {
    fragment: "horizon_band",
    matchOnly: "assign",
    reason:
      "Assigning a project to a period. The payload is two verified uuids and it still fails, because the consequential content is the PAIRING: nothing in the schema records which period a project is planned for, so the choice is an authored phasing judgement, and the band sets the escalation exponent (≈+80% across a 15-year gap at 3%).",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

describe("the refused RTP financial actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register anything matching "${entry.matchOnly ? `${entry.matchOnly}…${entry.fragment}` : entry.fragment}"`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => {
        const matchesFragment = kind.includes(entry.fragment);
        if (!matchesFragment) return false;
        return entry.matchOnly ? kind.includes(entry.matchOnly) : true;
      });

      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on 2026-08-05: ${entry.reason} If the argument has genuinely changed, remove this entry AND record why — do not delete the assertion to make a build pass.`
      ).toEqual([]);
    });
  }

  it("guards the guard: the matcher would catch a registration if one appeared", () => {
    // Without this, a typo in a fragment (or an empty REFUSED list) would make
    // every assertion above vacuously true — the exact shape of a test that
    // converts an unchecked area into one everybody believes is checked.
    const pretendRegistry = [
      "create_rtp_financial_assumption",
      "set_rtp_programmed_cost",
      "create_rtp_performance_measure",
      // The REALISTIC spellings, with the rtp_ infix every registered RTP
      // kind carries — the original pretend name `delete_horizon_band` let
      // the matcher pass its self-check while the likely spelling escaped.
      "delete_rtp_horizon_band",
      "remove_rtp_horizon_band",
      "assign_rtp_project_horizon_band",
      "create_funding_opportunity", // an innocent bystander that must NOT match
    ];

    for (const entry of REFUSED) {
      const caught = pretendRegistry.filter((kind) => {
        const matchesFragment = kind.includes(entry.fragment);
        if (!matchesFragment) return false;
        return entry.matchOnly ? kind.includes(entry.matchOnly) : true;
      });
      expect(caught.length, `the "${entry.fragment}" matcher catches nothing`).toBeGreaterThan(0);
    }

    // And the innocent one is untouched by every matcher.
    const innocentHits = REFUSED.filter((entry) => {
      const kind = "create_funding_opportunity";
      const matchesFragment = kind.includes(entry.fragment);
      if (!matchesFragment) return false;
      return entry.matchOnly ? kind.includes(entry.matchOnly) : true;
    });
    expect(innocentHits).toEqual([]);
  });

  it("the ONE registered action from this lane carries its load-bearing guard", () => {
    /**
     * `create_rtp_horizon_bands_from_cycle_horizon` registered on 2026-08-10,
     * in its derived form only, and this tripwire converted from "fail when it
     * appears" to "fail if its guard ever disappears or hollows out".
     *
     * THE FIRST VERSION OF THIS TRIPWIRE WAS VACUOUS, and that is worth
     * keeping on the record: its comment said the route "must be covered by
     * the escalation-caveat guard" while its assertion checked only
     * `permitted.length === 1` — which the act of registering satisfied
     * trivially. A comment can claim a test exists; only the assertion is the
     * test. So this now reads the guard FILE and checks for the load-bearing
     * strings: the literal-null write and the ban on a body path to the
     * column. Deleting the guard, or gutting those assertions, fails here by
     * name.
     */
    const permitted = REGISTERED_KINDS.filter((kind) => kind.includes("horizon_bands_from_cycle_horizon"));
    expect(permitted).toEqual(["create_rtp_horizon_bands_from_cycle_horizon"]);

    const guardPath = path.join(
      process.cwd(),
      "src/test/rtp-scaffolded-bands-carry-no-escalation-year.test.ts"
    );
    const guard = readFileSync(guardPath, "utf8");
    expect(guard).toContain('expect(row.escalation_target_year).toBeNull()');
    expect(guard).toContain('expect(routeSource).toContain("escalation_target_year: null")');
    expect(guard).toContain('expect(routeSource).not.toContain("escalationTargetYear")');
  });

  it("still refuses FREEFORM band creation — only the derived shape is registered", () => {
    /**
     * The gap the 2026-08-10 registration closed the other way: the original
     * refusal list caught deleting a band and assigning a project to one, but
     * a `create_rtp_horizon_band` whose payload carried label, years and an
     * escalation target matched no fragment. Creating a band freeform is the
     * escalation-year hazard plus the authored-phasing hazard in one payload,
     * so it is refused BY NAME — with the one derived kind, whose route can
     * author none of those fields, exempted explicitly.
     */
    const offenders = REGISTERED_KINDS.filter(
      (kind) =>
        kind.includes("horizon_band") &&
        kind.includes("create") &&
        kind !== "create_rtp_horizon_bands_from_cycle_horizon"
    );
    expect(
      offenders,
      `${offenders.join(", ")} was registered. Freeform band creation was refused deliberately: a payload carrying years is an authored phasing judgement, and a payload carrying an escalation target year deletes the public document's 'midpoint assumed' caveat. Only the derived from-cycle-horizon shape may exist. If the argument has genuinely changed, record why — do not delete the assertion to make a build pass.`
    ).toEqual([]);

    // Guard the guard: the matcher catches the plausible spelling and exempts
    // exactly the registered derived kind.
    const pretend = ["create_rtp_horizon_band", "create_rtp_horizon_bands_from_cycle_horizon"];
    const caught = pretend.filter(
      (kind) =>
        kind.includes("horizon_band") &&
        kind.includes("create") &&
        kind !== "create_rtp_horizon_bands_from_cycle_horizon"
    );
    expect(caught).toEqual(["create_rtp_horizon_band"]);
  });
});
