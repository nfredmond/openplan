import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectStageGateBoard } from "@/components/projects/project-stage-gate-board";
import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function renderBoard(
  options: Partial<Parameters<typeof buildProjectStageGateSummary>[1]> & { canRecordDecision?: boolean } = {}
) {
  const { canRecordDecision = true, ...summaryOptions } = options;
  // Pinned to the CA template: these assertions count its nine gates, and the
  // builder no longer has a registry-default fallback to lean on.
  return render(
    <ProjectStageGateBoard
      stageGateSummary={buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1", ...summaryOptions })}
      workspaceId={WORKSPACE_ID}
      projectId={PROJECT_ID}
      canRecordDecision={canRecordDecision}
    />
  );
}

describe("the stage-gate cockpit tells an unread log apart from an empty one", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints counts when the decision log loaded", () => {
    renderBoard();

    expect(screen.getAllByText("No decision recorded").length).toBeGreaterThan(0);
    // Nine template gates, none decided — a real finding, so a real number.
    expect(screen.getAllByText("9").length).toBeGreaterThan(0);
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("refuses to print a count when the decision log did not load", () => {
    renderBoard({ decisionsUnavailable: { reason: 'relation "stage_gate_decisions" does not exist' } });

    // "0 pass gates" is a claim about a planner's compliance posture that a
    // failed query has not earned. The em dash is the refusal.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/could not be read/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/does not exist/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Nothing below is a finding/i)).toBeInTheDocument();
    // Every gate row says "Not readable", never "No decision recorded".
    expect(screen.getAllByText("Not readable").length).toBe(9);
    expect(screen.queryByText("No decision recorded")).not.toBeInTheDocument();
  });

  it("does not claim nothing is on hold when it could not look", () => {
    renderBoard({ decisionsUnavailable: { reason: "permission denied" } });

    expect(screen.queryByText("No gate currently on formal hold")).not.toBeInTheDocument();
    expect(screen.getByText("Whether any gate is on hold is unknown")).toBeInTheDocument();
  });

  it("does not name a next gate, or hand out its evidence homework, when it could not look", () => {
    // The readiness cue is derived entirely from which gates have passed. With
    // the log unread the builder still returns the first gate, so this panel
    // would have named it and said "Build the evidence pack before expecting a
    // pass decision" — a work instruction premised on a sequencing fact nothing
    // established, two rows below a card that refuses to print the same fact.
    renderBoard({ decisionsUnavailable: { reason: "permission denied" } });

    expect(screen.getByText("Which gate is next is unknown")).toBeInTheDocument();
    expect(screen.queryByText(/G01_INITIATION_AUTHORIZATION ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Build the evidence pack/)).not.toBeInTheDocument();
    expect(screen.queryByText(/required evidence item/)).not.toBeInTheDocument();
  });

  it("names the next gate normally when the log did load", () => {
    renderBoard();

    expect(screen.getByText(/G01_INITIATION_AUTHORIZATION ·/)).toBeInTheDocument();
    expect(screen.getByText(/Build the evidence pack/)).toBeInTheDocument();
  });

  it("never names a jurisdiction that is not the bound template's", () => {
    // The summary card used to read "the active California gate scaffold" — a
    // literal that told an agency anywhere else it was on California's gates.
    const { container } = renderBoard();

    const jurisdictionMentions = (container.textContent ?? "").match(/California/g) ?? [];
    // The California pack IS the bound template here, so its label may appear —
    // but only because the summary carried it, never as board copy. Swapping the
    // registered template would change this text with no edit to the component.
    expect(jurisdictionMentions.length).toBeGreaterThan(0);
    expect(screen.getByText(/California, United States/)).toBeInTheDocument();
  });
});

describe("the cockpit can be driven, not only read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ decision: { id: "d1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
  });

  it("posts a recorded decision for the gate it was opened on", async () => {
    renderBoard();

    fireEvent.click(screen.getAllByRole("button", { name: "Record decision" })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Why this gate passes/), {
      target: { value: "Charter approved and on file." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/stage-gates/decisions");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      gateId: "G01_INITIATION_AUTHORIZATION",
      decision: "PASS",
      rationale: "Charter approved and on file.",
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("hides the control from the read-only viewer tier", () => {
    renderBoard({ canRecordDecision: false });

    expect(screen.queryByRole("button", { name: "Record decision" })).not.toBeInTheDocument();
  });

  it("keeps recording available even when the log could not be read", () => {
    // A read outage is not a write outage. Hiding the control would turn one
    // into the other and leave a planner unable to record a decision at all.
    renderBoard({ decisionsUnavailable: { reason: "permission denied" } });

    expect(screen.getAllByRole("button", { name: "Record decision" }).length).toBe(9);
  });

  it("shows the server's own refusal rather than a generic failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Unknown stage gate",
          details: '"nope" is not a gate in the ca_stage_gates_v0_1 stage-gate template.',
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    renderBoard();

    fireEvent.click(screen.getAllByRole("button", { name: "Record decision" })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Why this gate passes/), {
      target: { value: "Attempted." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "is not a gate in the ca_stage_gates_v0_1 stage-gate template"
    );
  });

  it("does not drop a run citation the planner selected and left blank", async () => {
    // The payload builder omits the citation when the id is empty, so a planner
    // who chose "Model run" and typed nothing would have saved a decision with
    // no evidence attached and been told nothing at all.
    renderBoard();

    fireEvent.click(screen.getAllByRole("button", { name: "Record decision" })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Why this gate passes/), {
      target: { value: "Model run supports this." },
    });
    fireEvent.change(screen.getByDisplayValue("No run cited"), {
      target: { value: "modelRunId" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "would be recorded as no citation at all"
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
