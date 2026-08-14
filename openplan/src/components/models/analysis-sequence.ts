/**
 * THE ORDER OF THE ANALYSIS WORK, STATED ONCE.
 *
 * Nathaniel, 2026-08-13, after using OpenPlan as a human for the first time:
 * "the analysis section with modelling and corridor analysis and whatnot is
 * super confusing."
 *
 * WHAT IS ACTUALLY WRONG. Models, Scenarios, Corridor Analysis and Model
 * Validation are four entries in one nav group, and each one opens as a wall of
 * parallel boxes. Nothing on any of them says that four of the five are ONE
 * PROCEDURE with an order and prerequisites. Worse, the rail's order contradicts
 * the code's:
 *
 *   - a model cannot pass its own checks without a scenario set
 *     (`buildModelReadiness`, "Scenario basis"), yet Scenarios is listed AFTER
 *     Models;
 *   - `/models/[id]` refuses to let its numbers leave the agency until a county
 *     run clears the screening gate ("No validated screening run on file"), yet
 *     Model Validation — the page that produces that gate — is listed after it;
 *   - Corridor Analysis is in the group and in NO part of the procedure. It
 *     writes the `runs` table; the modeling lane writes `model_runs`. Two
 *     unrelated things called a run, one nav group apart.
 *
 * So this module states the order once, in data, and derives each step's state
 * from facts a page has already read. Every page in the group renders the same
 * seven steps, so the answer to "what do I do first" does not depend on which
 * door the planner came in through.
 *
 * WHAT THIS IS NOT. It is not a wizard and it does not gate anything: a planner
 * who wants to run something out of order still can. It reports; it does not
 * refuse. The refusals that matter already live where they belong — the worker
 * launch gate, the caveat gate, the county screening gate.
 *
 * THE LAST STEP IS A CLAIM BOUNDARY, NOT A TASK. "You can quote the number" is
 * never reached: a screening result stays screening-grade after validation, and
 * `CLAIM_STEP` says so UNCONDITIONALLY — the sentence does not soften when the
 * gate passes. `analysis-sequence-order.test.ts` mutates exactly that.
 * The wording is CITED from `src/lib/help/screening-grade.ts`, never retyped;
 * that file is the one definition site and a second copy is a fork.
 */

import { SCREENING_GRADE_SUMMARY } from "@/lib/help/screening-grade";

export const ANALYSIS_STEP_IDS = [
  "area",
  "network",
  "comparison",
  "model",
  "run",
  "check",
  "claim",
] as const;

export type AnalysisStepId = (typeof ANALYSIS_STEP_IDS)[number];

/**
 * `done`    — the fact this step needs is on file.
 * `next`    — the first step that is not done. Exactly one, when any is missing.
 * `waiting` — not done, and something earlier is not done either.
 * `unknown` — the fact could not be read. Never presented as done or as missing,
 *             because a failed read and an empty agency arrive here identically.
 */
export type AnalysisStepState = "done" | "next" | "waiting" | "unknown";

export type AnalysisStep = {
  readonly id: AnalysisStepId;
  /** The planner's word for the work, as an instruction. */
  readonly title: string;
  /** One sentence: what this step is, and why the later ones need it. */
  readonly what: string;
  /** Where the work is done. Null for the claim boundary, which is not a task. */
  readonly href: string | null;
  readonly hrefLabel: string | null;
};

/**
 * The seven steps, in dependency order, independent of any agency's data.
 *
 * Ordering rule, so a later edit cannot quietly scramble it: a step may only be
 * done once every step before it is done. That is asserted, not assumed —
 * `analysis-sequence-order.test.ts` walks every prefix.
 */
export const ANALYSIS_STEPS: readonly AnalysisStep[] = [
  {
    id: "area",
    title: "Say where you are planning",
    what: "Search for your county, city, or metro area, draw it on the map, or upload a boundary file. Every step after this one is measured inside it.",
    href: "/explore",
    hrefLabel: "Pick the area",
  },
  {
    id: "network",
    title: "Bring in a road network",
    what: "Upload the streets and highways for that area. Travel times and distances are read off this, so nothing can be run until it is here.",
    href: "/models#network-packages",
    hrefLabel: "Upload a network",
  },
  {
    id: "comparison",
    title: "Say what you are comparing",
    what: "A scenario set holds the alternatives you want to weigh against each other — today, a build option, a no-build option. Results are filed against these.",
    href: "/scenarios",
    hrefLabel: "Set up a comparison",
  },
  {
    id: "model",
    title: "Describe the model",
    what: "Write down which model this is, what it assumes, and which project and scenario set it serves. Nobody can review a number whose method is not written down.",
    href: "/models#create-model",
    hrefLabel: "Describe a model",
  },
  {
    id: "run",
    title: "Run it",
    what: "Open the model and start a run. OpenPlan keeps an exact copy of what went in, so a number can always be tied back to the run that produced it.",
    href: "/models",
    hrefLabel: "Open a model and run it",
  },
  {
    id: "check",
    title: "Check it against traffic counts you already have",
    what: "Compare the run against counts collected in the field. Until that comparison clears, nothing here has been measured against the real world.",
    href: "/county-runs",
    hrefLabel: "Check a run",
  },
  {
    id: "claim",
    title: "Then say what the result supports",
    what: SCREENING_GRADE_SUMMARY,
    href: null,
    hrefLabel: null,
  },
];

