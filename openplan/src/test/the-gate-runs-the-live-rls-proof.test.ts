import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// @ts-expect-error — plain ESM script, no types; the gate step must be able to
// run it with bare `node` before anything is compiled.
import { decideRlsGate } from "../../scripts/ops/rls-gate.mjs";

/**
 * THE PRE-SHIP GATE MUST REACH THE LIVE RLS PROOF.
 *
 * WHERE THIS CAME FROM. `RLS Isolation` was red on main for three and a half
 * days and 48 consecutive pushes, reporting five workspace-scoped tables with
 * no isolation probe — one of them `safety_crash_parties`, a row per person
 * hurt in a collision. `npm run qa:gate` was green for every one of those
 * pushes, because the census that failed lives in `test:rls-live` and the gate
 * did not run it.
 *
 * So this holds two things that must not drift apart: the gate invokes the
 * proof, and the proof's skip path stays honest.
 */
describe("the gate runs the live RLS proof", () => {
  it("wires the proof into qa:gate", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(
      pkg.scripts["qa:gate"],
      "qa:gate no longer runs scripts/ops/rls-gate.mjs — the live tenant-isolation proof is back outside the gate, which is exactly how it stayed red for three and a half days unnoticed"
    ).toContain("scripts/ops/rls-gate.mjs");
  });

  it("runs the proof when a stack is up", () => {
    expect(
      decideRlsGate({ statusOk: true, statusOutput: 'DB_URL="postgresql://postgres@127.0.0.1:54322/postgres"\n' })
    ).toMatchObject({ action: "run" });
  });

  it("skips when there is no stack, rather than failing a runner that has none", () => {
    // ci.yml runs qa:gate with no Supabase; the live proof has its own workflow
    // there. Failing here would break that job for an unrelated reason.
    expect(decideRlsGate({ statusOk: false, statusOutput: "" })).toMatchObject({ action: "skip" });
  });

  it("does not trust a DB_URL printed by a command that then failed", () => {
    /*
      THE MUTATION THAT SURVIVED, and why this case exists. The first version of
      this test only offered `statusOk: false` alongside empty output — so the
      exit-code branch could be deleted entirely and every assertion still
      passed, because the missing-DB_URL branch caught the same input. A stack
      that is going down prints its env and THEN fails; that output is stale and
      connecting to it is what the exit code is there to prevent.
    */
    expect(
      decideRlsGate({
        statusOk: false,
        statusOutput: 'DB_URL="postgresql://postgres@127.0.0.1:54322/postgres"\n',
      })
    ).toMatchObject({ action: "skip" });
  });

  it("skips when the stack answers but is not really up", () => {
    /*
      A half-started stack answers `supabase status` and prints nothing useful.
      Treating that as "run" would fail the gate with a connection error and
      teach whoever hit it to delete this step.
    */
    expect(decideRlsGate({ statusOk: true, statusOutput: "API_URL=\n" })).toMatchObject({ action: "skip" });
    expect(decideRlsGate({ statusOk: true, statusOutput: undefined })).toMatchObject({ action: "skip" });
  });

  it("says what went unproven when it skips", () => {
    // A silent skip is the failure being guarded against, one level up: the
    // reason must name the stack, so the line is actionable rather than noise.
    const skipped = decideRlsGate({ statusOk: false, statusOutput: "" }) as { reason: string };
    expect(skipped.reason).toMatch(/stack/i);
  });
});
