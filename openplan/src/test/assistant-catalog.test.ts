import { describe, expect, it } from "vitest";
import { resolveAssistantTarget, resolveAssistantWorkflowId } from "@/lib/assistant/catalog";

describe("assistant catalog helpers", () => {
  it("resolves a project detail path into project grounding", () => {
    const searchParams = new URLSearchParams();
    searchParams.set("workspaceId", "11111111-1111-4111-8111-111111111111");

    const target = resolveAssistantTarget(
      "/projects/22222222-2222-4222-8222-222222222222",
      searchParams
    );

    expect(target).toEqual({
      kind: "project",
      id: "22222222-2222-4222-8222-222222222222",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      runId: null,
      baselineRunId: null,
    });
  });

  it("resolves Analysis Studio deep links into run grounding", () => {
    const searchParams = new URLSearchParams();
    searchParams.set("runId", "33333333-3333-4333-8333-333333333333");
    searchParams.set("baselineRunId", "44444444-4444-4444-8444-444444444444");

    const target = resolveAssistantTarget("/explore", searchParams);

    expect(target).toEqual({
      kind: "run",
      id: "33333333-3333-4333-8333-333333333333",
      workspaceId: null,
      runId: "33333333-3333-4333-8333-333333333333",
      baselineRunId: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("maps project blocker language to the blocker workflow", () => {
    expect(resolveAssistantWorkflowId("project", null, "What is blocking this project right now?")).toBe(
      "project-blockers"
    );
  });

  it("maps report sharing language to the release workflow", () => {
    expect(resolveAssistantWorkflowId("report", null, "Is this ready to share with the client?")).toBe(
      "report-release"
    );
  });
});
