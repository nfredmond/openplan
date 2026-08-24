/**
 * Modeling writes deliberately REFUSED as assistant actions on
 * 2026-08-08, on the day a fourth — `launch_model_run` — was registered. This
 * is the executable form of that decision.
 *
 * WHY A TEST AND NOT A PARAGRAPH. The reasoning lives in CLAUDE.md, which is
 * gitignored: it exists on one machine and reaches no fresh clone and no other
 * contributor. A convention that survives on exactly one disk is not a
 * guardrail. This file is tracked, runs in CI, and fails the build if a future
 * session registers one of these without re-arguing it.
 *
 * THE DECISION, IN ONE SENTENCE. `launch_model_run` is registrable because the
 * route it targets accepts no body at all: the study area, the engine and the
 * zone geography are read off a run row a person created, a succeeded run
 * cannot be relaunched, and the zone geography is deliberately re-read from the
 * run's own snapshot "so a relaunch of a stamped run cannot quietly change" it.
 * Each refusal below puts one of those back — a configuration the model chose,
 * a link set it can empty, or a second roll of a validation that already
 * answered.
 *
 * WHAT THE NEIGHBOURING GUARDS DO NOT COVER, AND WHY THAT IS THE POINT.
 * `an-agent-may-not-promote-a-tier` passes for every action below: none of them
 * writes `claim_status` on a path it can reach. The harm is the one the RTP
 * fiscal analysis named — a screening claim is DERIVED from a count comparison,
 * so an agent that can choose the inputs to that comparison, or re-run it until
 * the numbers land, never has to touch a tier column to move the tier.
 *
 * A ratchet in one direction only: an entry may be REMOVED, but only by a
 * session that writes down why the argument changed.
 */
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import {
  RELAUNCHABLE_RUN_STATUSES,
  RUN_STATUSES_REFUSED_BY_RELAUNCH,
  routeAcceptsRelaunchOfStatus,
} from "@/lib/models/run-modes";

type RefusedModelingAction = {
  label: string;
  /**
   * Alternative spellings a future session might reach for. A kind matches when
   * it contains every word in ANY one group — conjunctions rather than single
   * fragments, because `launch_model_run` IS registered and a bare "model" or
   * "run" fragment would fail this file against the action it exists to permit.
   */
  nameGroups: string[][];
  /** One plausible kind name PER GROUP, so a group matching nothing is caught. */
  provokes: string[];
  reason: string;
};

