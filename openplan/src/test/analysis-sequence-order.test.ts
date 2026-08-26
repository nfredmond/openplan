import { describe, expect, it } from "vitest";

import {
  ANALYSIS_STEPS,
  ANALYSIS_STEP_IDS,
  CLAIM_STEP_ID,
  resolveAnalysisSequence,
  type AnalysisSequenceFacts,
  type AnalysisStepId,
} from "@/components/models/analysis-sequence";
import { SCREENING_GRADE_SUMMARY } from "@/lib/help/screening-grade";
import { BANNED_TERMS, PROTECTED_CLAIMS } from "@/test/helpers/jargon-ledger";

/**
 * THE ANALYSIS SEQUENCE: THE ORDER HOLDS, AND THE LAST STEP NEVER SOFTENS.
 *
 * Nathaniel, 2026-08-13: "the analysis section with modelling and corridor
 * analysis and whatnot is super confusing." The fix was to state the order of
 * the work on every page in the group. The risk the fix creates is the reason
 * for this file, and it is worth naming precisely:
 *
 *   A SEQUENCE IS A PROMISE THAT THE END IS REACHABLE. Seven numbered steps
 *   with a tick against each one read as a checklist, and a checklist finished
 *   reads as permission. But the seventh item is not a task — it is the claim
 *   boundary, and a screening result is still a screening result after the
 *   checking step passes. If the last step ever renders as "done", or if its
 *   sentence gets shorter once a validated run is on file, the sequence has
 *   quietly turned a caveat into a milestone. That is the defect this file
 *   exists to make impossible, and `never claims the caveat has been cleared`
 *   is the assertion that does it.
 *
 * WHAT THIS FILE CANNOT SEE. It reads the sequence, not the pages. That four
 * pages render it, and that the strip draws no box, is measured in a real
 * browser — jsdom applies no stylesheet and has no box model, so nesting and
 * density are outside anything asserted here. The render itself is checked in
 * `analysis-sequence-strip.test.tsx`.
 *
 * MUTATION-VERIFIED 2026-08-13; the round report names which mutation produced
 * which failure.
 */

/** An agency at the very beginning: nothing done, nothing broken. */
const EMPTY: AnalysisSequenceFacts = {
  areaLabel: null,
  networkCount: 0,
  scenarioSetCount: 0,
  modelCount: 0,
  runCount: 0,
  checkedRunCount: 0,
  unreadable: [],
};

/** Everything done, including a county run that cleared the screening gate. */
const COMPLETE: AnalysisSequenceFacts = {
  areaLabel: "Nevada County, California",
  networkCount: 2,
  scenarioSetCount: 3,
  modelCount: 1,
  runCount: 4,
  aequilibraeRunCount: 2,
  activitySimRunCount: 2,
  checkedRunCount: 1,
  comparisonPacketCount: 1,
  unreadable: [],
};

/**
 * Facts with the first `n` steps satisfied — used to walk every prefix, so the
 * ordering rule is checked at each point rather than at the two ends.
 */
function factsSatisfying(n: number): AnalysisSequenceFacts {
  const has = (index: number) => index < n;
  return {
    areaLabel: has(0) ? "Nevada County, California" : null,
    networkCount: has(1) ? 1 : 0,
    scenarioSetCount: has(2) ? 1 : 0,
    modelCount: has(3) ? 1 : 0,
    runCount: has(4) ? 1 : 0,
    aequilibraeRunCount: has(4) ? 1 : 0,
    activitySimRunCount: has(5) ? 1 : 0,
    checkedRunCount: has(6) ? 1 : 0,
    comparisonPacketCount: has(7) ? 1 : 0,
    unreadable: [],
  };
}

