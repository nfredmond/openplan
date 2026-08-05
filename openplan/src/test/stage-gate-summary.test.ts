import { describe, expect, it } from "vitest";
import {
  buildProjectStageGateSnapshot,
  buildProjectStageGateSummary,
} from "@/lib/stage-gates/summary";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * Every call names the template it builds on. The registry-default fallback is
 * gone: with two templates registered it silently rendered the DEFAULT's gate
 * vocabulary over a differently-bound workspace's decisions, which is why the
 * gate ids below are pinned to the CA template rather than to "whatever the
 * default is".
 */
const CA_TEMPLATE_ID = "ca_stage_gates_v0_1";

describe("buildProjectStageGateSummary", () => {
  it("uses the latest decision per gate and exposes next/blocked workflow cues", () => {
    const summary = buildProjectStageGateSummary(
      [
        {
          gate_id: "G01_INITIATION_AUTHORIZATION",
          decision: "PASS",
          rationale: "Charter and authorization packet complete.",
          decided_at: "2026-03-17T20:00:00.000Z",
          missing_artifacts: [],
          project_id: PROJECT_ID,
        },
        {
          gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
          decision: "HOLD",
          rationale: "Civil rights plan is still missing.",
          decided_at: "2026-03-17T21:00:00.000Z",
          missing_artifacts: ["G02_E03"],
          project_id: PROJECT_ID,
        },
        {
          gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
          decision: "PASS",
          rationale: "Older decision should be ignored.",
          decided_at: "2026-03-16T21:00:00.000Z",
          missing_artifacts: [],
          project_id: PROJECT_ID,
        },
      ],
      { templateId: CA_TEMPLATE_ID, projectId: PROJECT_ID }
    );

    expect(summary.templateId).toBe("ca_stage_gates_v0_1");
    expect(summary.totalGateCount).toBe(9);
    expect(summary.passCount).toBe(1);
    expect(summary.holdCount).toBe(1);
    expect(summary.notStartedCount).toBe(7);
    expect(summary.blockedGate?.gateId).toBe("G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");
    expect(summary.blockedGate?.missingArtifacts).toEqual(["G02_E03"]);
    expect(summary.nextGate?.gateId).toBe("G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");

    const gateTwo = summary.gates.find((gate) => gate.gateId === "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");
    expect(gateTwo?.workflowState).toBe("hold");
    expect(gateTwo?.rationale).toBe("Civil rights plan is still missing.");
    expect(gateTwo?.requiredEvidenceCount).toBeGreaterThan(0);
    expect(gateTwo?.operatorControlEvidenceCount).toBe(1);

    const gateEight = summary.gates.find((gate) => gate.gateId === "G08_CONSTRUCTION_ADMINISTRATION");
    expect(gateEight?.operatorControlEvidenceCount).toBe(2);
    expect(gateEight?.evidencePreview[0]?.operatorControlTitle).toBe("Daily reports + progress payment records");
  });

  it("cannot be called without naming the bound template", () => {
    // The registry-default fallback is DELETED, at the type level: omitting
    // `templateId` (or the whole options object) no longer compiles. This is
    // what makes "the caller resolved the workspace binding" structural rather
    // than a convention — a caller that skipped the resolution has nothing to
    // pass here. The closure is never invoked; the assertions are the two
    // expect-error directives inside it, which fail the BUILD if the fallback returns.
    const doesNotCompile = () => {
      // @ts-expect-error templateId is required — there is no default-template fallback
      buildProjectStageGateSummary([], { projectId: PROJECT_ID });
      // @ts-expect-error the options object itself is required
      buildProjectStageGateSummary([]);
    };
    expect(typeof doesNotCompile).toBe("function");

    // And an untyped caller that reaches the same omission at runtime gets the
    // refusal, not a bare TypeError.
    expect(() =>
      buildProjectStageGateSummary([], { projectId: PROJECT_ID } as unknown as Parameters<
        typeof buildProjectStageGateSummary
      >[1])
    ).toThrow(/Refusing to build a stage-gate board without a bound template id/);
  });

  it("refuses a blank template id rather than substituting any template", () => {
    expect(() => buildProjectStageGateSummary([], { templateId: "   " })).toThrow(
      /Refusing to build a stage-gate board without a bound template id/
    );
  });

  it("refuses to render gates for a template it cannot resolve", () => {
    // Falling back to the default here would show California's statutory gates
    // under another jurisdiction's template id.
    expect(() => buildProjectStageGateSummary([], { templateId: "oh_stage_gates_v1" })).toThrow(
      "Unsupported stage-gate template: oh_stage_gates_v1"
    );
  });

  it("marks untouched gates as not started", () => {
    const summary = buildProjectStageGateSummary([], { templateId: CA_TEMPLATE_ID });

    expect(summary.passCount).toBe(0);
    expect(summary.holdCount).toBe(0);
    expect(summary.notStartedCount).toBe(summary.totalGateCount);
    expect(summary.nextGate?.workflowState).toBe("not_started");
    expect(summary.nextGate?.operatorControlEvidenceCount).toBeGreaterThanOrEqual(0);
  });

  it("says a gate with no decision has none, never that it failed", () => {
    const gate = buildProjectStageGateSummary([], { templateId: CA_TEMPLATE_ID }).gates[0];

    expect(gate.decisionLabel).toBe("No decision recorded");
    expect(gate.rationale).toContain("absence of a decision, not a failure to pass");
    // The words a gate board must never put on an undecided gate.
    expect(gate.decisionLabel.toLowerCase()).not.toContain("fail");
    expect(gate.rationale.toLowerCase()).not.toContain("not passed");
  });
});

