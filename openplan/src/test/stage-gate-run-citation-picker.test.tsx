import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  StageGateDecisionRecorder,
  type StageGateRunOptions,
} from "@/components/projects/stage-gate-decision-recorder";
import { ProjectStageGateBoard } from "@/components/projects/project-stage-gate-board";
import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";

/**
 * The run-citation picker: a planner cites a run by choosing it from the runs
 * the page already loaded, not by pasting a uuid. Pasting stays available as an
 * explicit fallback, and a citation kind the page loaded no list for keeps the
 * plain id field.
 *
 * BINDING IS VARIED on purpose: the two model-run fixtures have different ids
 * and different tests pick different ones, so a component that hardcodes (or
 * always submits the first / last option) fails here instead of passing on a
 * fixture that cannot tell "threads the choice" from "invents it".
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

const MODEL_RUN_A = {
  id: "aaaa1111-2222-4333-8444-555566667777",
  title: "Sketch run alpha",
  status: "succeeded",
  createdAt: "2026-08-01T12:00:00Z",
};
const MODEL_RUN_B = {
  id: "bbbb8888-9999-4aaa-8bbb-ccccddddeeee",
  title: "Sketch run beta",
  status: "succeeded",
  createdAt: "2026-08-02T12:00:00Z",
};
const ANALYSIS_RUN = {
  id: "cccc0000-1111-4222-8333-444455556666",
  title: "Corridor screening",
  createdAt: "2026-07-15T09:00:00Z",
};

const RUN_OPTIONS: StageGateRunOptions = {
  modelRunId: [MODEL_RUN_A, MODEL_RUN_B],
  runId: [ANALYSIS_RUN],
  // countyRunId deliberately absent: the project page loads no such list.
};

// No default: `renderRecorder()` really renders WITHOUT lists (a JS default
// parameter would silently substitute RUN_OPTIONS for an explicit undefined).
function renderRecorder(runOptions?: StageGateRunOptions) {
  return render(
    <StageGateDecisionRecorder
      workspaceId={WORKSPACE_ID}
      projectId={PROJECT_ID}
      canWrite
      gate={{ gateId: "G01_INITIATION_AUTHORIZATION", gateName: "Initiation", sequence: 1 }}
      runOptions={runOptions}
    />
  );
}

function openFormWithRationale() {
  fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
  fireEvent.change(screen.getByPlaceholderText(/Why this gate passes/), {
    target: { value: "Evidence run supports this gate." },
  });
}

function chooseCitationKind(kind: string) {
  fireEvent.change(screen.getByDisplayValue("No run cited"), { target: { value: kind } });
}

function lastFetchBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const [, init] = calls[calls.length - 1];
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ created: true, record: { id: "d1" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  );
});

describe("the run citation is picked from runs the page loaded", () => {
  it("offers the real runs from props, not a uuid field", () => {
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("modelRunId");

    // Both offered runs render, named by their own titles and statuses.
    expect(screen.getByRole("option", { name: /Sketch run alpha · succeeded/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Sketch run beta · succeeded/ })).toBeInTheDocument();
    // The manual uuid field is the fallback, not the default, when a list exists.
    expect(screen.queryByPlaceholderText("00000000-0000-0000-0000-000000000000")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste an id instead" })).toBeInTheDocument();
  });

  it("submits the id of the run the planner chose (second option)", async () => {
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("modelRunId");

    fireEvent.change(screen.getByDisplayValue("Choose a run…"), { target: { value: MODEL_RUN_B.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(lastFetchBody()).toMatchObject({ modelRunId: MODEL_RUN_B.id });
  });

  it("submits the id of the run the planner chose (first option) — the binding is not a constant", async () => {
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("modelRunId");

    fireEvent.change(screen.getByDisplayValue("Choose a run…"), { target: { value: MODEL_RUN_A.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(lastFetchBody()).toMatchObject({ modelRunId: MODEL_RUN_A.id });
  });

  it("offers Analysis Studio runs from their own list", async () => {
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("runId");

    fireEvent.change(screen.getByDisplayValue("Choose a run…"), { target: { value: ANALYSIS_RUN.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(lastFetchBody()).toMatchObject({ runId: ANALYSIS_RUN.id });
  });

  it("refuses to submit a picker left on no selection, without dropping the citation silently", async () => {
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("modelRunId");

    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("would be recorded as no citation at all");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not carry a chosen id across a change of citation kind", async () => {
    // The three kinds cite three different run tables; an id picked as a model
    // run must not silently ride along as an Analysis Studio citation.
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("modelRunId");
    fireEvent.change(screen.getByDisplayValue("Choose a run…"), { target: { value: MODEL_RUN_B.id } });

    fireEvent.change(screen.getByDisplayValue("Model run"), { target: { value: "runId" } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("would be recorded as no citation at all");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("pasting an id stays available", () => {
  it("switches to a manual id field on request and submits the typed id", async () => {
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("modelRunId");

    fireEvent.click(screen.getByRole("button", { name: "Paste an id instead" }));
    const manualId = "dddd7777-8888-4999-8aaa-bbbbccccdddd";
    fireEvent.change(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000"), {
      target: { value: manualId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(lastFetchBody()).toMatchObject({ modelRunId: manualId });
  });

  it("keeps the manual field, with no picker, for a kind the page loaded no list for", () => {
    renderRecorder(RUN_OPTIONS);
    openFormWithRationale();
    chooseCitationKind("countyRunId");

    expect(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Choose a run…" })).not.toBeInTheDocument();
    // No list means nothing to "choose instead" from.
    expect(screen.queryByRole("button", { name: "Choose from the list instead" })).not.toBeInTheDocument();
  });

  it("behaves exactly as before when no lists are provided at all", () => {
    renderRecorder(undefined);
    openFormWithRationale();
    chooseCitationKind("modelRunId");

    expect(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste an id instead" })).not.toBeInTheDocument();
  });
});

describe("the board threads the run lists through to the recorder", () => {
  it("a run passed to the board is offered — and submitted — by the recorder inside it", async () => {
    render(
      <ProjectStageGateBoard
        stageGateSummary={buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })}
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        canRecordDecision
        runOptions={RUN_OPTIONS}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Record decision" })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Why this gate passes/), {
      target: { value: "Cited run reviewed." },
    });
    fireEvent.change(screen.getByDisplayValue("No run cited"), { target: { value: "modelRunId" } });
    fireEvent.change(screen.getByDisplayValue("Choose a run…"), { target: { value: MODEL_RUN_B.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(lastFetchBody()).toMatchObject({ modelRunId: MODEL_RUN_B.id });
  });
});