describe("the analysis sequence states one order", () => {
  it("names nine steps, ending at the claim boundary", () => {
    expect(ANALYSIS_STEPS.map((step) => step.id)).toEqual([...ANALYSIS_STEP_IDS]);
    expect(ANALYSIS_STEPS).toHaveLength(9);
    expect(ANALYSIS_STEPS[ANALYSIS_STEPS.length - 1].id).toBe(CLAIM_STEP_ID);
  });

  it("marks exactly one step as the next thing to do, at every point in the walk", () => {
    // Eight prefixes: nothing done, through every task done. The ninth step is
    // never done, so there is always exactly one `next`.
    for (let done = 0; done <= 8; done += 1) {
      const steps = resolveAnalysisSequence(factsSatisfying(done));
      const nexts = steps.filter((step) => step.state === "next");
      expect(nexts, `with ${done} step(s) satisfied`).toHaveLength(1);
      expect(nexts[0].id).toBe(ANALYSIS_STEP_IDS[Math.min(done, 8)]);

      // Everything before the next step is done; everything after is waiting.
      steps.slice(0, done).forEach((step) => expect(step.state).toBe("done"));
      steps.slice(done + 1).forEach((step) => expect(step.state).toBe("waiting"));
    }
  });

  it("tells a waiting step what it is waiting on, by name", () => {
    const steps = resolveAnalysisSequence(EMPTY);
    const waiting = steps.filter((step) => step.state === "waiting");
    expect(waiting).toHaveLength(8);
    for (const step of waiting) {
      expect(step.waitingOn).toBe(ANALYSIS_STEPS[0].title);
    }
    expect(steps[0].waitingOn).toBeNull();
  });

  it("reports a failed read as unknown, never as work the planner has not done", () => {
    // The whole point: "you have not picked an area yet" is a statement about
    // the agency, and a query that failed cannot make it.
    const steps = resolveAnalysisSequence({ ...EMPTY, unreadable: ["area"] });
    const area = steps.find((step) => step.id === "area");
    expect(area?.state).toBe("unknown");
    expect(area?.standing).toContain("could not be read");
    expect(area?.standing).not.toContain("Nothing chosen yet");

    // And an unreadable step does not hand the "next" badge to the step after
    // it — the unread one may well be exactly what that step is waiting for.
    expect(steps.filter((step) => step.state === "next")).toHaveLength(0);
    expect(steps[1].state).toBe("waiting");
    expect(steps[1].waitingOn).toBe(ANALYSIS_STEPS[0].title);
  });

  it("never lets an unreadable step read as done", () => {
    for (const id of ANALYSIS_STEP_IDS) {
      const steps = resolveAnalysisSequence({ ...COMPLETE, unreadable: [id as AnalysisStepId] });
      expect(steps.find((step) => step.id === id)?.state).toBe("unknown");
    }
  });

  it("does not advance a guided comparison after only one ActivitySim scenario", () => {
    const steps = resolveAnalysisSequence({
      ...COMPLETE,
      guidedProjectComparison: true,
      aequilibraeRunCount: 2,
      activitySimRunCount: 1,
      checkedRunCount: 0,
      comparisonPacketCount: 0,
    });
    expect(steps.find((step) => step.id === "activitysim_run")).toMatchObject({
      state: "next",
      standing: "1/2 successful ActivitySim scenario jobs are on file.",
    });
    expect(steps.find((step) => step.id === "check")?.state).toBe("waiting");
  });
});

