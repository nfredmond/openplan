import { describe, expect, it } from "vitest";
import {
  applyLocalConsoleStateToPreview,
  applyLocalConsoleStateToResponse,
  type AssistantLocalConsoleState,
} from "@/lib/assistant/local-console-state";
import type { AssistantPreview, AssistantResponse } from "@/lib/assistant/catalog";

const localConsoleState: AssistantLocalConsoleState = {
  title: "Triage mode is isolating act-now queue pressure.",
  detail: "Two pinned items and one tomorrow snooze are shaping the visible board.",
  shapedCount: 3,
  snoozedCount: 1,
  returningSoonCount: 1,
  viewMode: "triage",
  filter: "act_now",
};

describe("assistant local console state adapters", () => {
  it("adds a dedicated boardStateCue to previews without mutating summary or facts", () => {
    const preview: AssistantPreview = {
      kind: "workspace",
      title: "Workspace copilot",
      summary: "Grounded to the current workspace.",
      stats: [{ label: "Queue", value: "3" }],
      facts: ["Latest project: Nevada County ATP."],
      suggestedActions: [],
    };

    const adapted = applyLocalConsoleStateToPreview(preview, localConsoleState);

    expect(adapted.summary).toBe(preview.summary);
    expect(adapted.facts).toEqual(preview.facts);
    expect(adapted.boardStateCue).toEqual({
      label: "Local board posture",
      title: localConsoleState.title,
      detail: localConsoleState.detail,
      items: [
        "Mode: triage",
        "Filter: act-now pressure",
        "Shaped ops: 3",
        "Snoozed ops: 1",
        "Returning soon: 1",
      ],
    });
  });

  it("adds a dedicated boardStateCue to responses without mutating summary, findings, or evidence", () => {
    const response: AssistantResponse = {
      workflowId: "workspace-overview",
      label: "Workspace overview",
      title: "Current workspace brief",
      summary: "The shared command queue is leading the next move.",
      findings: ["One packet refresh is overdue."],
      nextSteps: ["Open the queue-dominant packet surface."],
      evidence: ["Queue depth: 3"],
    };

    const adapted = applyLocalConsoleStateToResponse(response, localConsoleState);

    expect(adapted.summary).toBe(response.summary);
    expect(adapted.findings).toEqual(response.findings);
    expect(adapted.evidence).toEqual(response.evidence);
    expect(adapted.boardStateCue?.title).toBe(localConsoleState.title);
    expect(adapted.boardStateCue?.items).toContain("Filter: act-now pressure");
  });

  it("returns the original object shape when no local console state is supplied", () => {
    const preview: AssistantPreview = {
      kind: "workspace",
      title: "Workspace copilot",
      summary: "Grounded to the current workspace.",
      stats: [],
      facts: ["No recent project visible."],
      suggestedActions: [],
    };

    const response: AssistantResponse = {
      workflowId: "workspace-overview",
      label: "Workspace overview",
      title: "Current workspace brief",
      summary: "The queue is clear.",
      findings: [],
      nextSteps: [],
      evidence: [],
    };

    expect(applyLocalConsoleStateToPreview(preview, null)).toEqual(preview);
    expect(applyLocalConsoleStateToResponse(response, null)).toEqual(response);
  });
});