/**
 * The two zeros a compliance cockpit must never confuse.
 *
 * An empty decision list means "the log was read and holds nothing". An
 * unreadable log means nothing at all is established. Both used to render nine
 * gates saying "no decision recorded" — so a dropped column or a policy change
 * became a confident sentence about a planner's compliance posture.
 */
describe("an unreadable decision log does not read as an empty one", () => {
  const readFailure = { reason: 'column "project_id" does not exist' };

  it("marks every gate unknown rather than undecided", () => {
    const summary = buildProjectStageGateSummary([], { templateId: CA_TEMPLATE_ID, decisionsUnavailable: readFailure });

    expect(summary.decisionsRead).toEqual({ readable: false, reason: readFailure.reason });
    expect(summary.unknownCount).toBe(summary.totalGateCount);
    expect(summary.notStartedCount).toBe(0);
    expect(summary.gates.every((gate) => gate.workflowState === "unknown")).toBe(true);
    expect(summary.gates[0].decisionLabel).toBe("Not readable");
    expect(summary.gates[0].rationale).toContain(readFailure.reason);
    expect(summary.gates[0].rationale).toContain("not that none was recorded");
  });

  it("refuses to claim nothing is on hold", () => {
    const summary = buildProjectStageGateSummary([], { templateId: CA_TEMPLATE_ID, decisionsUnavailable: readFailure });

    // `blockedGate: null` is what the board renders as "no gate on formal hold".
    // It is only honest next to `decisionsRead.readable === false`.
    expect(summary.blockedGate).toBeNull();
    expect(summary.holdCount).toBe(0);
    expect(summary.decisionsRead.readable).toBe(false);
  });

  it("ignores rows it was handed, because a failed read has no rows to trust", () => {
    const summary = buildProjectStageGateSummary(
      [
        {
          gate_id: "G01_INITIATION_AUTHORIZATION",
          decision: "PASS",
          rationale: "Stale rows from a partially-failed read.",
          decided_at: "2026-03-17T20:00:00.000Z",
          missing_artifacts: [],
          project_id: PROJECT_ID,
        },
      ],
      { templateId: CA_TEMPLATE_ID, decisionsUnavailable: readFailure }
    );

    expect(summary.passCount).toBe(0);
    expect(summary.unknownCount).toBe(summary.totalGateCount);
  });

  it("refuses to freeze an unread log into a report snapshot", () => {
    // A snapshot is durable evidence written into a report packet. Minting one
    // here would record a database error as a compliance posture, permanently,
    // with nothing downstream able to tell the difference.
    const summary = buildProjectStageGateSummary([], { templateId: CA_TEMPLATE_ID, decisionsUnavailable: readFailure });

    expect(() => buildProjectStageGateSnapshot(summary)).toThrow(
      /Refusing to snapshot stage gates/
    );
  });

  it("still snapshots a log that was read and is simply empty", () => {
    const snapshot = buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: CA_TEMPLATE_ID }));

    expect(snapshot.passCount).toBe(0);
    expect(snapshot.notStartedCount).toBeGreaterThan(0);
  });
});