const REFUSED: RefusedModelingAction[] = [
  {
    label: "creating a NEW model run",
    nameGroups: [
      ["create", "model", "run"],
      ["new", "model", "run"],
      ["start", "model", "run"],
      ["queue", "new", "run"],
    ],
    provokes: [
      "create_model_run",
      "new_model_run_record",
      "start_model_run",
      "queue_new_run",
    ],
    reason:
      "Every argument for `launch_model_run` rests on the agent supplying no configuration, and `POST /runs` " +
      "is the opposite: it takes the study area, the engine and the zone geography in its body. The zone " +
      "geography alone decides how much of a run's travel never reaches a link, which decides whether a " +
      "link-level count comparison can support a screening claim at all — so choosing it is choosing what " +
      "the run will be allowed to claim. A study area the model draws is consequential content authored " +
      "from outside the system, which no registered action does.",
  },
  {
    label: "linking a dataset (or any record) to a model",
    nameGroups: [
      ["link", "dataset"],
      ["attach", "dataset"],
      ["link", "model", "record"],
      ["update", "model", "links"],
      ["set", "model", "links"],
    ],
    provokes: [
      "link_dataset_to_project",
      "attach_dataset_to_model",
      "link_model_record",
      "update_model_links",
      "set_model_links",
    ],
    reason:
      "NOT refused on its own merits — refused because it has no narrow route to ride. The only writer of " +
      "`model_links` is the model-detail PATCH, which REPLACES the whole link set, so a 'link one dataset' " +
      "action would run against an endpoint that can delete every other link a planner made. That is the " +
      "wide-route rule: the approval hash covers the action the route rebuilds, not the request body, so a " +
      "planner approving one link would be consenting to a replacement they never saw. Buildable later as " +
      "its own narrow additive endpoint; not registrable against this one.",
  },
  {
    label: "relaunching a run that already succeeded",
    nameGroups: [
      ["rerun", "succeeded"],
      ["relaunch", "succeeded"],
      ["retry", "succeeded"],
      ["rerun", "validation"],
      ["revalidate", "run"],
    ],
    provokes: [
      "rerun_succeeded_model_run",
      "relaunch_succeeded_run",
      "retry_succeeded_run",
      "rerun_validation",
      "revalidate_run",
    ],
    reason:
      "This is the gate-shopping shape, and it is the single reason `launch_model_run` could be registered " +
      "at all. A screening claim is derived from a count comparison whose median APE across as few as three " +
      "stations is volatile — OpenPlan's own corridor moved from 17.3% to 25-30% on the SAME model depending " +
      "on which stations were counted. An agent able to re-run a succeeded run until the numbers land is " +
      "manufacturing the tier the honesty firewall exists to protect, without ever writing a tier column. " +
      "The launch route refuses a succeeded run with a 400; do not add an action that routes around it.",
  },
  {
    label: "cancelling or terminating a model run",
    nameGroups: [
      ["cancel", "model", "run"],
      ["stop", "model", "run"],
      ["terminate", "run"],
      ["abort", "run"],
    ],
    provokes: [
      "cancel_model_run",
      "stop_model_run",
      "terminate_run",
      "abort_run",
    ],
    reason:
      "A run may take days because OpenPlan does not trade accuracy for runtime. Ending it discards a planner's " +
      "computation and releases the single-worker queue, so cancellation remains a human-only control. The assistant " +
      "may explain stale heartbeats or propose investigation, but it may not terminate the attempt.",
  },
  {
    label: "selecting agreement corridors for a report or grant",
    nameGroups: [
      ["select", "agreement", "corridor"],
      ["choose", "corridor", "evidence"],
      ["attach", "corridor", "report"],
    ],
    provokes: [
      "select_agreement_corridor",
      "choose_corridor_evidence",
      "attach_corridor_to_report",
    ],
    reason:
      "Choosing which named corridor belongs in a report or funder document is planner judgment, not " +
      "mechanical assembly. The approved report-generation action may consume selections a planner already " +
      "saved, but the assistant must not author that evidence choice or empty the planner's selection set.",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

function matchesRefusal(kind: string, entry: RefusedModelingAction): boolean {
  return entry.nameGroups.some((group) => group.every((word) => kind.includes(word)));
}

describe("the refused modeling actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register anything matching "${entry.label}"`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => matchesRefusal(kind, entry));

      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on ` +
          `in this executable refusal list: ${entry.reason} If the argument has genuinely changed, remove this entry AND record ` +
          "why — do not delete the assertion to make a build pass."
      ).toEqual([]);
    });
  }

  it("guards the guard: every name group would catch a registration", () => {
    // A group matching nothing is a hole with no symptom. Checking the ENTRY
    // catches something is not enough — the neighbouring GTFS guard proved that
    // by surviving a typo in one of six groups.
    for (const entry of REFUSED) {
      expect(
        entry.provokes.length,
        `"${entry.label}" must provoke one name per group`
      ).toBe(entry.nameGroups.length);

      entry.nameGroups.forEach((group, index) => {
        const provoker = entry.provokes[index];
        expect(
          group.every((word) => provoker.includes(word)),
          `group [${group.join(", ")}] of "${entry.label}" does not match its own provoker ${provoker}`
        ).toBe(true);
      });
    }
  });

  it("leaves innocent registered actions alone", () => {
    for (const innocent of ["create_funding_opportunity", "refresh_gtfs_feed"]) {
      const hits = REFUSED.filter((entry) => matchesRefusal(innocent, entry));
      expect(hits.map((entry) => entry.label), innocent).toEqual([]);
    }
  });

  it("does not refuse the one modeling action that IS registered", () => {
    /**
     * THE ASSERTION THAT MAKES THE THREE ABOVE MEAN SOMETHING. A matcher wide
     * enough to catch every spelling of "start a model run" is one word away
     * from catching `launch_model_run`, and if it did, the only way to a green
     * build would be to weaken the matchers — which is how a refusal list
     * quietly stops refusing anything.
     */
    expect(REGISTERED_KINDS).toContain("launch_model_run");

    const wrongfullyRefused = REFUSED.filter((entry) => matchesRefusal("launch_model_run", entry));
    expect(
      wrongfullyRefused.map((entry) => entry.label),
      "a refusal matcher also matches launch_model_run, which is registered on purpose. Narrow the matcher; " +
        "do not remove the refusal."
    ).toEqual([]);
  });
});

describe("the registered modeling action stays as narrow as the argument for it", () => {
  it("never becomes relaunchable for a succeeded run", () => {
    // The refusal above is only as real as this list. `succeeded` here would
    // register the third refusal by the back door, with no new action kind for
    // the matchers to catch.
    expect(RELAUNCHABLE_RUN_STATUSES as readonly string[]).not.toContain("succeeded");
    expect(RELAUNCHABLE_RUN_STATUSES as readonly string[]).not.toContain("running");
    // And the ROUTE itself must keep refusing it. Narrowing only the offer
    // would leave the endpoint open to anything that calls it directly.
    expect(RUN_STATUSES_REFUSED_BY_RELAUNCH as readonly string[]).toContain("succeeded");
    expect(routeAcceptsRelaunchOfStatus("succeeded")).toBe(false);
  });

  it("is consented to by a person who saw which run it names", () => {
    // `review` renders no approval dialog at all and short-circuits hash
    // verification, so downgrading this tier is not weaker consent — it is none.
    expect(ACTION_METADATA.launch_model_run.approval).toBe("approval_required");
  });
});
