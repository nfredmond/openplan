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
  "activitysim_run",
  "check",
  "packet",
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
    title: "Use one shared road network",
    what: "Use a versioned package or let the workers build a labeled OpenStreetMap snapshot at launch. OpenPlan saves its exact digest and refuses the comparison if the methods did not share it.",
    href: "/models#network-packages",
    hrefLabel: "Choose the shared network",
  },
  {
    id: "comparison",
    title: "Set one baseline and one build scenario",
    what: "A scenario set holds the no-build baseline and the build option. Each side needs its own saved entry before either result can be compared.",
    href: "/scenarios",
    hrefLabel: "Set up a comparison",
  },
  {
    id: "model",
    title: "Describe both methods",
    what: "Create separate AequilibraE and ActivitySim models for this project and scenario set. Keep each method's assumptions and limits distinct.",
    href: "/models#create-model",
    hrefLabel: "Describe a model",
  },
  {
    id: "run",
    title: "Run AequilibraE",
    what: "Run the assignment method against the shared network and saved scenarios. Worker absence, a failed run, or unloaded links must remain visible.",
    href: "/models",
    hrefLabel: "Open the AequilibraE model",
  },
  {
    id: "activitysim_run",
    title: "Run ActivitySim separately",
    what: "Run the activity-based method as its own job. Do not average it with AequilibraE or hide disagreement between the two methods.",
    href: "/models",
    hrefLabel: "Open the ActivitySim model",
  },
  {
    id: "check",
    title: "Validate each result against observed counts",
    what: "Compare each method with field counts and keep every missing link, failed check, and unavailable source visible. A completed worker job is not a passed validation.",
    href: "/county-runs",
    hrefLabel: "Check a run",
  },
  {
    id: "packet",
    title: "Save the unaveraged comparison report",
    what: "Put baseline and build results from both methods side by side in plain language. Preserve disagreements and every uncertainty; never replace them with one averaged number.",
    href: "/scenarios",
    hrefLabel: "Save and review the comparison",
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
  /** A registered managed basis; its exact snapshot remains unavailable until launch succeeds. */
  readonly managedNetworkBasisCount?: number;
  /** Both guided method records use the managed comparison contract. */
  readonly guidedProjectComparison?: boolean;
  readonly scenarioSetCount: number;
  readonly modelCount: number;
  readonly aequilibraeModelCount?: number;
  readonly activitySimModelCount?: number;
  readonly runCount: number;
  readonly aequilibraeRunCount?: number;
  readonly activitySimRunCount?: number;
  /** Exact track-matched validation decisions on the current output runs, including prototype-only decisions. */
  readonly checkedRunCount: number;
  /** Exact track-matched decisions whose claim status is stronger than prototype-only. */
  readonly nonPrototypeCheckedRunCount?: number;
  /** Guided scenario sets for which all four exact outputs have track-matched decisions. */
  readonly guidedComparisonCheckedCount?: number;
  readonly comparisonPacketCount?: number;
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
      return facts.guidedProjectComparison
        ? (facts.managedNetworkBasisCount ?? 0) > 0
        : facts.networkCount > 0 || (facts.managedNetworkBasisCount ?? 0) > 0;
    case "comparison":
      return facts.scenarioSetCount > 0;
    case "model":
      return typeof facts.aequilibraeModelCount === "number" && typeof facts.activitySimModelCount === "number"
        ? facts.aequilibraeModelCount > 0 && facts.activitySimModelCount > 0
        : facts.modelCount > 0;
    case "run":
      return facts.guidedProjectComparison
        ? (facts.aequilibraeRunCount ?? 0) >= 2
        : (facts.aequilibraeRunCount ?? facts.runCount) > 0;
    case "activitysim_run":
      return facts.guidedProjectComparison
        ? (facts.activitySimRunCount ?? 0) >= 2
        : (facts.activitySimRunCount ?? 0) > 0;
    case "check":
      return facts.guidedProjectComparison
        ? (facts.guidedComparisonCheckedCount ?? 0) > 0
        : facts.checkedRunCount > 0;
    case "packet":
      return (facts.comparisonPacketCount ?? 0) > 0;
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
      return done
        ? (facts.managedNetworkBasisCount ?? 0) > 0
          ? "Worker-managed OpenStreetMap basis registered. Its exact snapshot and digest remain unavailable until launch succeeds."
          : `${plural(facts.networkCount, "network here", "networks here")}.`
        : "No shared road network is selected yet.";
    case "comparison":
      return done
        ? `${plural(facts.scenarioSetCount, "scenario set", "scenario sets")}.`
        : "None here yet.";
    case "model":
      return done
        ? typeof facts.aequilibraeModelCount === "number" && typeof facts.activitySimModelCount === "number"
          ? "Separate AequilibraE and ActivitySim method records are on file."
          : `${plural(facts.modelCount, "model", "models")} described.`
        : facts.modelCount > 0
          ? "One method is described, but the separate AequilibraE and ActivitySim records are not both on file."
          : "None described yet.";
    case "run":
      return done
        ? facts.guidedProjectComparison
          ? "The AequilibraE baseline and build runs both succeeded."
          : `${plural(facts.aequilibraeRunCount ?? facts.runCount, "AequilibraE run", "AequilibraE runs")} finished or under way.`
        : facts.guidedProjectComparison
          ? `${facts.aequilibraeRunCount ?? 0}/2 successful AequilibraE scenario runs are on file.`
          : "No AequilibraE run is on file yet.";
    case "activitysim_run":
      return done
        ? facts.guidedProjectComparison
          ? "The separate ActivitySim baseline and build jobs both succeeded."
          : `${plural(facts.activitySimRunCount ?? 0, "ActivitySim run", "ActivitySim runs")} finished or under way.`
        : facts.guidedProjectComparison
          ? `${facts.activitySimRunCount ?? 0}/2 successful ActivitySim scenario jobs are on file.`
          : "No ActivitySim run is on file yet.";
    case "check":
      return done
        ? facts.guidedProjectComparison
          ? `${facts.checkedRunCount}/4 exact guided outputs have checks on file; ${facts.nonPrototypeCheckedRunCount ?? 0}/4 have non-prototype passes.`
          : `${plural(facts.checkedRunCount, "run has", "runs have")} a field-count decision on file.`
        : facts.guidedProjectComparison && facts.checkedRunCount > 0
          ? `${facts.checkedRunCount}/4 exact guided outputs have checks on file; ${facts.nonPrototypeCheckedRunCount ?? 0}/4 have non-prototype passes. All four need a track-matched decision.`
          : "Nothing has been checked against field counts yet.";
    case "packet":
      return done
        ? `${plural(facts.comparisonPacketCount ?? 0, "saved comparison report", "saved comparison reports")}.`
        : "No unaveraged comparison report is on file yet.";
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