/**
 * `stage_gate_decisions` had no project_id until 20260728000011, so every reader
 * queried the workspace and every project's board showed every project's
 * verdicts. Scoping was opt-in for one change only, while the remaining readers
 * were converted; it is now mandatory for any decision set, because the
 * surfaces downstream of this builder — the assistant, the report detail page,
 * the packet generator — restate the board as a claim about the project in
 * front of the reader, and a generated packet goes to a funder.
 */
describe("a decision recorded on one project does not appear on another", () => {
  const projectA = PROJECT_ID;
  const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const decisions = [
    {
      gate_id: "G01_INITIATION_AUTHORIZATION",
      decision: "PASS",
      rationale: "Project A charter approved.",
      decided_at: "2026-03-17T20:00:00.000Z",
      missing_artifacts: [],
      project_id: projectA,
    },
    {
      gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
      decision: "HOLD",
      rationale: "Project B civil rights plan missing.",
      decided_at: "2026-03-18T20:00:00.000Z",
      missing_artifacts: ["G02_E03"],
      project_id: projectB,
    },
  ];

  it("counts only the scoped project's decisions", () => {
    const summary = buildProjectStageGateSummary(decisions, { templateId: CA_TEMPLATE_ID, projectId: projectA });

    expect(summary.passCount).toBe(1);
    expect(summary.holdCount).toBe(0);
    expect(summary.blockedGate).toBeNull();
  });

  it("excludes an unattributed decision rather than treating it as a wildcard", () => {
    // A row with no project is not evidence about THIS project. Reading NULL as
    // "applies to all" is the defect the column was added to fix.
    const summary = buildProjectStageGateSummary(
      [{ ...decisions[0], project_id: null }],
      { templateId: CA_TEMPLATE_ID, projectId: projectA }
    );

    expect(summary.passCount).toBe(0);
    expect(summary.notStartedCount).toBe(summary.totalGateCount);
  });

  it("refuses to build a board at all from decisions that name no project", () => {
    // This is the inversion of the rule this suite used to pin. Reading the
    // workspace and rendering the result on one project's board was the old
    // behaviour, and it is what let a report packet assert a gate that passed
    // on a DIFFERENT project. An unscoped board is wrong in a way no reader can
    // see, so it is refused rather than produced.
    expect(() => buildProjectStageGateSummary(decisions, { templateId: CA_TEMPLATE_ID })).toThrow(
      /Refusing to build a stage-gate board from decisions that are not scoped to a project/
    );
  });

  it("refuses rows whose read left out project_id, instead of blanking the board", () => {
    // The select list is not checked against the schema anywhere in this
    // codebase, so an omitted column would otherwise drop every decision and
    // render nine gates reading "no decision recorded" — a total loss of the
    // log wearing the face of an empty one.
    const rowsWithoutTheColumn = decisions.map(({ project_id: _ignored, ...rest }) => rest);

    expect(() =>
      buildProjectStageGateSummary(rowsWithoutTheColumn, { templateId: CA_TEMPLATE_ID, projectId: projectA })
    ).toThrow(/the rows carry no `project_id` field/);
  });

  it("still builds a template-shaped board from an empty log with no project named", () => {
    // A log with nothing in it has nothing to misattribute, so the refusal does
    // not reach the surfaces that only want the gate shape.
    const summary = buildProjectStageGateSummary([], { templateId: CA_TEMPLATE_ID });

    expect(summary.notStartedCount).toBe(summary.totalGateCount);
    expect(summary.decisionsRead).toEqual({ readable: true });
  });
});
