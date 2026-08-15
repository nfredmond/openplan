import { describe, expect, it } from "vitest";

import { describeWorkerQueueRisk } from "@/lib/models/worker-backed-launch";

/**
 * THE FIRST RUN ON A FRESH INSTALL MUST BE TOLD WHAT HAPPENS IF NOTHING TAKES IT.
 *
 * WHERE THIS CAME FROM. A tester read the deployment-health panel, worked out
 * for themselves that a first traffic-model run could be queued, wait, and fail
 * with nobody told, and filed it as a blocker. They were reasoning around a
 * sentence that should have told them.
 *
 * OpenPlan already handles this well almost everywhere: launches are refused
 * when a deployment declares no worker, stalled runs are reaped to a truthful
 * `failed`, and failed runs are ordered FIRST on the dashboard's next-action
 * board. The gap was one branch — no declaration either way and no run history,
 * which is exactly a new planner on a fresh install. It said only "It finishes
 * only while a modeling worker is checking this installation for runs": true,
 * and useless to somebody about to press the button.
 *
 * WHAT IS ASSERTED: the honest-uncertainty branch names the consequence, names
 * the end state, and says nothing will come and tell them. And it does NOT
 * assert a worker is missing — OpenPlan cannot know that, and saying it would
 * trade one wrong sentence for another.
 */
describe("the first run is told what happens", () => {
  const firstRun = describeWorkerQueueRisk("unknown", null);

  it("says nobody has confirmed a worker, rather than asserting there is none", () => {
    expect(firstRun).toMatch(/nobody has told openplan/i);
    // The thing it must not claim: that a worker is definitely absent.
    expect(firstRun).not.toMatch(/no worker runs against it|declares that no/i);
  });

  it("names the end state, not just the condition for success", () => {
    // The old sentence described only what success required. A planner needs the
    // other branch of that sentence.
    expect(firstRun).toMatch(/sit queued/i);
    expect(firstRun).toMatch(/marked failed|be failed/i);
  });

  it("says nothing will notify them", () => {
    // This was the tester's actual complaint, and the reason a silent failure
    // costs a day rather than a minute.
    expect(firstRun).toMatch(/nothing will notify you/i);
  });

  it("promises no timing it cannot keep", () => {
    // Reaping depends on a sweep an operator also has to configure. A number
    // here would be a second claim about a second thing nobody can check.
    expect(firstRun).not.toMatch(/\b\d+\s*(minute|minutes|hour|hours)\b/i);
  });

  it("still says the plain thing when the deployment declares no worker", () => {
    const declaredAbsent = describeWorkerQueueRisk("absent", null);
    expect(declaredAbsent).toMatch(/sit queued/i);
    expect(declaredAbsent).toMatch(/failed rather than finishing/i);
  });
});