describe("the sequence never claims the caveat has been cleared", () => {
  const claim = PROTECTED_CLAIMS.find((entry) => entry.id === "screening-grade");

  it("ships Help's own sentence, not a second copy of it", () => {
    const step = ANALYSIS_STEPS.find((entry) => entry.id === CLAIM_STEP_ID);
    expect(step?.what).toBe(SCREENING_GRADE_SUMMARY);
  });

  it("keeps both halves of the screening-grade boundary in the sentence it ships", () => {
    expect(claim).toBeDefined();
    const step = ANALYSIS_STEPS.find((entry) => entry.id === CLAIM_STEP_ID);
    const text = (step?.what ?? "").toLowerCase();
    expect(
      claim!.permission.some((token) => text.includes(token.toLowerCase())),
      "nothing in the last step says what a planner MAY conclude"
    ).toBe(true);
    expect(
      claim!.prohibition.some((token) => text.includes(token.toLowerCase())),
      "nothing in the last step says what they may NOT conclude"
    ).toBe(true);
  });

  it("says the same thing to an agency that has cleared the screening gate", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A finished checklist reads as
    // permission. The seventh step is not a task, is never done, and its
    // sentence does not get shorter when the sixth one passes.
    const before = resolveAnalysisSequence(EMPTY).find((step) => step.id === CLAIM_STEP_ID);
    const after = resolveAnalysisSequence(COMPLETE).find((step) => step.id === CLAIM_STEP_ID);

    expect(after?.state).not.toBe("done");
    expect(after?.what).toBe(before?.what);
    expect(after?.what).toBe(SCREENING_GRADE_SUMMARY);

    // The standing line may differ — it reports what is on file — but it may
    // never withdraw the caveat by calling the result finished.
    expect(after?.standing).toContain("still a screening result");
  });

  it("never marks the claim step done, whatever the facts say", () => {
    const shapes: AnalysisSequenceFacts[] = [
      EMPTY,
      COMPLETE,
      { ...COMPLETE, checkedRunCount: 99 },
      { ...COMPLETE, unreadable: ["check"] },
    ];
    for (const facts of shapes) {
      const claimStep = resolveAnalysisSequence(facts).find((step) => step.id === CLAIM_STEP_ID);
      expect(claimStep?.state).not.toBe("done");
    }
  });
});

describe("the sequence speaks the planner's language", () => {
  /** Every sentence the sequence can put on screen, across every state. */
  function allCopy(): string[] {
    const copy: string[] = [];
    for (const step of ANALYSIS_STEPS) copy.push(step.title, step.what, step.hrefLabel ?? "");
    for (const facts of [EMPTY, COMPLETE, { ...EMPTY, unreadable: [...ANALYSIS_STEP_IDS] }]) {
      for (const step of resolveAnalysisSequence(facts as AnalysisSequenceFacts)) {
        copy.push(step.standing, step.waitingOn ?? "");
      }
    }
    return copy.filter(Boolean);
  }

  /**
   * The ledger's matcher, reproduced here for one reason: the copy guard scans
   * `.tsx` text nodes and a fixed list of copy modules, and this sequence's
   * sentences live in a `.ts` file under `src/components`, which that scan does
   * not reach. Without this the strip would be the one screen in the product
   * whose words nothing checks.
   */
  function termPattern(term: string): RegExp {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}(?:s|es|ed|ing)?\\b`, "gi");
  }

  function offendersIn(strings: readonly string[]): string[] {
    const found: string[] = [];
    for (const entry of BANNED_TERMS) {
      const pattern = termPattern(entry.term);
      for (const text of strings) {
        if (pattern.test(text)) found.push(`${entry.term} — in “${text}” — say instead: ${entry.say}`);
        pattern.lastIndex = 0;
      }
    }
    return found;
  }

  it("can still see a violation", () => {
    // NEGATIVE CONTROL. Without it every assertion below could pass by finding
    // nothing, which is how an unchecked area becomes one everybody believes is
    // checked.
    expect(offendersIn(["Review the delivery posture of this packet record."])).not.toEqual([]);
    expect(offendersIn(["Say where you are planning, then run it."])).toEqual([]);
    expect(allCopy().length).toBeGreaterThan(30);
  });

  it("uses no term from the jargon ledger", () => {
    // The screening-grade sentence is Help's and is protected wording; it is
    // exempt from the vocabulary rule, never from the meaning rule above.
    const copy = allCopy().filter((text) => text !== SCREENING_GRADE_SUMMARY);
    expect(
      offendersIn(copy),
      "The analysis sequence is the first thing a planner reads on four pages. " +
        "src/test/helpers/jargon-ledger.ts says what to say instead."
    ).toEqual([]);
  });
});