/**
 * The one step whose text is a claim boundary rather than a task.
 *
 * Held as a named export so a guard can assert the sentence it ships — and so
 * that the sentence is the same one Help defines. It does NOT change when the
 * checking step passes: a validated screening run is still a screening run.
 */
export const CLAIM_STEP_ID: AnalysisStepId = "claim";

/**
 * What a page knows. Counts rather than booleans where a count is what the page
 * already has, so the sentence can say how many and not merely that some exist.
 *
 * `unreadable` carries the ids whose underlying read FAILED. A failed read and
 * an empty agency produce the same zero, and only one of them is a statement
 * about the agency — the same rule `ReadFailureLog` enforces everywhere else.
 */
export type AnalysisSequenceFacts = {
  readonly areaLabel: string | null;
  readonly networkCount: number;
  readonly scenarioSetCount: number;
  readonly modelCount: number;
  readonly runCount: number;
  /** A county run that reached validated-screening AND cleared its gate. */
  readonly checkedRunCount: number;
  readonly unreadable: readonly AnalysisStepId[];
};

export type ResolvedAnalysisStep = AnalysisStep & {
  readonly state: AnalysisStepState;
  /** What is true right now, in one sentence. Never a bare number. */
  readonly standing: string;
  /** When waiting: the title of the earliest step it is waiting on. */
  readonly waitingOn: string | null;
};

/** Whether the fact behind a step is on file. `null` means it could not be read. */
function factFor(step: AnalysisStepId, facts: AnalysisSequenceFacts): boolean | null {
  if (facts.unreadable.includes(step)) return null;
  switch (step) {
    case "area":
      return Boolean(facts.areaLabel);
    case "network":
      return facts.networkCount > 0;
    case "comparison":
      return facts.scenarioSetCount > 0;
    case "model":
      return facts.modelCount > 0;
    case "run":
      return facts.runCount > 0;
    case "check":
      return facts.checkedRunCount > 0;
    case "claim":
      // Not a task and never "done". What it says is true whatever else is.
      return false;
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The standing sentence for a step, given the facts and its state. */
function standingFor(
  step: AnalysisStepId,
  facts: AnalysisSequenceFacts,
  done: boolean | null
): string {
  if (done === null) {
    return "This could not be read just now, so it is unknown rather than missing.";
  }
  switch (step) {
    case "area":
      return done ? `Set to ${facts.areaLabel}.` : "Nothing chosen yet.";
    case "network":
      return done ? `${plural(facts.networkCount, "network here", "networks here")}.` : "None here yet.";
    case "comparison":
      return done
        ? `${plural(facts.scenarioSetCount, "scenario set", "scenario sets")}.`
        : "None here yet.";
    case "model":
      return done ? `${plural(facts.modelCount, "model", "models")} described.` : "None described yet.";
    case "run":
      return done ? `${plural(facts.runCount, "run", "runs")} finished or under way.` : "Nothing has been run yet.";
    case "check":
      return done
        ? `${plural(facts.checkedRunCount, "run has", "runs have")} been checked against field counts.`
        : "Nothing has been checked against field counts yet.";
    case "claim":
      return facts.checkedRunCount > 0
        ? "A checked run is on file. It is still a screening result, and the sentence above is still what it supports."
        : "Nothing has been checked against field counts yet, so treat every number here as provisional as well as screening-grade.";
  }
}

/**
 * The seven steps with today's state attached.
 *
 * `next` is the FIRST step that is neither done nor unknown. An unreadable step
 * does not become `next` — there is nothing to do about a query that failed —
 * and it does not let the steps after it march forward either, because it may
 * well be the thing they are waiting for.
 */
export function resolveAnalysisSequence(
  facts: AnalysisSequenceFacts
): readonly ResolvedAnalysisStep[] {
  let firstOutstanding: AnalysisStep | null = null;

  return ANALYSIS_STEPS.map((step) => {
    const done = factFor(step.id, facts);
    let state: AnalysisStepState;

    if (done === null) {
      state = "unknown";
    } else if (done) {
      state = "done";
    } else if (firstOutstanding === null) {
      state = "next";
    } else {
      state = "waiting";
    }

    const waitingOn = state === "waiting" ? (firstOutstanding as AnalysisStep).title : null;
    if (done !== true && firstOutstanding === null) firstOutstanding = step;

    return { ...step, state, standing: standingFor(step.id, facts, done), waitingOn };
  });
}
