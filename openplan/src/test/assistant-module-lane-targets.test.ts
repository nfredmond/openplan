import { describe, expect, it } from "vitest";

import {
  getAssistantActions,
  resolveAssistantTarget,
  resolveAssistantWorkflowId,
  type AssistantTargetKind,
} from "@/lib/assistant/catalog";

/**
 * The seven module lanes used to fall through `resolveAssistantTarget` to the
 * generic workspace context, which is why the copilot was blind on them. These
 * tests pin the pathname → kind resolution for every new lane INCLUDING deep
 * children, with varied ids — a lane that resolves only on its root would fall
 * back to workspace grounding one click into the module.
 */
describe("module-lane target resolution", () => {
  const params = (query = "") => new URLSearchParams(query);

  const cases: Array<{ pathname: string; kind: AssistantTargetKind; id: string | null }> = [
    { pathname: "/grants", kind: "grants", id: null },
    { pathname: "/invoicing", kind: "invoicing", id: null },
    { pathname: "/engagement", kind: "engagement", id: null },
    {
      pathname: "/engagement/2f9f2f6a-1d34-4b9e-8a55-1f0b1a2c3d4e",
      kind: "engagement",
      id: "2f9f2f6a-1d34-4b9e-8a55-1f0b1a2c3d4e",
    },
    {
      pathname: "/engagement/9d8c7b6a-5e4f-4a3b-9c2d-1e0f9a8b7c6d/preview",
      kind: "engagement",
      id: "9d8c7b6a-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
    },
    { pathname: "/safety", kind: "safety", id: null },
    { pathname: "/aerial", kind: "aerial", id: null },
    {
      pathname: "/aerial/missions/4b3a2c1d-0e9f-4a8b-b7c6-d5e4f3a2b1c0",
      kind: "aerial",
      id: "4b3a2c1d-0e9f-4a8b-b7c6-d5e4f3a2b1c0",
    },
    {
      pathname: "/aerial/missions/aa11bb22-cc33-dd44-ee55-ff6677889900/edit",
      kind: "aerial",
      id: "aa11bb22-cc33-dd44-ee55-ff6677889900",
    },
    { pathname: "/knowledge-base", kind: "knowledge_base", id: null },
    { pathname: "/data-hub", kind: "data_hub", id: null },
  ];

  for (const testCase of cases) {
    it(`resolves ${testCase.pathname} to ${testCase.kind}`, () => {
      const target = resolveAssistantTarget(testCase.pathname, params("workspaceId=workspace-77"));
      expect(target.kind).toBe(testCase.kind);
      expect(target.id).toBe(testCase.id);
      expect(target.workspaceId).toBe("workspace-77");
    });
  }

  it("varies the resolved id with the path, rather than hardcoding one", () => {
    const first = resolveAssistantTarget("/engagement/campaign-one", params());
    const second = resolveAssistantTarget("/engagement/campaign-two", params());
    expect(first.id).toBe("campaign-one");
    expect(second.id).toBe("campaign-two");
    expect(first.id).not.toBe(second.id);
  });

  it("still resolves unknown surfaces to the workspace fallback", () => {
    expect(resolveAssistantTarget("/dashboard", params()).kind).toBe("workspace");
    expect(resolveAssistantTarget("/help", params()).kind).toBe("workspace");
  });
});

describe("module-lane catalog actions", () => {
  const laneKinds: AssistantTargetKind[] = [
    "grants",
    "invoicing",
    "engagement",
    "safety",
    "aerial",
    "knowledge_base",
    "data_hub",
  ];

  for (const kind of laneKinds) {
    it(`${kind} has its own deterministic actions, not the workspace fallback`, () => {
      const actions = getAssistantActions(kind);
      const workspaceActions = getAssistantActions("workspace");
      expect(actions.length).toBeGreaterThanOrEqual(2);
      expect(actions.map((action) => action.id)).not.toEqual(workspaceActions.map((action) => action.id));
      for (const action of actions) {
        expect(action.label.trim()).not.toBe("");
        expect(action.prompt.trim()).not.toBe("");
      }
    });
  }

  it("routes lane questions to the matching workflow id", () => {
    expect(resolveAssistantWorkflowId("grants", null, "which decisions are overdue?")).toBe("grants-decision-queue");
    expect(resolveAssistantWorkflowId("grants", null, "how are our awards doing")).toBe("grants-awards");
    expect(resolveAssistantWorkflowId("grants", null, "give me the picture")).toBe("grants-brief");
    expect(resolveAssistantWorkflowId("invoicing", null, "what reimbursements are outstanding")).toBe(
      "invoicing-reimbursements"
    );
    expect(resolveAssistantWorkflowId("invoicing", null, "any unpaid client bills?")).toBe("invoicing-receivables");
    expect(resolveAssistantWorkflowId("engagement", null, "what is in the moderation queue")).toBe(
      "engagement-moderation"
    );
    expect(resolveAssistantWorkflowId("engagement", null, "which campaigns are live")).toBe("engagement-publication");
    expect(resolveAssistantWorkflowId("safety", null, "what years does our data cover")).toBe("safety-coverage");
    expect(resolveAssistantWorkflowId("safety", null, "how many fatal crashes")).toBe("safety-severity");
    expect(resolveAssistantWorkflowId("aerial", null, "is custody complete on the processing job")).toBe("aerial-jobs");
    expect(resolveAssistantWorkflowId("aerial", null, "which packages are ready")).toBe("aerial-packages");
    expect(resolveAssistantWorkflowId("knowledge_base", null, "did any extraction fail")).toBe(
      "knowledge-base-extraction"
    );
    expect(resolveAssistantWorkflowId("data_hub", null, "is the gtfs feed current")).toBe("data-hub-feeds");
    expect(resolveAssistantWorkflowId("data_hub", null, "did the refresh fail")).toBe("data-hub-refresh");
  });

  it("honors an explicitly requested lane workflow id", () => {
    expect(resolveAssistantWorkflowId("safety", "safety-severity", "unrelated words")).toBe("safety-severity");
  });
});
