import { describe, expect, it, vi } from "vitest";
import {
  loadProjectStageGateBoard,
  PROJECT_STAGE_GATE_DECISION_COLUMNS,
  type StageGateDecisionQuerySupabaseLike,
} from "@/lib/stage-gates/decision-queries";

/**
 * The loader that replaced the project page's inline decision read.
 *
 * It carries two rules the inline version got wrong: the query is scoped to the
 * project (a workspace-wide read showed one project's verdicts on every other
 * project's board), and a failed read is reported as a failure rather than
 * rendered as an empty log.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function fakeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const limit = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  const order = vi.fn(() => ({ limit }));
  const eqProject = vi.fn(() => ({ order }));
  const eqWorkspace = vi.fn(() => ({ eq: eqProject }));
  const select = vi.fn(() => ({ eq: eqWorkspace }));
  const from = vi.fn(() => ({ select }));

  return {
    client: { from } as unknown as StageGateDecisionQuerySupabaseLike,
    spies: { from, select, eqWorkspace, eqProject, order, limit },
  };
}

describe("the gate board reads only this project's decisions", () => {
  it("filters on both workspace and project", async () => {
    const { client, spies } = fakeClient({ data: [] });

    await loadProjectStageGateBoard(client, {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      templateId: "ca_stage_gates_v0_1",
    });

    expect(spies.from).toHaveBeenCalledWith("stage_gate_decisions");
    expect(spies.select).toHaveBeenCalledWith(PROJECT_STAGE_GATE_DECISION_COLUMNS);
    expect(spies.eqWorkspace).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(spies.eqProject).toHaveBeenCalledWith("project_id", PROJECT_ID);
    expect(spies.order).toHaveBeenCalledWith("decided_at", { ascending: false });
  });

  it("selects project_id, so the summary's project filter has something to match on", () => {
    // Omitting the column would make every row fail the scope check and blank
    // the board — a silent loss rather than a visible error.
    expect(PROJECT_STAGE_GATE_DECISION_COLUMNS).toContain("project_id");
  });

  it("refuses to load a board when the caller could not resolve a binding", async () => {
    // `null` is the caller saying "I resolved the binding and it did not
    // resolve". There is no registry-default fallback to fall into any more:
    // rendering another template's gates here is the defect this signature
    // change deleted, so the loader refuses loudly instead.
    const { client, spies } = fakeClient({ data: [] });

    await expect(
      loadProjectStageGateBoard(client, {
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        templateId: null,
      })
    ).rejects.toThrow(/Refusing to load a stage-gate board without a bound template/);
    // And it never touched the database: there is no board to build.
    expect(spies.from).not.toHaveBeenCalled();
  });

  it("builds the board on the template the workspace is BOUND to", async () => {
    const { client } = fakeClient({ data: [] });

    const board = await loadProjectStageGateBoard(client, {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      templateId: "ca_stage_gates_v0_1",
    });

    expect(board.summary.templateId).toBe("ca_stage_gates_v0_1");
  });

  it("reports a failed read as unreadable rather than as an empty log", async () => {
    const { client } = fakeClient({ error: { message: 'column "project_id" does not exist' } });

    const board = await loadProjectStageGateBoard(client, {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      templateId: "ca_stage_gates_v0_1",
    });

    expect(board.summary.decisionsRead).toEqual({
      readable: false,
      reason: 'column "project_id" does not exist',
    });
    expect(board.summary.unknownCount).toBe(board.summary.totalGateCount);
    expect(board.summary.notStartedCount).toBe(0);
    // No rows are handed on either: a failed read has nothing to hand on.
    expect(board.decisions).toEqual([]);
  });

  it("reports an empty log as an empty log", async () => {
    const { client } = fakeClient({ data: [] });

    const board = await loadProjectStageGateBoard(client, {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      templateId: "ca_stage_gates_v0_1",
    });

    expect(board.summary.decisionsRead).toEqual({ readable: true });
    expect(board.summary.notStartedCount).toBe(board.summary.totalGateCount);
    expect(board.summary.unknownCount).toBe(0);
  });

  it("counts a decision recorded on this project", async () => {
    const { client } = fakeClient({
      data: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          project_id: PROJECT_ID,
          gate_id: "G01_INITIATION_AUTHORIZATION",
          decision: "PASS",
          rationale: "Charter approved.",
          decided_at: "2026-07-28T12:00:00.000Z",
          missing_artifacts: [],
        },
      ],
    });

    const board = await loadProjectStageGateBoard(client, {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      templateId: "ca_stage_gates_v0_1",
    });

    expect(board.summary.passCount).toBe(1);
    expect(board.decisions).toHaveLength(1);
  });
});
